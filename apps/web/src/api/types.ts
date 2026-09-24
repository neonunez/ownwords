/**
 * The shapes the screens exchange with the Ownwords backend.
 *
 * They are the screens' view of the contracts published by the API and the
 * domain packages (`apps/api`, `packages/lexicon`, `packages/learning`).
 * Nothing here talks to a network: the types describe the boundary,
 * `client.ts` declares it, `http/` answers it from the API, and `demo/`
 * answers it from local fixtures for tests and explicit previews. See
 * `docs/backend-boundary.md`.
 */

/** A configured language, identified by its BCP 47 tag. */
export type LanguageTag = string;

/** Practice runs in one direction at a time, and mastery is tracked per direction. */
export type Direction = "recognise" | "produce";

/** What the person stored: a single word, or a fixed expression. */
export type EntryKind = "word" | "expression";

/** How well an equivalent covers the meaning the person owns. */
export type Fit =
  "exact" | "broader" | "narrower" | "context-only" | "false-friend";

/** Where an equivalent came from, and whether the person has reviewed it. */
export type TranslationState =
  "suggested" | "confirmed" | "waiting" | "failed" | "manual";

/** How a language sits in the collection. */
export type LanguageRole = "native" | "maintained" | "learning";

export interface Language {
  code: LanguageTag;
  /** The language's own name, in that language. */
  name: string;
  role: LanguageRole;
  /** Written for display: "native", "intermediate", "learning · A0". */
  level: string;
}

export interface Equivalent {
  id: string;
  language: LanguageTag;
  /** Empty while a suggestion is still waiting, or after one failed. */
  text: string;
  fit: Fit | null;
  state: TranslationState;
  /** Server concurrency token; sent back when the equivalent is changed. */
  version: number;
  /** Set when the equivalent came from a course item rather than by hand. */
  courseItemId?: string;
}

export interface Sense {
  id: string;
  /** A short gloss in the entry's own language. Empty when none was given. */
  gloss: string;
  /** The equivalents in the other languages; the headword is not repeated. */
  equivalents: Equivalent[];
}

/**
 * How well one direction is held. A number is mean retrievability, 0–1; the
 * backend's per-entry reading is the scheduler's stage instead, written as a
 * word. `null` until the direction has been reviewed.
 */
export type MasteryReading = number | "learning" | "mastered" | null;

export interface Mastery {
  recognise: MasteryReading;
  produce: MasteryReading;
}

export interface Entry {
  id: string;
  headword: string;
  /** "What do you mean by it?" — the note that keeps false friends out. */
  note: string;
  kind: EntryKind;
  language: LanguageTag;
  senses: Sense[];
  /** Per language, per direction. A language absent here has no cards yet. */
  mastery: Record<LanguageTag, Mastery>;
  /** Server concurrency token; sent back on update and delete. */
  version: number;
  createdAt: string;
}

export interface EntryQuery {
  /** Matched accent- and case-insensitively against the headword. */
  search?: string;
  language?: LanguageTag;
  kind?: EntryKind;
  /** Only entries carrying an equivalent nobody has confirmed. */
  unverifiedOnly?: boolean;
  mastery?: MasteryBand;
  cursor?: string;
  limit?: number;
}

/**
 * How well an entry is held. `weak` ("needs practice"): something on it is due
 * for practice now. `strong` ("well known"): the scheduler counts something on
 * it as mastered.
 */
export type MasteryBand = "weak" | "strong";

export interface Page<T> {
  items: T[];
  /** Opaque continuation cursor; absent on the last page. */
  nextCursor?: string;
  /** Total the query matches, when the backend can supply it cheaply. */
  total?: number;
}

export interface NewEntry {
  headword: string;
  note: string;
  kind: EntryKind;
  language: LanguageTag;
  senseGloss?: string;
}

/** An equivalent added to a sense, as the person left it after reviewing it. */
export interface NewEquivalent {
  language: LanguageTag;
  /** Empty only for a translation that failed, which is kept rather than dropped. */
  text: string;
  state: Extract<
    TranslationState,
    "suggested" | "confirmed" | "manual" | "failed"
  >;
  fit?: Exclude<Fit, "false-friend">;
}

