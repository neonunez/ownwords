/**
 * The one boundary between the Ownwords front end and its backend.
 *
 * Every screen reaches the account, the collection, the scheduler and the
 * course through this interface and nothing else. The app is answered by
 * `http/`, which talks to the Ownwords API; `demo/` answers the same interface
 * from local fixtures, and is used only by tests and by an explicitly built
 * preview. `docs/backend-boundary.md` maps each method onto the route that
 * serves it.
 */

import type {
  AccountExport,
  AlphabetLetter,
  Course,
  DueQueue,
  Entry,
  EntryKind,
  EntryQuery,
  Fit,
  Language,
  Lesson,
  LessonCompletion,
  NewEntry,
  NewEquivalent,
  Onboarding,
  Page,
  PracticeScope,
  Preferences,
  ProgressSummary,
  ReferenceTopic,
  ReviewSubmission,
  Session,
  Starter,
  SuggestionResult,
} from "./types";

/**
 * The error every implementation throws. `code` and `status` come from the
 * backend's `{ "error": { "code", "message" } }` body where there is one;
 * `message` is always written for a person and safe to show.
 */
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

/** Whether an error means the session has ended and the person must sign in. */
export function isSignedOut(error: unknown): boolean {
  return error instanceof OwnwordsError && error.status === 401;
}

export interface EquivalentPatch {
  /** The version last read; a newer one on the server means somebody changed it first. */
  version: number;
  text?: string;
  fit?: Fit;
  state?: Extract<"confirmed" | "manual", string>;
}

export interface EntryPatch {
  version: number;
  note?: string;
  kind?: EntryKind;
}

export interface OwnwordsClient {
  /**
   * `http` talks to the Ownwords API. `demo` answers from fixtures in memory
   * and keeps nothing; the app says so wherever that matters.
   */
  readonly kind: "http" | "demo";

  /* ---- the account ----------------------------------------------------- */

  getSession(): Promise<Session>;
  /** Accept an invitation for one email address, ahead of its first sign-in. */
  redeemInvitation(code: string, email: string): Promise<void>;
  /** Where to send the browser to sign in with Google. */
  startGoogleSignIn(): Promise<string>;
  signInWithPasskey(): Promise<void>;
  /** Registers a passkey for the signed-in account on this device. */
  addPasskey(): Promise<void>;
  signOut(): Promise<void>;
  /** The first run: languages and their levels, then three preferences. */
  saveOnboarding(input: Onboarding): Promise<Onboarding>;
  exportAccount(): Promise<AccountExport>;
  /**
   * Calls `listener` whenever the backend says the session has ended, so the
   * app can ask the person to sign in again. Returns the unsubscribe.
   */
  onSignedOut(listener: () => void): () => void;

  /* ---- the collection -------------------------------------------------- */

  listLanguages(): Promise<Language[]>;
  listEntries(query?: EntryQuery): Promise<Page<Entry>>;
  getEntry(entryId: string): Promise<Entry>;
  /** Stores the headword on its own; equivalents are added after review. */
  createEntry(input: NewEntry): Promise<Entry>;
  /** Changes the note or the kind; `version` is the one last read. */
  updateEntry(entryId: string, patch: EntryPatch): Promise<Entry>;
  /** Removes an entry; `version` is the one last read. */
  deleteEntry(entryId: string, version: number): Promise<void>;

  /**
   * Ask for equivalents of a stored entry's headword in the given languages.
   * Resolves once for each language, through `onResult`, so the review screen
   * can move a row from "waiting" to "suggested" or "failed" as each answer
   * arrives. Nothing is stored: the person reviews each one first.
   */
  requestSuggestions(
    entry: Entry,
    into: readonly string[],
    onResult: (result: SuggestionResult) => void,
    signal?: AbortSignal,
  ): Promise<void>;

  /** Adds reviewed equivalents to one sense. */
  addEquivalents(
    entryId: string,
    senseId: string,
    equivalents: readonly NewEquivalent[],
  ): Promise<Entry>;

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

  /**
   * The expressions an empty Lexicon offers, and adding one of them. Empty
   * when the backend offers none.
   */
  listStarters(): Promise<Starter[]>;
  addStarter(starterId: string): Promise<Entry>;

  /* ---- practice and progress ------------------------------------------- */

  getDueQueue(scope: PracticeScope): Promise<DueQueue>;
  submitReview(submission: ReviewSubmission): Promise<void>;
  getProgress(): Promise<ProgressSummary>;

  /* ---- the course ------------------------------------------------------ */

  /** The course for the language being learned; `null` when none is published. */
  getCourse(): Promise<Course | null>;
  getLesson(lessonId: string): Promise<Lesson>;
  /** Records that the person reached a step. Steps are recorded in order. */
  completeLessonStep(lessonId: string, stepId: string): Promise<void>;
  /** Finishes a lesson whose every step was reached; its items join the Lexicon. */
  completeLesson(lessonId: string): Promise<LessonCompletion>;
  getAlphabet(): Promise<AlphabetLetter[]>;
  listReferenceTopics(): Promise<ReferenceTopic[]>;

  /* ---- preferences ----------------------------------------------------- */

  getPreferences(): Promise<Preferences>;
  savePreferences(next: Preferences): Promise<Preferences>;
}
