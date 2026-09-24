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
