import type { Hono } from "hono";

export type EntryKind = "word" | "expression";
export type FitLabel =
  "exact" | "broader" | "narrower" | "context_only" | "false_friend";
export type TranslationStatus =
  "suggested" | "confirmed" | "waiting" | "failed" | "manual";
export type PracticeDirection = "recognize" | "produce";
export type PracticeFormat = "flashcard" | "cloze";
export type ReviewRating = 1 | 2 | 3 | 4;

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export interface LexiconBindings {
  DB: D1Database;
}

export interface LexiconVariables {
  /** Set only by the verified authentication middleware mounted by the API shell. */
  userId: string;
}

export type LexiconEnv = {
  Bindings: LexiconBindings;
  Variables: LexiconVariables;
};

export type LexiconRoutes = Hono<LexiconEnv>;

export interface EquivalentInput {
  languageTag: string;
  text?: string | null | undefined;
  fit?: FitLabel;
  status: TranslationStatus;
  note?: string | null | undefined;
  source?: string | null | undefined;
  provenance?: Record<string, unknown> | null | undefined;
  scriptData?: Record<string, unknown> | null | undefined;
}

export interface SenseInput {
  gloss?: string | null | undefined;
  note?: string | null | undefined;
  equivalents: EquivalentInput[];
}

export interface CourseLexiconImport {
  ownerId: string;
  courseId: string;
  courseVersion: string;
  itemId: string;
  kind: EntryKind;
  note?: string | null | undefined;
  provenance: Record<string, unknown>;
  senses: SenseInput[];
}

export interface CourseLexiconImportResult {
  entryId: string;
  created: boolean;
}

/**
 * Inject this into the learning package. The caller retries the same stable tuple safely;
 * no learning-owned table is read or written by the implementation.
 */
export interface LexiconCourseImportService {
  importCourseEntry(
    input: CourseLexiconImport,
  ): Promise<CourseLexiconImportResult>;
}

export interface TranslationSuggestion {
  text: string;
  fit: Exclude<FitLabel, "false_friend">;
  note?: string;
  provenance?: Record<string, unknown>;
}

export interface TranslationSuggestionRequest {
  sourceLanguage: string;
  targetLanguage: string;
  text: string;
  sense?: string | undefined;
}

export interface TranslationProvider {
  readonly id: string;
  readonly version: string;
  suggest(
    request: TranslationSuggestionRequest,
  ): Promise<TranslationSuggestion[]>;
}

export interface CreateLexiconRoutesOptions {
  clock?: Clock;
  idGenerator?: IdGenerator;
  translationProvider?: TranslationProvider;
  wrongAnswerDelayMs?: number;
}

export interface CreateCourseImporterOptions {
  db: D1Database;
  clock?: Clock;
  idGenerator?: IdGenerator;
}

export interface LexiconErrorBody {
  error: {
    code: string;
    message: string;
  };
}