/**
 * An expression offered to an empty Lexicon. Its equivalents are vetted before
 * it is offered, so adding it gives practice something to ask on day one.
 */
export interface Starter {
  id: string;
  headword: string;
  note: string;
  language: LanguageTag;
}

export interface SuggestionResult {
  language: LanguageTag;
  state: Extract<TranslationState, "suggested" | "failed">;
  text: string;
  fit?: Exclude<Fit, "false-friend">;
  /** Present only when the suggestion failed, and always safe to show. */
  reason?: string;
}

/** One question the scheduler picked, in the format the tab asked for. */
export type PracticeFormat = "cloze" | "flashcard";

export interface PracticeCard {
  cardId: string;
  /** What the front of a flashcard shows. */
  headword: string;
  /** The language being practised. */
  language: LanguageTag;
  /** The language the prompt is written in; `null` for a gloss. */
  promptLanguage: LanguageTag | null;
  /** The language the answer is written in; `null` for a gloss. */
  answerLanguage: LanguageTag | null;
  direction: Direction;
  /** The sentence with the gap, or what to answer to. */
  prompt: string;
  answer: string;
  /** Other answers that also count. */
  accepted: string[];
  /** Shown after one wrong attempt, before the answer. */
  hint: string | null;
}

export interface PracticeScope {
  mode: "maintain" | "learn";
  /** The tab chooses the format; the scheduler chooses the content. */
  format: PracticeFormat;
  /**
   * One practice sitting. A card rated "again" comes back within the same
   * session, so every read and review in a sitting carries the same id.
   */
  sessionId: string;
  /** Ask for the cards coming up next, before they are due, instead of what is due now. */
  ahead?: boolean;
}

export interface DueQueue {
  cards: PracticeCard[];
  /** Written for display: "About four minutes." Empty when there are no cards. */
  estimate: string;
  /** What the scheduler will offer next, beyond these cards. */
  comingUp: UpcomingItem[];
  /** Whether cards can be practised before they are due. */
  aheadAvailable: boolean;
}

export interface UpcomingItem {
  /** Written, never a timestamp: "this evening", "tomorrow", "in 3 days". */
  when: string;
  /** `null` when the scheduler says when, but not which. */
  headword: string | null;
  language: LanguageTag;
  direction: Direction;
}

/** What a person did with one card. Mirrors the FSRS ratings the backend takes. */
export type ReviewRating = "again" | "hard" | "good" | "easy";

export interface ReviewSubmission {
  cardId: string;
  rating: ReviewRating;
  format: PracticeFormat;
  /** The practice sitting the card was answered in. */
  sessionId: string;
  /** Owner-scoped idempotency key. */
  submissionId: string;
}

export interface LanguageProgress {
  language: LanguageTag;
  direction: Direction;
  /** Mean retrievability of reviewed cards; `null` before the first review. */
  retention: number | null;
  /** ISO timestamp of the earliest card; `null` if there are no cards. */
  nextDueAt: string | null;
  /** Whether Maintain practice has a card in this language and direction to ask now. */
  dueNow: boolean;
}

/** Progress is retention and what is due next. It carries no card counts. */
export interface ProgressSummary {
  perLanguage: LanguageProgress[];
  /** How long the Maintain practice due now takes: "About four minutes." Empty when nothing is due. */
  estimate: string;
  /** What Maintain practice offers next. */
  comingUp: UpcomingItem[];
}

/* ---- Learn ------------------------------------------------------------- */

/** `open`: unlocked, not started, and not where the course carries on. */
export type UnitState = "done" | "current" | "open" | "locked";

export interface CourseUnit {
  id: string;
  number: number;
  title: string;
  /** What the unit makes sayable. */
  subtitle: string;
  state: UnitState;
  /** The lesson a tap on the unit opens; `null` while the unit is locked. */
  lessonId: string | null;
}

