/**
 * The one boundary between the Ownwords front end and its backend.
 *
 * Every screen reaches the collection, the scheduler and the course through
 * this interface and nothing else. Today it is answered by the demo
 * implementation in `demo/`, which reads local fixtures; when the Lexicon and
 * learning packages are mounted behind HTTP, an `HttpOwnwordsClient` answers
 * the same interface and no screen changes. `docs/backend-boundary.md` maps
 * each method onto the route that will serve it.
 */

import type {
  AlphabetLetter,
  Course,
  DueQueue,
  Entry,
  EntryQuery,
  Fit,
  Language,
  Lesson,
  NewEntry,
  Page,
  PracticeScope,
  Preferences,
  ProgressSummary,
  ReferenceTopic,
  ReviewSubmission,
  Starter,
  SuggestionResult,
} from "./types";

/** The error every implementation throws, shaped like the backend's body. */
export class OwnwordsError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = "OwnwordsError";
    this.code = code;
    this.status = status;
  }
}

export interface EquivalentPatch {
  text?: string;
  fit?: Fit;
  state?: Extract<"confirmed" | "manual", string>;
}

export interface OwnwordsClient {
  /* ---- the collection -------------------------------------------------- */

  listLanguages(): Promise<Language[]>;
  listEntries(query?: EntryQuery): Promise<Page<Entry>>;
  getEntry(entryId: string): Promise<Entry>;
  createEntry(input: NewEntry): Promise<Entry>;

  /**
   * Ask for equivalents in the given languages. Resolves once for each
   * language, through `onResult`, so the review screen can move a row from
   * "waiting" to "suggested" or "failed" as each answer arrives.
   */
  requestSuggestions(
    input: Pick<NewEntry, "headword" | "language" | "note">,
    into: readonly string[],
    onResult: (result: SuggestionResult) => void,
    signal?: AbortSignal,
  ): Promise<void>;

  updateEquivalent(
    entryId: string,
    senseId: string,
    equivalentId: string,
    patch: EquivalentPatch,
  ): Promise<Entry>;

  retryTranslation(
    entryId: string,
    senseId: string,
    equivalentId: string,
  ): Promise<Entry>;

  /** The gloss is required; a blank one is refused rather than stored. */
  addSense(entryId: string, gloss: string): Promise<Entry>;

  /** The three expressions an empty Lexicon offers, and adding one of them. */
  listStarters(): Promise<Starter[]>;
  addStarter(starterId: string): Promise<Entry>;

  /* ---- practice and progress ------------------------------------------- */

  getDueQueue(scope: PracticeScope): Promise<DueQueue>;
  submitReview(submission: ReviewSubmission): Promise<void>;
  getProgress(): Promise<ProgressSummary>;

  /* ---- the course ------------------------------------------------------ */

  getCourse(): Promise<Course>;
  getLesson(lessonId: string): Promise<Lesson>;
  completeLessonStep(lessonId: string, stepId: string): Promise<void>;
  getAlphabet(): Promise<AlphabetLetter[]>;
  listReferenceTopics(): Promise<ReferenceTopic[]>;

  /* ---- preferences ----------------------------------------------------- */

  getPreferences(): Promise<Preferences>;
  savePreferences(next: Preferences): Promise<Preferences>;
}
