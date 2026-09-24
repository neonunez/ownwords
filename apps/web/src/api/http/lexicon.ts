/**
 * The Lexicon's wire shapes, read and translated into the screens' types.
 *
 * The backend stores an entry as a meaning with equivalents in every language,
 * including the one it was written in. The screens show a headword in one
 * language and its equivalents in the others. The headword is the entry's
 * equivalent in its own language: an entry this app creates says which
 * language that is in its provenance, and a course import has only the one
 * language it teaches.
 */

import type {
  Direction,
  Entry,
  Equivalent,
  Fit,
  Mastery,
  MasteryReading,
  PracticeCard,
  PracticeFormat,
  ReviewRating,
  TranslationState,
} from "../types";
import {
  array,
  jsonOrNull,
  number,
  object,
  oneOf,
  optionalString,
  string,
  type Json,
} from "./read";

/* ---- wire shapes --------------------------------------------------------- */

export type WireFit =
  "exact" | "broader" | "narrower" | "context_only" | "false_friend";
export type WireDirection = "recognize" | "produce";

const wireFits: readonly WireFit[] = [
  "exact",
  "broader",
  "narrower",
  "context_only",
  "false_friend",
];
const statuses: readonly TranslationState[] = [
  "suggested",
  "confirmed",
  "waiting",
  "failed",
  "manual",
];
const levels = ["new", "learning", "mastered"] as const;

interface WireMastery {
  level: (typeof levels)[number];
}

export interface WireEquivalent {
  id: string;
  languageTag: string;
  text: string | null;
  fit: WireFit;
  status: TranslationState;
  scriptData: Json | null;
  /** `null` when the equivalent is not practised: unverified or a false friend. */
  mastery: Record<WireDirection, WireMastery | null> | null;
  version: number;
}

export interface WireSense {
  id: string;
  gloss: string | null;
  version: number;
  equivalents: WireEquivalent[];
}

export interface WireEntry {
  id: string;
  kind: "word" | "expression";
  note: string | null;
  source: string | null;
  provenance: Json | null;
  version: number;
  createdAt: string;
  senses: WireSense[];
}

function readMastery(value: unknown, path: string): WireMastery | null {
  if (value === null || value === undefined) return null;
  const record = object(value, path);
  return { level: oneOf(record.level, `${path}.level`, levels) };
}

function readEquivalent(value: unknown, path: string): WireEquivalent {
  const record = object(value, path);
  const mastery =
    record.mastery === null || record.mastery === undefined
      ? null
      : object(record.mastery, `${path}.mastery`);
  return {
    id: string(record.id, `${path}.id`),
    languageTag: string(record.languageTag, `${path}.languageTag`),
    text: optionalString(record.text, `${path}.text`),
    fit: oneOf(record.fit, `${path}.fit`, wireFits),
    status: oneOf(record.status, `${path}.status`, statuses),
    scriptData: jsonOrNull(record.scriptData),
    mastery: mastery && {
      recognize: readMastery(mastery.recognize, `${path}.mastery.recognize`),
      produce: readMastery(mastery.produce, `${path}.mastery.produce`),
    },
    version: number(record.version, `${path}.version`),
  };
}

function readSense(value: unknown, path: string): WireSense {
  const record = object(value, path);
  return {
    id: string(record.id, `${path}.id`),
    gloss: optionalString(record.gloss, `${path}.gloss`),
    version: number(record.version, `${path}.version`),
    equivalents: array(
      record.equivalents,
      `${path}.equivalents`,
      readEquivalent,
    ),
  };
}

export function readEntry(value: unknown, path = "entry"): WireEntry {
  const record = object(value, path);
  return {
    id: string(record.id, `${path}.id`),
    kind: oneOf(record.kind, `${path}.kind`, ["word", "expression"] as const),
    note: optionalString(record.note, `${path}.note`),
    source: optionalString(record.source, `${path}.source`),
    provenance: jsonOrNull(record.provenance),
    version: number(record.version, `${path}.version`),
    createdAt: string(record.createdAt, `${path}.createdAt`),
    senses: array(record.senses, `${path}.senses`, readSense),
  };
}

export function readEntryPage(value: unknown): {
  entries: WireEntry[];
  nextCursor: string | null;
} {
  const record = object(value, "page");
  const page = object(record.page, "page.page");
  return {
    entries: array(record.data, "page.data", readEntry),
    nextCursor: optionalString(page.nextCursor, "page.page.nextCursor"),
  };
}

/* ---- fit and direction --------------------------------------------------- */

