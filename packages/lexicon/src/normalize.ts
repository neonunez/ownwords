const BASE_WITH_MARKS = /(\P{M})(\p{M}+)/gu;
const DISTINCT_LETTER_MARKS: Record<string, string> = {
  n: '\u0303',
  е: '\u0308',
  и: '\u0306',
};
const RUSSIAN_STRESS = /\u0301/gu;
const SPACES = /\s+/gu;

/**
 * Search ignores case and diacritics (accents, stress, diaeresis, tildes, cedillas) while preserving
 * letters that are distinct in their alphabet: Spanish ñ, and Russian ё and й.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .toLocaleLowerCase('und')
    .replace(BASE_WITH_MARKS, (_match, base: string, marks: string) =>
      base + [...marks].filter((mark) => DISTINCT_LETTER_MARKS[base] === mark).join(''),
    )
    .normalize('NFC')
    .replace(SPACES, ' ')
    .trim();
}

/** Russian answer checks ignore optional stress marks but deliberately do not fold ё into е. */
export function normalizeRussianAnswer(value: string): string {
  return value
    .normalize('NFD')
    .replace(RUSSIAN_STRESS, '')
    .normalize('NFC')
    .toLocaleLowerCase('ru')
    .replace(SPACES, ' ')
    .trim();
}

export function answersMatch(languageTag: string, actual: string, expected: string): boolean {
  const language = languageTag.toLowerCase().split('-')[0];
  if (language === 'ru') {
    return normalizeRussianAnswer(actual) === normalizeRussianAnswer(expected);
  }
  return normalizeSearchText(actual) === normalizeSearchText(expected);
}
