import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { appFor, createVerifiedEntry, jsonRequest, setup, type TestContext } from './helpers.js';

const contexts: TestContext[] = [];

afterEach(() => {
  while (contexts.length > 0) contexts.pop()!.rawDb.close();
});

async function context(): Promise<TestContext> {
  const value = await setup();
  contexts.push(value);
  return value;
}

async function due(ctx: TestContext, ownerId: string, sessionId: string, format = 'flashcard'): Promise<any> {
  const response = await jsonRequest(
    appFor(ctx, ownerId),
    `/api/v1/lexicon/practice/due?language=ru&direction=produce&format=${format}&sessionId=${sessionId}`,
    {},
    ctx.db,
  );
  assert.equal(response.status, 200);
  return await response.json();
}

describe('practice eligibility and shared scheduler', () => {
  it('never schedules false friends or unverified Russian suggestions', async () => {
    const ctx = await context();
    const app = appFor(ctx, 'user-a');
    const created = await jsonRequest(
      app,
      '/api/v1/lexicon/entries',
      {
        method: 'POST',
        json: {
          kind: 'word',
          senses: [
            {
              gloss: 'an actual greeting',
              equivalents: [
                { languageTag: 'en', text: 'hello', status: 'manual', fit: 'exact' },
                { languageTag: 'ru', text: 'алло', status: 'confirmed', fit: 'false_friend' },
                { languageTag: 'ru', text: 'приве́т', status: 'suggested', fit: 'exact' },
              ],
            },
          ],
        },
      },
      ctx.db,
    );
    const entry = (await created.json() as any).data;
    assert.equal((await due(ctx, 'user-a', 'session-a')).data.length, 0);

    const sense = entry.senses[0];
    const suggestion = sense.equivalents.find((item: any) => item.status === 'suggested');
    const confirmed = await jsonRequest(
      app,
      `/api/v1/lexicon/entries/${entry.id}/senses/${sense.id}/equivalents/${suggestion.id}`,
      { method: 'PATCH', json: { version: suggestion.version, status: 'confirmed' } },
      ctx.db,
    );
    assert.equal(confirmed.status, 200);
    const queue = await due(ctx, 'user-a', 'session-a');
    assert.equal(queue.data.length, 1);
    assert.equal(queue.data[0].target.text, 'приве́т');
  });

  it('uses one progress card for flashcard and explicitly authored cloze views', async () => {
    const ctx = await context();
    const entry = await createVerifiedEntry(ctx);
    const sense = entry.senses[0];
    const russian = sense.equivalents.find((item: any) => item.languageTag === 'ru');
    const app = appFor(ctx, 'user-a');
    await jsonRequest(
      app,
      `/api/v1/lexicon/entries/${entry.id}/senses/${sense.id}/equivalents/${russian.id}/cloze`,
      { method: 'POST', json: { template: '{{blank}}, друг!', answer: 'приве́т' } },
      ctx.db,
    );
    const flashcard = await due(ctx, 'user-a', 'session-a', 'flashcard');
    const cloze = await due(ctx, 'user-a', 'session-a', 'cloze');
    assert.equal(flashcard.data.length, 1);
    assert.equal(cloze.data.length, 1);
    assert.equal(flashcard.data[0].card.id, cloze.data[0].card.id);
    assert.equal(cloze.data[0].cloze.template, '{{blank}}, друг!');
  });

  it('keeps card identity and language filters in sync when an equivalent language changes', async () => {
    const ctx = await context();
    const entry = await createVerifiedEntry(ctx);
    const sense = entry.senses[0];
    const russian = sense.equivalents.find((item: any) => item.languageTag === 'ru');
    const before = await due(ctx, 'user-a', 'session-a');
    const cardId = before.data[0].card.id;

    const updated = await jsonRequest(
      appFor(ctx, 'user-a'),
      `/api/v1/lexicon/entries/${entry.id}/senses/${sense.id}/equivalents/${russian.id}`,
      { method: 'PATCH', json: { version: russian.version, languageTag: 'uk' } },
      ctx.db,
    );
    assert.equal(updated.status, 200);
    assert.equal((await due(ctx, 'user-a', 'session-a')).data.length, 0);

    const ukrainian = await jsonRequest(
      appFor(ctx, 'user-a'),
      '/api/v1/lexicon/practice/due?language=uk&direction=produce&format=flashcard&sessionId=session-a',
      {},
      ctx.db,
    );
    const body = await ukrainian.json() as any;
    assert.equal(body.data[0].card.id, cardId);
    assert.equal(body.data[0].card.languageTag, 'uk');
  });

  it('does not create cards as a side effect of a stale confirmation', async () => {
    const ctx = await context();
    const app = appFor(ctx, 'user-a');
    const created = await jsonRequest(
      app,
      '/api/v1/lexicon/entries',
      {
        method: 'POST',
        json: {
          kind: 'word',
          senses: [{
            gloss: 'test',
            equivalents: [{ languageTag: 'ru', text: 'те́ст', status: 'suggested', fit: 'exact' }],
          }],
        },
      },
      ctx.db,
    );
    const entry = (await created.json() as any).data;
    const sense = entry.senses[0];
    const equivalent = sense.equivalents[0];
    const firstEdit = await jsonRequest(
      app,
      `/api/v1/lexicon/entries/${entry.id}/senses/${sense.id}/equivalents/${equivalent.id}`,
      { method: 'PATCH', json: { version: 1, note: 'still awaiting review' } },
      ctx.db,
    );
    assert.equal(firstEdit.status, 200);
    const stale = await jsonRequest(
      app,
      `/api/v1/lexicon/entries/${entry.id}/senses/${sense.id}/equivalents/${equivalent.id}`,
      { method: 'PATCH', json: { version: 1, status: 'confirmed', languageTag: 'uk' } },
      ctx.db,
    );
    assert.equal(stale.status, 409);
    const count = ctx.rawDb.sqlite
      .prepare('SELECT COUNT(*) AS count FROM lexicon_practice_cards WHERE equivalent_id = ?')
      .get(equivalent.id) as { count: number };
    assert.equal(count.count, 0);
  });
});

