const REMOVABLE_ACCENTS = /[\u0300\u0301\u0302]/gu;
const RUSSIAN_STRESS = /\u0301/gu;
const SPACES = /\s+/gu;

/**
 * Search ignores case and vowel accent/stress marks while preserving meaningful letters:
 * Spanish ñ remains distinct from n and Russian ё remains distinct from е.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .toLocaleLowerCase('und')
    .replace(REMOVABLE_ACCENTS, '')
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
