/** A language's own name, in that language: "Español", "Русский". */
export function ownName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code);
    if (name && name !== code) {
      return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
    }
  } catch {
    // An unknown tag falls through to the tag itself.
  }
  return code.toUpperCase();
}

/** A language's name in English, the app's own language: "Spanish", "Russian". */
export function englishName(code: string): string {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    if (name && name !== code) return name;
  } catch {
    // An unknown tag falls through to the tag itself.
  }
  return code.toUpperCase();
}

/**
 * The languages a person can keep up in Maintain: those written in the Latin
 * or Cyrillic alphabets. The app draws them in its own typeface, whose subsets
 * cover exactly these two scripts, and the Lexicon's search and answer rules
 * are written for them. A language in another script is left out until the
 * app can draw and search it properly, rather than offered and shown badly.
 */
export const MAINTAINABLE: readonly string[] = (
  "af be bg bs ca cs cy da de en es et eu fi fil fr ga gl hr hu id " +
  "is it lt lv mk ms mt nl no pl pt ro ru sk sl sq sr sv sw tr uk"
).split(" ");

/**
 * The languages that can be learned from zero: one per published course.
 * Russian is the only course so far; the backend has no other to serve.
 */
export const LEARNABLE: readonly string[] = ["ru"];

/** The most languages one profile holds, as the backend counts them. */
export const MOST_LANGUAGES = 12;

/** Sorts language tags by their own names, the way a person scans for theirs. */
export function byOwnName(codes: readonly string[]): string[] {
  return [...codes].sort((left, right) =>
    ownName(left).localeCompare(ownName(right), "en"),
  );
}
