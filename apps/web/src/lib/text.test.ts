import { describe, expect, it } from 'vitest';
import {
  answersMatch,
  asPercentage,
  firstWord,
  forSearch,
  inWords,
  foldAccents,
  stripStress,
} from './text';

describe('stress marks', () => {
  it('drops the combining acute the course uses', () => {
    expect(stripStress('молоко́')).toBe('молоко');
    expect(stripStress('пожа́луйста')).toBe('пожалуйста');
  });

  it('leaves every other diacritic alone when only stress is stripped', () => {
    expect(stripStress('coña')).toBe('coña');
    expect(stripStress('молоко́')).toBe('молоко');
  });

  it('folds Latin accents when a search is normalised', () => {
    expect(foldAccents('coña')).toBe('cona');
    expect(foldAccents('Español')).toBe('Espanol');
  });

  it('keeps Cyrillic letters whole, because й is not an accented и', () => {
    expect(foldAccents('пожа́луйста')).toBe('пожалуйста');
    expect(forSearch('ЙОД')).toBe('йод');
  });
});

describe('searching the Lexicon', () => {
  it('ignores case and stress', () => {
    expect(forSearch('Молоко́')).toBe('молоко');
  });

  it('matches an unmarked query against a marked headword', () => {
    expect(forSearch('молоко́').includes(forSearch('молоко'))).toBe(true);
  });
});

describe('checking an answer', () => {
  it('accepts an answer typed without the stress mark', () => {
    expect(answersMatch('молоко', 'молоко́')).toBe(true);
  });

  it('accepts a different case and trailing punctuation', () => {
    expect(answersMatch('  No Way. ', 'no way')).toBe(true);
  });

  it('still holds an answer to its own accents', () => {
    expect(answersMatch('ni de cona', 'ni de coña')).toBe(false);
  });

  it('rejects an empty answer', () => {
    expect(answersMatch('   ', 'no way')).toBe(false);
  });

  it('rejects a different answer', () => {
    expect(answersMatch('no chance', 'no way')).toBe(false);
  });
});

describe('written numbers', () => {
  it('spells small numbers out', () => {
    expect(inWords(4)).toBe('four');
  });

  it('falls back to digits past twelve', () => {
    expect(inWords(21)).toBe('21');
  });
});

it('gives the first word for a hint', () => {
  expect(firstWord('made do with')).toBe('made');
});

it('writes a retention reading as a percentage', () => {
  expect(asPercentage(0.74)).toBe('74%');
});
