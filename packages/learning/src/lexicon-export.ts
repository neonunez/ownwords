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
