/**
 * Text handling the product requires everywhere.
 *
 * Two different normalisations, deliberately: searching the Lexicon is
 * accent- and case-insensitive, while answer checking only forgives the
 * combining acute U+0301 that the course uses to mark stress. Nobody is ever
 * asked to type that mark, but "coña" and "cona" are different answers.
 */

/** The stress mark the course writes, and the only one an answer may omit. */
const COMBINING_ACUTE = '́';

/**
 * Fold the accents a search should ignore: those on Latin letters, plus the
 * stress mark wherever it appears. Cyrillic keeps its own diacritics, because
 * й is a letter of the alphabet rather than an accented и, and folding it
 * would merge two different words.
 */
export function foldAccents(value: string): string {
  return stripStress(value.normalize('NFD').replace(/(\p{Script=Latin})\p{Mn}+/gu, '$1')).normalize(
    'NFC',
  );
}

/** Drop only the stress mark, leaving every other diacritic in place. */
export function stripStress(value: string): string {
  return value.normalize('NFD').split(COMBINING_ACUTE).join('').normalize('NFC');
}

/** Case- and accent-insensitive form used for searching the Lexicon. */
export function forSearch(value: string): string {
  return foldAccents(value).toLocaleLowerCase().trim();
}

/** Whether a typed answer counts: case, stress marks, spacing and full stops are forgiven. */
export function answersMatch(typed: string, answer: string): boolean {
  const clean = (value: string) =>
    stripStress(value)
      .toLocaleLowerCase()
      .replace(/[.,!?;:]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const left = clean(typed);
  return left.length > 0 && left === clean(answer);
}

/** The first word of an answer, used for the hint that comes before it. */
export function firstWord(answer: string): string {
  return answer.trim().split(/\s+/)[0] ?? answer;
}

/** A percentage, written for a person: 0.74 becomes "74%". */
export function asPercentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

const words = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];

/** Small numbers read better as words in a sentence: "about four minutes". */
export function inWords(value: number): string {
  return words[value] ?? String(value);
}