export function fitFromWire(fit: WireFit): Fit {
  return fit === "context_only"
    ? "context-only"
    : fit === "false_friend"
      ? "false-friend"
      : fit;
}

export function fitToWire(fit: Fit): WireFit {
  return fit === "context-only"
    ? "context_only"
    : fit === "false-friend"
      ? "false_friend"
      : fit;
}

export function directionFromWire(direction: WireDirection): Direction {
  return direction === "recognize" ? "recognise" : "produce";
}

export function directionToWire(direction: Direction): WireDirection {
  return direction === "recognise" ? "recognize" : "produce";
}

export const ratingToWire: Record<ReviewRating, 1 | 2 | 3 | 4> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

/* ---- the headword -------------------------------------------------------- */

/** Written into an entry this app creates, so its headword language is known. */
export const WEB_PROVENANCE = "ownwords-web";

export function headwordProvenance(language: string): Json {
  return { createdBy: WEB_PROVENANCE, headwordLanguage: language };
}

/** The language an entry was written in. */
export function entryLanguage(entry: WireEntry): string {
  const declared = entry.provenance?.headwordLanguage;
  if (typeof declared === "string" && declared) return declared;
  const first = entry.senses[0]?.equivalents.find((item) => item.text);
  return (
    first?.languageTag ?? entry.senses[0]?.equivalents[0]?.languageTag ?? ""
  );
}

/** How an equivalent is written for a person: with the course's stress marks. */
function written(equivalent: WireEquivalent): string {
  const stressed = equivalent.scriptData?.stressText;
  if (typeof stressed === "string" && stressed) return stressed;
  return equivalent.text ?? "";
}

/** The equivalent in the entry's own language on one sense: the wording translated from. */
export function sourceEquivalent(
  entry: WireEntry,
  senseId: string,
): WireEquivalent | null {
  const language = entryLanguage(entry);
  const sense = entry.senses.find((candidate) => candidate.id === senseId);
  return (
    sense?.equivalents.find(
      (item) => item.languageTag === language && item.text,
    ) ?? null
  );
}

/** The headword as stored, without display marks: what a new sense repeats. */
export function headwordText(entry: WireEntry): string {
  const first = entry.senses[0];
  return (first && sourceEquivalent(entry, first.id)?.text) ?? "";
}

/* ---- the entry, as the screens see it ------------------------------------ */

const strength: Record<"learning" | "mastered", number> = {
  learning: 0,
  mastered: 1,
};

/** The weakest reading anything practised holds; `null` until something is. */
function weakest(readings: MasteryReading[]): MasteryReading {
  const practised = readings.filter(
    (reading): reading is "learning" | "mastered" =>
      reading === "learning" || reading === "mastered",
  );
  if (!practised.length) return null;
  return practised.reduce((low, next) =>
    strength[next] < strength[low] ? next : low,
  );
}

function reading(mastery: WireMastery | null): MasteryReading {
  return mastery === null || mastery.level === "new" ? null : mastery.level;
}

function toEquivalent(equivalent: WireEquivalent): Equivalent {
  const hasText = equivalent.text !== null;
  return {
    id: equivalent.id,
    language: equivalent.languageTag,
    text: written(equivalent),
    // A translation that is waiting or failed has no wording to fit yet.
    fit: hasText ? fitFromWire(equivalent.fit) : null,
    state: equivalent.status,
    version: equivalent.version,
  };
}

/**
 * `native` names the languages the person speaks natively; practising those
 * is not the point, so their mastery is left off the entry.
 */
export function toEntry(entry: WireEntry, native: ReadonlySet<string>): Entry {
  const language = entryLanguage(entry);
  const byLanguage = new Map<string, Record<Direction, MasteryReading[]>>();
  for (const sense of entry.senses) {
    for (const equivalent of sense.equivalents) {
      if (!equivalent.mastery || native.has(equivalent.languageTag)) continue;
      const held = byLanguage.get(equivalent.languageTag) ?? {
        recognise: [],
        produce: [],
      };
      held.recognise.push(reading(equivalent.mastery.recognize));
      held.produce.push(reading(equivalent.mastery.produce));
      byLanguage.set(equivalent.languageTag, held);
    }
  }
  const mastery: Record<string, Mastery> = {};
  for (const [code, held] of byLanguage) {
    mastery[code] = {
      recognise: weakest(held.recognise),
      produce: weakest(held.produce),
    };
  }

  const first = entry.senses[0];
  const headword = first ? sourceEquivalent(entry, first.id) : null;
  return {
    id: entry.id,
    headword: headword ? written(headword) : (first?.gloss ?? ""),
    note: entry.note ?? "",
    kind: entry.kind,
    language,
    version: entry.version,
    createdAt: entry.createdAt,
    mastery,
    senses: entry.senses.map((sense) => ({
      id: sense.id,
      gloss: sense.gloss ?? "",
      equivalents: sense.equivalents
        .filter((equivalent) => equivalent.languageTag !== language)
        .map(toEquivalent),
    })),
  };
}

