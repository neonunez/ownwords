import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { answersMatch } from '../src/normalize.js';
import {
  appFor,
  createVerifiedEntry,
  jsonRequest,
  setup,
  verifiedEntryBody,
  type TestContext,
} from './helpers.js';

const contexts: TestContext[] = [];

afterEach(() => {
  while (contexts.length > 0) contexts.pop()!.rawDb.close();
});

async function context(): Promise<TestContext> {
  const value = await setup();
  contexts.push(value);
  return value;
}

describe('Lexicon HTTP ownership and CRUD', () => {
  it('requires identity and never accepts an owner from the request body', async () => {
    const ctx = await context();
    const response = await jsonRequest(
      appFor(ctx),
      '/api/v1/lexicon/entries',
      { method: 'POST', json: { ...verifiedEntryBody(), ownerId: 'spoofed-user' } },
      ctx.db,
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: { code: 'AUTH_REQUIRED', message: 'Authentication is required' },
    });
  });

  it('denies cross-user reads and writes for entries and nested resources', async () => {
    const ctx = await context();
    const entry = await createVerifiedEntry(ctx);
    const sense = entry.senses[0];
    const equivalent = sense.equivalents[0];
    const app = appFor(ctx, 'user-b');

    const read = await jsonRequest(app, `/api/v1/lexicon/entries/${entry.id}`, {}, ctx.db);
    assert.equal(read.status, 404);

    const patchSense = await jsonRequest(
      app,
      `/api/v1/lexicon/entries/${entry.id}/senses/${sense.id}`,
      { method: 'PATCH', json: { version: sense.version, note: 'intrusion' } },
      ctx.db,
    );
    assert.equal(patchSense.status, 404);

    const deleteEquivalent = await jsonRequest(
      app,
      `/api/v1/lexicon/entries/${entry.id}/senses/${sense.id}/equivalents/${equivalent.id}`,
      { method: 'DELETE', headers: { 'If-Match': `"${equivalent.version}"` } },
      ctx.db,
    );
    assert.equal(deleteEquivalent.status, 404);
  });

  it('uses optimistic updates and stable soft deletion semantics', async () => {
    const ctx = await context();
    const entry = await createVerifiedEntry(ctx);
    const app = appFor(ctx, 'user-a');
    const path = `/api/v1/lexicon/entries/${entry.id}`;

    const updated = await jsonRequest(app, path, { method: 'PATCH', json: { version: 1, note: 'corrected by me' } }, ctx.db);
    assert.equal(updated.status, 200);
    const updatedBody = await updated.json() as any;
    assert.equal(updatedBody.data.version, 2);
    assert.equal(updatedBody.data.humanEdited, true);

    const stale = await jsonRequest(app, path, { method: 'PATCH', json: { version: 1, note: 'stale' } }, ctx.db);
    assert.equal(stale.status, 409);

    const deleted = await jsonRequest(app, path, { method: 'DELETE', headers: { 'If-Match': '"2"' } }, ctx.db);
    assert.equal(deleted.status, 204);
    for (const header of ['2', 'W/"2"', '"0"', '"2.5"']) {
      const unquoted = await jsonRequest(app, path, { method: 'DELETE', headers: { 'If-Match': header } }, ctx.db);
      assert.equal(unquoted.status, 400);
    }
    const repeated = await jsonRequest(app, path, { method: 'DELETE', headers: { 'If-Match': '"2"' } }, ctx.db);
    assert.equal(repeated.status, 404);

    const sense = entry.senses[0];
    const equivalent = sense.equivalents[0];
    const nestedSense = await jsonRequest(
      app,
      `${path}/senses/${sense.id}`,
      { method: 'DELETE', headers: { 'If-Match': '"1"' } },
      ctx.db,
    );
    assert.equal(nestedSense.status, 404);
    const nestedEquivalent = await jsonRequest(
      app,
      `${path}/senses/${sense.id}/equivalents/${equivalent.id}`,
      { method: 'DELETE', headers: { 'If-Match': '"1"' } },
      ctx.db,
    );
    assert.equal(nestedEquivalent.status, 404);
  });

  it('rejects malformed and out-of-bounds payloads without internal details', async () => {
    const ctx = await context();
    const app = appFor(ctx, 'user-a');
    const malformed = await jsonRequest(
      app,
      '/api/v1/lexicon/entries',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' },
      ctx.db,
    );
    assert.equal(malformed.status, 400);
    const badBody = await malformed.json() as any;
    assert.equal(badBody.error.code, 'INVALID_REQUEST');
    assert.equal(JSON.stringify(badBody).includes('SQL'), false);

    const tooLarge = await jsonRequest(
      app,
      '/api/v1/lexicon/entries',
      { method: 'POST', json: verifiedEntryBody({ note: 'x'.repeat(2001) }) },
      ctx.db,
    );
    assert.equal(tooLarge.status, 400);

    const limit = await jsonRequest(app, '/api/v1/lexicon/entries?limit=101', {}, ctx.db);
    assert.equal(limit.status, 400);
  });
});