describe('practice prompts', () => {
  it('treats a blank gloss as absent instead of serving a blank prompt', async () => {
    const ctx = await context();
    const app = appFor(ctx, 'user-a');
    const created = await jsonRequest(
      app,
      '/api/v1/lexicon/entries',
      {
        method: 'POST',
        json: { kind: 'word', senses: [{ gloss: '   ', equivalents: [{ languageTag: 'ru', text: 'дом', status: 'manual' }] }] },
      },
      ctx.db,
    );
    assert.equal(created.status, 201);
    const entry = (await created.json() as any).data;
    assert.equal(entry.senses[0].gloss, null);
    assert.equal((await due(ctx, 'user-a', 'session-a')).data.length, 0);

    const sense = entry.senses[0];
    const glossed = await jsonRequest(
      app,
      `/api/v1/lexicon/entries/${entry.id}/senses/${sense.id}`,
      { method: 'PATCH', json: { version: sense.version, gloss: 'house' } },
      ctx.db,
    );
    assert.equal(glossed.status, 200);
    assert.deepEqual((await due(ctx, 'user-a', 'session-a')).data[0].prompt, { type: 'gloss', text: 'house' });

    const cleared = await jsonRequest(
      app,
      `/api/v1/lexicon/entries/${entry.id}/senses/${sense.id}`,
      { method: 'PATCH', json: { version: sense.version + 1, gloss: '' } },
      ctx.db,
    );
    assert.equal((await cleared.json() as any).data.gloss, null);
    assert.equal((await due(ctx, 'user-a', 'session-a')).data.length, 0);
  });
});

