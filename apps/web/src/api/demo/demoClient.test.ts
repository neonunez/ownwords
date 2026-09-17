import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoClient } from './demoClient';
import { OwnwordsError } from '../client';
import type { OwnwordsClient } from '../client';

let client: OwnwordsClient;

beforeEach(() => {
  client = createDemoClient({ suggestionDelaysMs: {} });
});

describe('reading the collection', () => {
  it('searches without case or stress marks', async () => {
    const page = await client.listEntries({ search: 'молоко' });
    expect(page.items.map((entry) => entry.headword)).toEqual(['молоко́']);
  });

  it('keeps only entries carrying an unreviewed equivalent', async () => {
    const page = await client.listEntries({ unverifiedOnly: true });
    const headwords = page.items.map((entry) => entry.headword);
    expect(headwords).toContain('to make do with');
    expect(headwords).not.toContain('ni de coña');
  });

  it('filters to expressions', async () => {
    const page = await client.listEntries({ kind: 'expression' });
    expect(page.items.every((entry) => entry.kind === 'expression')).toBe(true);
  });

  it('reports a missing entry rather than inventing one', async () => {
    await expect(client.getEntry('nope')).rejects.toBeInstanceOf(OwnwordsError);
  });
});

describe('fixing a translation', () => {
  it('records a fit and confirms the equivalent', async () => {
    const entry = await client.getEntry('e1');
    const sense = entry.senses[0]!;
    const equivalent = sense.equivalents[1]!;
    const updated = await client.updateEquivalent(entry.id, sense.id, equivalent.id, {
      fit: 'false-friend',
      state: 'confirmed',
    });
    const after = updated.senses[0]!.equivalents[1]!;
    expect(after.fit).toBe('false-friend');
    expect(after.state).toBe('confirmed');
    expect(updated.version).toBeGreaterThan(entry.version);
  });

  it('marks a hand-typed equivalent as typed by hand', async () => {
    const entry = await client.getEntry('e1');
    const sense = entry.senses[0]!;
    const equivalent = sense.equivalents[0]!;
    const updated = await client.updateEquivalent(entry.id, sense.id, equivalent.id, {
      text: 'apañárselas con',
    });
    expect(updated.senses[0]!.equivalents[0]!.state).toBe('manual');
  });

  it('retries a failed translation without dropping the entry', async () => {
    const entry = await client.getEntry('e4');
    const sense = entry.senses[0]!;
    const failed = sense.equivalents.find((candidate) => candidate.state === 'failed')!;
    const updated = await client.retryTranslation(entry.id, sense.id, failed.id);
    const after = updated.senses[0]!.equivalents.find((candidate) => candidate.id === failed.id)!;
    expect(after.state).toBe('suggested');
    expect(after.text).not.toBe('');
  });
});

describe('adding an entry', () => {
  it('stores it and starts its equivalents waiting', async () => {
    const created = await client.createEntry({
      headword: 'to let it slide',
      note: 'when it is not worth the argument',
      kind: 'expression',
      language: 'en',
      suggestInto: ['es', 'ru'],
    });
    expect(created.senses[0]!.equivalents.map((candidate) => candidate.state)).toEqual([
      'waiting',
      'waiting',
    ]);
    const page = await client.listEntries({ search: 'let it slide' });
    expect(page.items).toHaveLength(1);
  });

  it('reports each suggestion as it arrives', async () => {
    const seen: string[] = [];
    await client.requestSuggestions(
      { headword: 'to let it slide', language: 'en', note: '' },
      ['es', 'ru'],
      (result) => seen.push(`${result.language}:${result.state}`),
    );
    expect(seen.sort()).toEqual(['es:suggested', 'ru:suggested']);
  });

  it('says a translation failed without dropping anything', async () => {
    const failing = createDemoClient({ suggestionDelaysMs: {}, failingLanguages: ['ru'] });
    const results: string[] = [];
    await failing.requestSuggestions(
      { headword: 'sobremesa', language: 'es', note: '' },
      ['ru'],
      (result) => results.push(`${result.state}:${result.reason ?? ''}`),
    );
    expect(results[0]).toBe('failed:Translation failed. Nothing was dropped.');
  });
});

describe('practice', () => {
  it('keeps Learn practice to the language being learned', async () => {
    const queue = await client.getDueQueue({ mode: 'learn' });
    expect(queue.cards.every((card) => card.language === 'ru')).toBe(true);
  });

  it('sizes the session in words, not counts', async () => {
    const queue = await client.getDueQueue({ mode: 'maintain' });
    expect(queue.estimate).toMatch(/^About (a minute|[a-z]+ minutes)\.$/);
  });

  it('keeps a card that was rated again in the session', async () => {
    const before = await client.getDueQueue({ mode: 'maintain' });
    const card = before.cards[0]!;
    await client.submitReview({ cardId: card.cardId, rating: 'again', format: 'cloze', submissionId: 'a' });
    const after = await client.getDueQueue({ mode: 'maintain' });
    expect(after.cards.map((one) => one.cardId)).toContain(card.cardId);
  });

  it('retires a card that was answered', async () => {
    const before = await client.getDueQueue({ mode: 'maintain' });
    const card = before.cards[0]!;
    await client.submitReview({ cardId: card.cardId, rating: 'good', format: 'cloze', submissionId: 'b' });
    const after = await client.getDueQueue({ mode: 'maintain' });
    expect(after.cards.map((one) => one.cardId)).not.toContain(card.cardId);
  });
});

describe('progress', () => {
  it('reports retention per language and per direction, and never a card count', async () => {
    const summary = await client.getProgress();
    const russianProduce = summary.perLanguage.find(
      (row) => row.language === 'ru' && row.direction === 'produce',
    )!;
    expect(russianProduce.retention).toBeNull();
    expect(Object.keys(summary)).not.toContain('cardCount');
  });
});

describe('the course', () => {
  it('has all 33 Cyrillic letters, with the Latin lookalikes marked', async () => {
    const alphabet = await client.getAlphabet();
    expect(alphabet).toHaveLength(33);
    expect(alphabet.find((letter) => letter.upper === 'В')?.trap).toBe('looks like B');
    expect(alphabet.find((letter) => letter.upper === 'К')?.sameAsLatin).toBe(true);
  });

  it('refuses a lesson that is not in the course yet', async () => {
    await expect(client.getLesson('u9')).rejects.toBeInstanceOf(OwnwordsError);
  });
});
