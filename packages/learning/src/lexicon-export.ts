import type { LexiconCourseImportService } from "./contracts";

export type LexiconCourseImport = Parameters<
  LexiconCourseImportService["importCourseEntry"]
>[0];

/** A course item as both the content pack and the stored rows describe it. */
export interface ExportableItem {
  itemId: string;
  kind: "word" | "expression";
  languageTag: string;
  displayText: string;
  gloss: string;
  stressText: string | null;
  grammaticalMetadata: Record<string, unknown>;
  license: Record<string, unknown>;
  provenance: Record<string, unknown>;
  audio: Record<string, unknown> | null;
}

/**
 * Limits of @ownwords/lexicon's course importer. A pack that exceeds them would
 * leave its items pending forever, so content validation refuses it up front.
 */
export const LEXICON_IMPORT_LIMITS = {
  languageTag: /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u,
  jsonCharacters: 10_000,
} as const;

export function lexiconCourseImport(
  ownerId: string,
  courseId: string,
  courseVersion: number,
  item: ExportableItem,
): LexiconCourseImport {
  // Per-item licence and provenance travel with the entry and its equivalent.
  const provenance = { content: item.provenance, license: item.license };
  const scriptData: Record<string, unknown> = {
    ...item.grammaticalMetadata,
    ...(item.stressText ? { stressText: item.stressText } : {}),
    ...(item.audio ? { audio: item.audio } : {}),
  };
  return {
    ownerId,
    courseId,
    courseVersion: String(courseVersion),
    itemId: item.itemId,
    kind: item.kind,
    provenance,
    senses: [
      {
        gloss: item.gloss,
        equivalents: [
          {
            languageTag: item.languageTag,
            text: item.displayText,
            fit: "exact",
            status: "confirmed",
            source: "course",
            provenance,
            scriptData,
          },
        ],
      },
    ],
  };
}

/** Returns why the Lexicon importer would refuse this item, or null when it is exportable. */
export function lexiconImportProblem(item: ExportableItem): string | null {
  if (!LEXICON_IMPORT_LIMITS.languageTag.test(item.languageTag)) {
    return "language tag is not accepted by the Lexicon";
  }
  const equivalent = lexiconCourseImport("owner", "course", 1, item).senses[0]!
    .equivalents[0]!;
  for (const [label, value] of [
    ["provenance and licence", equivalent.provenance],
    ["grammatical metadata, stress, and audio", equivalent.scriptData],
  ] as const) {
    if (JSON.stringify(value).length > LEXICON_IMPORT_LIMITS.jsonCharacters) {
      return `${label} exceed the Lexicon's ${LEXICON_IMPORT_LIMITS.jsonCharacters}-character limit`;
    }
  }
  return null;
}