export interface CourseResume {
  unitId: string;
  unitNumber: number;
  /** The lesson to open. */
  lessonId: string;
  title: string;
  /** The step the person stopped on, written: "Hear it first". */
  step: string;
  /** 0–1 through the unit. */
  progress: number;
  canDo: string;
}

export interface Milestone {
  id: string;
  text: string;
  reached: boolean;
}

export interface Course {
  id: string;
  version: string;
  language: LanguageTag;
  title: string;
  /** Where to carry on; `null` once every lesson is finished. */
  resume: CourseResume | null;
  units: CourseUnit[];
  milestones: Milestone[];
}

export type LessonStepKind =
  "hear" | "rule" | "use" | "perception" | "alphabet";

export interface LessonItem {
  id: string;
  /** Written with the combining acute where the course marks stress. */
  text: string;
  meaning: string;
  /** "m.", "f.", "impf." — whatever the language needs. */
  grammar: string;
  /** Recorded human audio; `null` until a recording exists for the item. */
  audioUrl: string | null;
}

export interface LessonStep {
  id: string;
  kind: LessonStepKind;
  title: string;
  items?: LessonItem[];
  /** The rule of four lines. */
  lines?: string[];
  prompt?: string;
  options?: string[];
  answer?: string;
  /** Keyed by option, the response the course gives. */
  responses?: Record<string, string>;
}

export type LessonStatus = "not_started" | "in_progress" | "completed";

export interface Lesson {
  id: string;
  unitNumber: number;
  title: string;
  canDo: string;
  /** The course's language, for the `lang` of everything the lesson teaches. */
  language: LanguageTag;
  status: LessonStatus;
  /** The step the person reached last time, to carry on from; `null` to start. */
  currentStepId: string | null;
  steps: LessonStep[];
}

/** What finishing a lesson did to the Lexicon. */
export interface LessonCompletion {
  /**
   * `synced`: every item the lesson introduced is in the Lexicon. `pending`:
   * some are not yet; finishing the lesson again retries them.
   */
  lexicon: "synced" | "pending";
}

export interface AlphabetLetter {
  upper: string;
  lower: string;
  /** How it sounds, written in Latin letters. */
  sound: string;
  /** Set when the letter looks Latin but is not: "looks like B". */
  trap: string | null;
  /** True when it reads as the Latin letter it resembles. */
  sameAsLatin: boolean;
}

export interface ReferenceTopic {
  id: string;
  title: string;
  /** A Lucide icon name from the design system's set. */
  icon: string;
  summary: string;
  /** The unit that introduced it, written: "Unit 3". Empty when always open. */
  introducedIn: string;
  locked: boolean;
  /** What the topic holds so far, in course order. */
  items: ReferenceItem[];
}

export interface ReferenceItem {
  id: string;
  title: string;
  /** The written body, a line per paragraph; empty while locked. */
  lines: string[];
  locked: boolean;
}

/* ---- Account and preferences ------------------------------------------- */

/** The languages explanations can be written in. */
export type ExplanationLanguage = "en" | "es";

export interface Preferences {
  /** The language explanations are written in. */
  explanationsIn: ExplanationLanguage;
  audioInCourse: boolean;
  suggestTranslations: boolean;
  /** Reminders are asked for after install, never before. */
  reminders: "after-install" | "on" | "off";
}

/** A CEFR level, or the person's own language. */
export type LanguageLevel =
  "a0" | "a1" | "a2" | "b1" | "b2" | "c1" | "c2" | "native";

export interface ProfileLanguage {
  code: LanguageTag;
  /** Maintain a language already spoken, or learn one from zero. */
  kind: "maintain" | "learn";
  level: LanguageLevel;
}

/** What the first run asks: the languages and their levels, then three preferences. */
export interface Onboarding {
  languages: ProfileLanguage[];
  preferences: Omit<Preferences, "reminders">;
}

export interface Account {
  name: string;
  email: string;
}

export type Session =
  | { status: "signed-out" }
  | {
      status: "signed-in";
      account: Account;
      /** `null` until the first run has been completed. */
      onboarding: Onboarding | null;
    };

/** The account export, ready to save as a file. */
export interface AccountExport {
  filename: string;
  blob: Blob;
}