describe('review idempotency, concurrency, and wrong-answer revisits', () => {
  it('replays duplicate submissions once and rejects an idempotency-key mismatch', async () => {
    const ctx = await context();
    await createVerifiedEntry(ctx);
    const queue = await due(ctx, 'user-a', 'session-a');
    const cardId = queue.data[0].card.id;
    const app = appFor(ctx, 'user-a', { wrongAnswerDelayMs: 300_000 });
    const payload = { submissionId: 'submission-1', cardId, sessionId: 'session-a', rating: 1 };

    const [first, replay] = await Promise.all([
      jsonRequest(app, '/api/v1/lexicon/practice/reviews', { method: 'POST', json: payload }, ctx.db),
      jsonRequest(app, '/api/v1/lexicon/practice/reviews', { method: 'POST', json: payload }, ctx.db),
    ]);
    assert.deepEqual([first.status, replay.status].sort(), [200, 201]);
    const bodies = [await first.json() as any, await replay.json() as any];
    assert.equal(bodies.filter((body) => body.replayed === false).length, 1);
    assert.equal(bodies.filter((body) => body.replayed === true).length, 1);
    assert.equal(bodies[0].data.resultingRevision, 1);
    assert.equal(bodies[1].data.resultingRevision, 1);

    const conflict = await jsonRequest(
      app,
      '/api/v1/lexicon/practice/reviews',
      { method: 'POST', json: { ...payload, rating: 4 } },
      ctx.db,
    );
    assert.equal(conflict.status, 409);

    const events = ctx.rawDb.sqlite
      .prepare('SELECT COUNT(*) AS count FROM lexicon_review_events WHERE card_id = ?')
      .get(cardId) as { count: number };
    assert.equal(events.count, 1);
  });

  it('serializes concurrent distinct reviews and revisits a wrong answer later in the same session', async () => {
    const ctx = await context();
    await createVerifiedEntry(ctx);
    const queue = await due(ctx, 'user-a', 'session-a');
    const cardId = queue.data[0].card.id;
    const app = appFor(ctx, 'user-a', { wrongAnswerDelayMs: 300_000 });

    const wrong = await jsonRequest(
      app,
      '/api/v1/lexicon/practice/reviews',
      { method: 'POST', json: { submissionId: 'wrong-1', cardId, sessionId: 'session-a', rating: 1 } },
      ctx.db,
    );
    assert.equal(wrong.status, 201);

    ctx.clock.advance(300_000);
    const revisitQueue = await due(ctx, 'user-a', 'session-a');
    assert.equal(revisitQueue.data[0].card.id, cardId);
    assert.equal(revisitQueue.data[0].revisit, true);

    const correct = await jsonRequest(
      app,
      '/api/v1/lexicon/practice/reviews',
      { method: 'POST', json: { submissionId: 'correct-2', cardId, sessionId: 'session-a', rating: 3 } },
      ctx.db,
    );
    assert.equal(correct.status, 201);
    assert.equal((await correct.json() as any).data.resultingRevision, 2);

    const later = await due(ctx, 'user-a', 'session-a');
    assert.equal(later.data.some((item: any) => item.revisit === true), false);
  });

  it('reports FSRS retention and next due time separately by direction', async () => {
    const ctx = await context();
    await createVerifiedEntry(ctx);
    const app = appFor(ctx, 'user-a');
    const progress = async (ownerApp = app): Promise<any[]> => {
      const response = await jsonRequest(ownerApp, '/api/v1/lexicon/progress?language=ru', {}, ctx.db);
      assert.equal(response.status, 200);
      return (await response.json() as any).data;
    };

    const empty = await progress(appFor(ctx, 'user-b'));
    assert.deepEqual(empty, [
      { languageTag: 'ru', direction: 'recognize', retention: null, nextDueAt: null },
      { languageTag: 'ru', direction: 'produce', retention: null, nextDueAt: null },
    ]);

    const created = ctx.clock.now().toISOString();
    const unreviewed = await progress();
    assert.deepEqual(unreviewed.map((item) => item.direction), ['recognize', 'produce']);
    assert.deepEqual(unreviewed.map((item) => item.retention), [null, null]);
    assert.deepEqual(unreviewed.map((item) => item.nextDueAt), [created, created]);
    assert.equal(unreviewed.some((item) => 'total' in item || 'due' in item || 'new' in item), false);

    const cardId = (await due(ctx, 'user-a', 'session-a')).data[0].card.id;
    const review = await jsonRequest(
      app,
      '/api/v1/lexicon/practice/reviews',
      { method: 'POST', json: { submissionId: 'progress-1', cardId, sessionId: 'session-a', rating: 3 } },
      ctx.db,
    );
    assert.equal(review.status, 201);
    const reviewedDueAt = (await review.json() as any).data.card.dueAt;

    const fresh = await progress();
    assert.equal(fresh[0].retention, null);
    assert.equal(fresh[0].nextDueAt, created);
    assert.equal(fresh[1].retention, 1);
    assert.equal(fresh[1].nextDueAt, reviewedDueAt);

    ctx.clock.advance(30 * 24 * 60 * 60 * 1000);
    const later = await progress();
    assert.ok(later[1].retention > 0 && later[1].retention < 1);
    assert.equal(later[1].nextDueAt, reviewedDueAt);
  });
});