/* ---- suggestions --------------------------------------------------------- */

export interface WireSuggestion {
  text: string;
  fit: Exclude<WireFit, "false_friend">;
}

export function readSuggestions(value: unknown): WireSuggestion[] {
  const record = object(value, "suggestions");
  return array(record.data, "suggestions.data", (item, path) => {
    const suggestion = object(item, path);
    return {
      text: string(suggestion.text, `${path}.text`),
      fit: oneOf(suggestion.fit, `${path}.fit`, [
        "exact",
        "broader",
        "narrower",
        "context_only",
      ] as const),
    };
  });
}

/* ---- practice ------------------------------------------------------------ */

interface WireDueCard {
  cardId: string;
  languageTag: string;
  direction: WireDirection;
  dueAt: string;
  revisit: boolean;
  target: string;
  prompt: { text: string; languageTag: string | null };
  cloze: {
    template: string;
    answer: string;
    accepted: string[];
    hint: string | null;
    languageTag: string;
  } | null;
}

export interface WireDueQueue {
  cards: WireDueCard[];
  nextDueAt: string | null;
}

export function readDueQueue(value: unknown): WireDueQueue {
  const record = object(value, "due");
  return {
    nextDueAt: optionalString(record.nextDueAt, "due.nextDueAt"),
    cards: array(record.data, "due.data", (item, path) => {
      const row = object(item, path);
      const card = object(row.card, `${path}.card`);
      const target = object(row.target, `${path}.target`);
      const prompt = object(row.prompt, `${path}.prompt`);
      const cloze =
        row.cloze === null || row.cloze === undefined
          ? null
          : object(row.cloze, `${path}.cloze`);
      return {
        cardId: string(card.id, `${path}.card.id`),
        languageTag: string(card.languageTag, `${path}.card.languageTag`),
        direction: oneOf(card.direction, `${path}.card.direction`, [
          "recognize",
          "produce",
        ] as const),
        dueAt: string(card.dueAt, `${path}.card.dueAt`),
        revisit: row.revisit === true,
        target: string(target.text, `${path}.target.text`),
        prompt: {
          text: string(prompt.text, `${path}.prompt.text`),
          languageTag:
            prompt.type === "equivalent"
              ? string(prompt.languageTag, `${path}.prompt.languageTag`)
              : null,
        },
        cloze: cloze && {
          template: string(cloze.template, `${path}.cloze.template`),
          answer: string(cloze.answer, `${path}.cloze.answer`),
          accepted: array(
            cloze.acceptedAnswers,
            `${path}.cloze.acceptedAnswers`,
            string,
          ),
          hint: optionalString(cloze.hint, `${path}.cloze.hint`),
          languageTag: string(cloze.languageTag, `${path}.cloze.languageTag`),
        },
      };
    }),
  };
}

/** Revisits of a card missed this session first, then whatever is most overdue. */
export function byUrgency(left: WireDueCard, right: WireDueCard): number {
  if (left.revisit !== right.revisit) return left.revisit ? -1 : 1;
  return left.dueAt.localeCompare(right.dueAt);
}

export function toPracticeCard(
  card: WireDueCard,
  format: PracticeFormat,
): PracticeCard {
  const direction = directionFromWire(card.direction);
  if (format === "cloze" && card.cloze) {
    return {
      cardId: card.cardId,
      language: card.languageTag,
      direction,
      headword: card.target,
      promptLanguage: card.cloze.languageTag,
      answerLanguage: card.cloze.languageTag,
      prompt: card.cloze.template.replace("{{blank}}", "___"),
      answer: card.cloze.answer,
      accepted: card.cloze.accepted,
      hint: card.cloze.hint,
    };
  }
  // Producing answers the prompt with the practised word; recognising
  // answers the practised word with what it means.
  const produce = card.direction === "produce";
  const front = produce ? card.prompt.text : card.target;
  return {
    cardId: card.cardId,
    language: card.languageTag,
    direction,
    headword: front,
    promptLanguage: produce ? card.prompt.languageTag : card.languageTag,
    answerLanguage: produce ? card.languageTag : card.prompt.languageTag,
    prompt: front,
    answer: produce ? card.target : card.prompt.text,
    accepted: [],
    hint: null,
  };
}
