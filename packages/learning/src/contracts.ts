export interface LearningBindings {
  DB: D1Database;
}

export interface LearningVariables {
  /** Set only by the application's verified Better Auth middleware. */
  userId: string;
}

export interface LearningEnv {
  Bindings: LearningBindings;
  Variables: LearningVariables;
}

/** Stable identity of a course item. Versions never change after publication. */
export interface LearningItemIdentity {
  courseId: string;
  version: number;
  itemId: string;
}

export interface LexiconEquivalentInput {
  languageTag: string;
  text?: string | null;
  fit?: "exact" | "broader" | "narrower" | "context_only" | "false_friend";
  status: "suggested" | "confirmed" | "waiting" | "failed" | "manual";
  note?: string | null;
  source?: string | null;
  provenance?: Record<string, unknown> | null;
  scriptData?: Record<string, unknown> | null;
}

export interface LexiconSenseInput {
  gloss?: string | null;
  note?: string | null;
  equivalents: LexiconEquivalentInput[];
}

/**
 * Structurally matches @ownwords/lexicon's LexiconCourseImportService so the
 * composition root can inject it without either package importing the other.
 * The stable owner/course/version/item tuple is the idempotency key.
 */
export interface LexiconCourseImportService {
  importCourseEntry(input: {
    ownerId: string;
    courseId: string;
    courseVersion: string;
    itemId: string;
    kind: "word" | "expression";
    note?: string | null;
    provenance: Record<string, unknown>;
    senses: LexiconSenseInput[];
  }): Promise<{ entryId: string; created: boolean }>;
}

export interface LearningPracticePrompt {
  id: string;
  format: "cloze" | "flashcard";
  payload: Readonly<Record<string, unknown>>;
}

/**
 * Adapter to the shared Lexicon scheduler. Learning deliberately owns no due
 * date or review-state tables.
 */
export interface LearningPracticeSource {
  listDue(input: {
    userId: string;
    languageTag: string;
    limit: number;
  }): Promise<readonly LearningPracticePrompt[]>;
}

export interface CreateLearningRoutesOptions {
  lexiconImporter: LexiconCourseImportService;
  practiceSource: LearningPracticeSource;
  clock?: () => Date;
}
