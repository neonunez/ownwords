const BASE_WITH_MARKS = /(\P{M})(\p{M}+)/gu;
const LATIN_LETTER = /^\p{Script=Latin}$/u;
const CYRILLIC_LETTER = /^\p{Script=Cyrillic}$/u;
const CYRILLIC_STRESS = /[̀́]/gu;
const SPANISH_TILDE = "̃";
const RUSSIAN_STRESS = /́/gu;
const SPACES = /\s+/gu;

function foldSearchMarks(base: string, marks: string): string {
  if (LATIN_LETTER.test(base))
    return base === "n" && marks.includes(SPANISH_TILDE)
      ? base + SPANISH_TILDE
      : base;
  if (CYRILLIC_LETTER.test(base))
    return base + marks.replace(CYRILLIC_STRESS, "");
  return base + marks;
}

/**
 * Search ignores case and Latin diacritics (accents, diaeresis, tildes, cedillas) except Spanish ñ, and strips
 * only stress marks from Cyrillic so ё and й stay distinct. Other scripts keep their marks.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .toLocaleLowerCase("und")
    .replace(BASE_WITH_MARKS, (_match, base: string, marks: string) =>
      foldSearchMarks(base, marks),
    )
    .normalize("NFC")
    .replace(SPACES, " ")
    .trim();
}

/** Answer checks ignore case and spacing and stay diacritic-sensitive, except optional Russian stress marks. */
export function normalizeAnswer(languageTag: string, value: string): string {
  const language = languageTag.toLowerCase().split("-")[0];
  const decomposed = value.normalize("NFD");
  return (
    language === "ru" ? decomposed.replace(RUSSIAN_STRESS, "") : decomposed
  )
    .normalize("NFC")
    .toLocaleLowerCase(language)
    .replace(SPACES, " ")
    .trim();
}

export function answersMatch(
  languageTag: string,
  actual: string,
  expected: string,
): boolean {
  return (
    normalizeAnswer(languageTag, actual) ===
    normalizeAnswer(languageTag, expected)
  );
}
