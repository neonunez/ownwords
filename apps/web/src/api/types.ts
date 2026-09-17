/**
 * The shapes the front end exchanges with the Ownwords backend.
 *
 * These mirror the contracts published by the domain packages
 * (`packages/lexicon`, `packages/learning`). Nothing here talks to a network:
 * the types describe the boundary, `client.ts` declares it, and the demo
 * implementation in `demo/` answers it from local fixtures until the HTTP
 * client lands. See `docs/backend-boundary.md`.
 */

/** A configured language, identified by its BCP 47 tag. */
export type LanguageTag = string;

/** Practice runs in one direction at a time, and mastery is tracked per direction. */
export type Direction = 'recognise' | 'produce';

/** What the person stored: a single word, or a fixed expression. */
export type EntryKind = 'word' | 'expression';

/** How well an equivalent covers the meaning the person owns. */
export type Fit = 'exact' | 'broader' | 'narrower' | 'context-only' | 'false-friend';

/** Where an equivalent came from, and whether the person has reviewed it. */
export type TranslationState = 'suggested' | 'confirmed' | 'waiting' | 'failed' | 'manual';

/** How a language sits in the collection. */
export type LanguageRole = 'native' | 'maintained' | 'learning';

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
  /** Set when the equivalent came from a course item rather than by hand. */
  courseItemId?: string;
}

export interface Sense {
  id: string;
  /** A short gloss in the entry's own language. */
  gloss: string;
  equivalents: Equivalent[];
}

export interface Mastery {
  /** Mean retrievability, 0–1. `null` until the direction has been reviewed. */
  recognise: number | null;
  produce: number | null;
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
  cursor?: string;
  limit?: number;
}

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
  /** The languages to suggest equivalents in; empty means suggest nothing. */
  suggestInto: LanguageTag[];
  senseGloss?: string;
}

export interface SuggestionResult {
  language: LanguageTag;
  state: Extract<TranslationState, 'suggested' | 'failed'>;
  text: string;
  /** Present only when the suggestion failed, and always safe to show. */
  reason?: string;
}

/** One question the scheduler picked, in the format the tab asked for. */
export type PracticeFormat = 'cloze' | 'flashcard';

export interface PracticeCard {
  cardId: string;
  entryId: string;
  headword: string;
  /** The language the answer is written in. */
  language: LanguageTag;
  /** The language the prompt is written in. */
  promptLanguage: LanguageTag;
  direction: Direction;
  /** The sentence with the gap, or the headword for a flashcard. */
  prompt: string;
  answer: string;
  /** Shown after one wrong attempt, before the answer. */
  hint: string | null;
  note: string;
}

export interface DueQueue {
  cards: PracticeCard[];
  /** Written for display: "About four minutes." */
  estimate: string;
  /** What the scheduler will offer next when the queue is empty. */
  comingUp: UpcomingItem[];
}

export interface UpcomingItem {
  /** Written, never a timestamp: "this evening", "tomorrow", "in 3 days". */
  when: string;
  headword: string;
  language: LanguageTag;
  direction: Direction;
}

/** What a person did with one card. Mirrors the FSRS ratings the backend takes. */
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewSubmission {
  cardId: string;
  rating: ReviewRating;
  format: PracticeFormat;
  /** Owner-scoped idempotency key. */
  submissionId: string;
}

export interface LanguageProgress {
  language: LanguageTag;
  direction: Direction;
  /** Mean retrievability of reviewed cards; `null` before the first review. */
  retention: number | null;
  /** ISO timestamp; in the past means practice is due now. `null` if no cards. */
  nextDueAt: string | null;
}

export interface ProgressSummary {
  perLanguage: LanguageProgress[];
  /** How many cards are due across every maintained language, right now. */
  dueNow: number;
  estimate: string;
  comingUp: UpcomingItem[];
}

/* ---- Learn ------------------------------------------------------------- */

export type UnitState = 'done' | 'current' | 'locked';

export interface CourseUnit {
  id: string;
  number: number;
  title: string;
  /** What the unit makes sayable. */
  subtitle: string;
  state: UnitState;
}

export interface CourseResume {
  unitId: string;
  unitNumber: number;
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
  resume: CourseResume;
  units: CourseUnit[];
  milestones: Milestone[];
}

export type LessonStepKind = 'hear' | 'rule' | 'use' | 'perception';

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

export interface Lesson {
  id: string;
  unitNumber: number;
  title: string;
  canDo: string;
  steps: LessonStep[];
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
}

/* ---- Preferences ------------------------------------------------------- */

export interface Preferences {
  /** The language explanations are written in. */
  explanationsIn: LanguageTag;
  audioInCourse: boolean;
  suggestTranslations: boolean;
  /** Reminders are asked for after install, never before. */
  reminders: 'after-install' | 'on' | 'off';
}