describe('search, filtering, and pagination', () => {
  it('ignores case and diacritics but preserves distinct letters', async () => {
    const ctx = await context();
    const app = appFor(ctx, 'user-a');
    const texts = ['Camión', 'cañón', 'сло́во', 'всё', 'мой', 'pingüino', 'Noël', 'não', 'français', 'crème', 'Straße'];
    for (const text of texts) {
      const languageTag = /[А-Яа-яЁё]/u.test(text) ? 'ru' : 'es';
      const response = await jsonRequest(
        app,
        '/api/v1/lexicon/entries',
        {
          method: 'POST',
          json: {
            kind: 'word',
            senses: [{ gloss: text, equivalents: [{ languageTag, text, status: 'manual', fit: 'exact' }] }],
          },
        },
        ctx.db,
      );
      assert.equal(response.status, 201);
      ctx.clock.advance(1);
    }

    const camion = await jsonRequest(app, '/api/v1/lexicon/entries?query=CAMION', {}, ctx.db);
    assert.equal(((await camion.json() as any).data as any[]).length, 1);
    const canon = await jsonRequest(app, '/api/v1/lexicon/entries?query=canon', {}, ctx.db);
    assert.equal(((await canon.json() as any).data as any[]).length, 0);
    const slovo = await jsonRequest(app, `/api/v1/lexicon/entries?query=${encodeURIComponent('слово')}`, {}, ctx.db);
    assert.equal(((await slovo.json() as any).data as any[]).length, 1);
    const vse = await jsonRequest(app, `/api/v1/lexicon/entries?query=${encodeURIComponent('все')}`, {}, ctx.db);
    assert.equal(((await vse.json() as any).data as any[]).length, 0);

    const search = async (query: string): Promise<string[]> => {
      const response = await jsonRequest(app, `/api/v1/lexicon/entries?query=${encodeURIComponent(query)}`, {}, ctx.db);
      return ((await response.json() as any).data as any[]).map((entry) => entry.senses[0].equivalents[0].text);
    };
    assert.deepEqual(await search('pinguino'), ['pingüino']);
    assert.deepEqual(await search('NOEL'), ['Noël']);
    assert.deepEqual(await search('nao'), ['não']);
    assert.deepEqual(await search('francais'), ['français']);
    assert.deepEqual(await search('creme'), ['crème']);
    assert.deepEqual(await search('cañon'), ['cañón']);
    assert.deepEqual(await search('мои'), []);
    assert.deepEqual(await search('мой'), ['мой']);
    assert.deepEqual(await search('всё'), ['всё']);
    assert.deepEqual(await search('straße'), ['Straße']);
    assert.deepEqual(await search('strasse'), []);
  });

  it('stores BCP 47-style language tags in canonical casing', async () => {
    const ctx = await context();
    const response = await jsonRequest(
      appFor(ctx, 'user-a'),
      '/api/v1/lexicon/entries',
      {
        method: 'POST',
        json: {
          kind: 'expression',
          senses: [{ equivalents: [{ languageTag: 'pt-br', text: 'bom dia', status: 'manual' }] }],
        },
      },
      ctx.db,
    );
    assert.equal(response.status, 201);
    assert.equal((await response.json() as any).data.senses[0].equivalents[0].languageTag, 'pt-BR');
  });

  it('returns bounded cursor pages and verification filters', async () => {
    const ctx = await context();
    const app = appFor(ctx, 'user-a');
    await createVerifiedEntry(ctx);
    ctx.clock.advance(1);
    const suggested = verifiedEntryBody({
      senses: [{ gloss: 'unverified', equivalents: [{ languageTag: 'ru', text: 'тест', status: 'suggested' }] }],
    });
    assert.equal((await jsonRequest(app, '/api/v1/lexicon/entries', { method: 'POST', json: suggested }, ctx.db)).status, 201);

    const firstPage = await jsonRequest(app, '/api/v1/lexicon/entries?limit=1', {}, ctx.db);
    const firstBody = await firstPage.json() as any;
    assert.equal(firstBody.data.length, 1);
    assert.equal(typeof firstBody.page.nextCursor, 'string');
    const secondPage = await jsonRequest(
      app,
      `/api/v1/lexicon/entries?limit=1&cursor=${encodeURIComponent(firstBody.page.nextCursor)}`,
      {},
      ctx.db,
    );
    assert.equal((await secondPage.json() as any).data.length, 1);

    const unverified = await jsonRequest(app, '/api/v1/lexicon/entries?verification=unverified', {}, ctx.db);
    const items = (await unverified.json() as any).data as any[];
    assert.equal(items.length, 1);
    assert.equal(items[0].senses[0].equivalents[0].status, 'suggested');
  });

  it('applies mastery to the selected language instead of another equivalent', async () => {
    const ctx = await context();
    await createVerifiedEntry(ctx);
    ctx.rawDb.sqlite
      .prepare(
        `UPDATE lexicon_practice_cards SET reps = 5, stability = 30
          WHERE language_tag = 'en'`,
      )
      .run();
    const app = appFor(ctx, 'user-a');

    const russian = await jsonRequest(app, '/api/v1/lexicon/entries?language=ru&mastery=mastered', {}, ctx.db);
    assert.equal((await russian.json() as any).data.length, 0);
    const english = await jsonRequest(app, '/api/v1/lexicon/entries?language=en&mastery=mastered', {}, ctx.db);
    assert.equal((await english.json() as any).data.length, 1);
  });

  it('exposes per-direction mastery on each equivalent and filters mastery by direction', async () => {
    const ctx = await context();
    const entry = await createVerifiedEntry(ctx);
    const initial = entry.senses[0].equivalents.find((item: any) => item.languageTag === 'ru');
    assert.deepEqual(initial.mastery, {
      recognize: { level: 'new', dueAt: '2026-01-15T12:00:00.000Z', due: true },
      produce: { level: 'new', dueAt: '2026-01-15T12:00:00.000Z', due: true },
    });

    ctx.rawDb.sqlite
      .prepare(
        `UPDATE lexicon_practice_cards SET reps = 5, stability = 30, due_at = '2026-02-15T12:00:00.000Z'
          WHERE language_tag = 'ru' AND direction = 'recognize'`,
      )
      .run();
    const app = appFor(ctx, 'user-a');
    const list = await jsonRequest(app, '/api/v1/lexicon/entries', {}, ctx.db);
    const equivalents = (await list.json() as any).data[0].senses[0].equivalents as any[];
    assert.deepEqual(equivalents.find((item) => item.languageTag === 'ru').mastery, {
      recognize: { level: 'mastered', dueAt: '2026-02-15T12:00:00.000Z', due: false },
      produce: { level: 'new', dueAt: '2026-01-15T12:00:00.000Z', due: true },
    });

    const filter = async (query: string): Promise<number> => {
      const response = await jsonRequest(app, `/api/v1/lexicon/entries?${query}`, {}, ctx.db);
      assert.equal(response.status, 200);
      return (await response.json() as any).data.length;
    };
    assert.equal(await filter('language=ru&mastery=mastered&direction=recognize'), 1);
    assert.equal(await filter('language=ru&mastery=mastered&direction=produce'), 0);
    assert.equal(await filter('language=ru&mastery=due&direction=recognize'), 0);
    assert.equal(await filter('language=ru&mastery=due&direction=produce'), 1);
    const missingMastery = await jsonRequest(app, '/api/v1/lexicon/entries?direction=produce', {}, ctx.db);
    assert.equal(missingMastery.status, 400);

    const suggested = await jsonRequest(
      app,
      '/api/v1/lexicon/entries',
      { method: 'POST', json: { kind: 'word', senses: [{ gloss: 'test', equivalents: [{ languageTag: 'ru', text: 'тест', status: 'suggested' }] }] } },
      ctx.db,
    );
    assert.equal((await suggested.json() as any).data.senses[0].equivalents[0].mastery, null);
  });
});

describe('validated cloze and answer matching', () => {
  it('returns honest unavailable state and requires explicit validated cloze data', async () => {
    const ctx = await context();
    const entry = await createVerifiedEntry(ctx);
    const sense = entry.senses[0];
    const russian = sense.equivalents.find((item: any) => item.languageTag === 'ru');
    const app = appFor(ctx, 'user-a');
    const base = `/api/v1/lexicon/entries/${entry.id}/senses/${sense.id}/equivalents/${russian.id}/cloze`;

    const unavailable = await jsonRequest(app, base, {}, ctx.db);
    const unavailableBody = await unavailable.json() as any;
    assert.equal(unavailableBody.unavailable.code, 'NO_VALIDATED_CLOZE');

    const invalid = await jsonRequest(app, base, { method: 'POST', json: { template: 'Привет!', answer: 'привет' } }, ctx.db);
    assert.equal(invalid.status, 400);

    const created = await jsonRequest(
      app,
      base,
      {
        method: 'POST',
        json: {
          template: '{{blank}}, как дела?',
          answer: 'приве́т',
          acceptedAnswers: ['Привет'],
          provenance: { validator: 'fixture-author' },
        },
      },
      ctx.db,
    );
    assert.equal(created.status, 201);
    const cloze = (await created.json() as any).data;
    const checked = await jsonRequest(
      app,
      `/api/v1/lexicon/cloze/${cloze.id}/check`,
      { method: 'POST', json: { answer: 'ПРИВЕТ' } },
      ctx.db,
    );
    assert.equal((await checked.json() as any).data.correct, true);
  });

  it('does not erase meaningful Russian ё while stripping stress', () => {
    assert.equal(answersMatch('ru', 'сло́во', 'слово'), true);
    assert.equal(answersMatch('ru', 'всё', 'все'), false);
  });

  it('stops serving answer checks after an equivalent becomes a false friend', async () => {
    const ctx = await context();
    const entry = await createVerifiedEntry(ctx);
    const sense = entry.senses[0];
    const russian = sense.equivalents.find((item: any) => item.languageTag === 'ru');
    const app = appFor(ctx, 'user-a');
    const base = `/api/v1/lexicon/entries/${entry.id}/senses/${sense.id}/equivalents/${russian.id}`;
    const created = await jsonRequest(
      app,
      `${base}/cloze`,
      { method: 'POST', json: { template: '{{blank}}, друг!', answer: 'приве́т' } },
      ctx.db,
    );
    const cloze = (await created.json() as any).data;
    const reclassified = await jsonRequest(
      app,
      base,
      { method: 'PATCH', json: { version: russian.version, fit: 'false_friend' } },
      ctx.db,
    );
    assert.equal(reclassified.status, 200);
    const checked = await jsonRequest(
      app,
      `/api/v1/lexicon/cloze/${cloze.id}/check`,
      { method: 'POST', json: { answer: 'привет' } },
      ctx.db,
    );
    assert.equal(checked.status, 404);
  });
});
