/**
 * The demo implementation of `OwnwordsClient`.
 *
 * It answers from the fixtures in `fixtures.ts`, in memory, for this browser
 * session only. Nothing is sent anywhere and nothing survives a reload, which
 * is deliberate: until the Lexicon and learning packages are mounted behind
 * HTTP, no screen should imply it is talking to a server.
 */

import {
  OwnwordsError,
  type EquivalentPatch,
  type OwnwordsClient,
} from "../client";
import type {
  AlphabetLetter,
  Course,
  Direction,
  DueQueue,
  Entry,
  EntryQuery,
  Language,
  LanguageProgress,
  LanguageTag,
  Lesson,
  MasteryBand,
  NewEntry,
  Page,
  PracticeCard,
  Preferences,
  ProgressSummary,
  ReferenceTopic,
  ReviewSubmission,
  Starter,
  SuggestionResult,
  UpcomingItem,
} from "../types";
import { forSearch, inWords } from "../../lib/text";
import { localId } from "../../lib/ids";
import {
  demoAlphabet,
  demoCourse,
  demoDue,
  demoEntries,
  demoLanguages,
  demoLesson,
  demoPreferences,
  demoReferenceTopics,
  demoStarters,
  demoSuggestions,
  demoUpcoming,
  type DemoCard,
} from "./fixtures";

export interface DemoClientOptions {
  /**
   * How long each simulated translation takes to come back, per language.
   * Tests pass zero; the running app keeps a short, visible wait so the
   * "waiting" state is real rather than decorative.
   */
  suggestionDelaysMs?: Record<string, number>;
  /** Languages the stand-in translator cannot answer for, to exercise failure. */
  failingLanguages?: readonly string[];
  /** The collection to start from. Defaults to the sample collection. */
  entries?: readonly Entry[];
}

const clone = <T>(value: T): T => structuredClone(value);

function copyEntry(entry: Entry): Entry {
  return clone(entry);
}

/** A session is sized by what is due, and said in words rather than counted. */
function estimateFor(cards: number): string {
  if (cards === 0) return "";
  const minutes = Math.max(1, Math.round(cards * 1.1));
  return minutes === 1
    ? "About a minute."
    : `About ${inWords(minutes)} minutes.`;
}

const native = demoLanguages.find(
  (language) => language.role === "native",
)?.code;

/** Retention the demo scheduler reports; when each is next due follows the practice queue. */
const retention: Omit<LanguageProgress, "nextDueAt">[] = [
  { language: "es", direction: "recognise", retention: 0.74 },
  { language: "es", direction: "produce", retention: 0.48 },
  { language: "ru", direction: "recognise", retention: 0.22 },
  { language: "ru", direction: "produce", retention: null },
];

const learning = new Set(
  demoLanguages
    .filter((language) => language.role === "learning")
    .map((language) => language.code),
);

/** Learn practises the language being learned; Maintain practises the rest. */
const inMode = (mode: "maintain" | "learn", card: DemoCard): boolean =>
  learning.has(card.language) === (mode === "learn");

/** Retrievability bands, on the thresholds the mastery meter colours by. */
function inBand(entry: Entry, band: MasteryBand): boolean {
  const readings = Object.values(entry.mastery)
    .flatMap((mastery) => [mastery.recognise, mastery.produce])
    .filter((value): value is number => value !== null);
  if (band === "weak") return readings.some((value) => value < 0.34);
  return readings.length > 0 && readings.every((value) => value >= 0.67);
}

export function createDemoClient(
  options: DemoClientOptions = {},
): OwnwordsClient {
  const delays = options.suggestionDelaysMs ?? { es: 900, ru: 1700 };
  const failing = new Set(options.failingLanguages ?? []);

  let entries: Entry[] = clone([...(options.entries ?? demoEntries)]);
  let preferences: Preferences = clone(demoPreferences);
  const due: DemoCard[] = clone(demoDue);
  const upcoming = clone(demoUpcoming);
  const reviewed = new Set<string>();

  const findEntry = (entryId: string): Entry => {
    const entry = entries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      throw new OwnwordsError(
        "not_found",
        "That entry is no longer in your Lexicon.",
        404,
      );
    }
    return entry;
  };

  const isUnverified = (entry: Entry): boolean =>
    entry.senses.some((sense) =>
      sense.equivalents.some(
        (equivalent) =>
          equivalent.state === "suggested" ||
          equivalent.state === "waiting" ||
          equivalent.state === "failed",
      ),
    );

  /** The cards still waiting in `cards` for this mode, whose entry is still in the Lexicon. */
  const pending = <T extends DemoCard>(
    cards: readonly T[],
    mode: "maintain" | "learn",
  ): T[] =>
    cards.filter(
      (card) =>
        inMode(mode, card) &&
        !reviewed.has(card.cardId) &&
        entries.some((entry) => entry.id === card.entryId),
    );

  const toPracticeCard = (card: DemoCard): PracticeCard => {
    const entry = findEntry(card.entryId);
    return {
      cardId: card.cardId,
      entryId: card.entryId,
      headword: entry.headword,
      language: card.language,
      promptLanguage: card.promptLanguage,
      direction: card.direction,
      prompt: card.prompt,
      answer: card.answer,
      hint: card.hint,
      note: entry.note,
    };
  };

  const toUpcoming = (card: DemoCard & { when: string }): UpcomingItem => ({
    when: card.when,
    headword: findEntry(card.entryId).headword,
    language: card.language,
    direction: card.direction,
  });

  return {
    async listLanguages(): Promise<Language[]> {
      return clone(demoLanguages);
    },

    async listEntries(query: EntryQuery = {}): Promise<Page<Entry>> {
      const search = query.search ? forSearch(query.search) : "";
      const items = entries.filter((entry) => {
        if (search && !forSearch(entry.headword).includes(search)) return false;
        if (query.kind && entry.kind !== query.kind) return false;
        if (query.unverifiedOnly && !isUnverified(entry)) return false;
        if (query.mastery && !inBand(entry, query.mastery)) return false;
        if (query.language) {
          const inEntry = entry.language === query.language;
          const inEquivalents = entry.senses.some((sense) =>
            sense.equivalents.some(
              (equivalent) => equivalent.language === query.language,
            ),
          );
          if (!inEntry && !inEquivalents) return false;
        }
        return true;
      });
      return { items: clone(items), total: entries.length };
    },

    async getEntry(entryId: string): Promise<Entry> {
      return copyEntry(findEntry(entryId));
    },

    async createEntry(input: NewEntry): Promise<Entry> {
      const senseId = localId("s");
      const entry: Entry = {
        id: localId("e"),
        headword: input.headword.trim(),
        note: input.note.trim(),
        kind: input.kind,
        language: input.language,
        version: 1,
        createdAt: new Date().toISOString(),
        senses: [
          {
            id: senseId,
            gloss: input.senseGloss?.trim() || input.headword.trim(),
            equivalents: input.suggestInto.map((language) => ({
              id: localId("q"),
              language,
              text: "",
              fit: null,
              state: "waiting" as const,
            })),
          },
        ],
        mastery: {},
      };
      entries = [entry, ...entries];
      return copyEntry(entry);
    },

    async requestSuggestions(input, into, onResult, signal): Promise<void> {
      await Promise.all(
        into.map(
          (language) =>
            new Promise<void>((resolve) => {
              const delay = delays[language] ?? 0;
              const finish = () => {
                if (signal?.aborted) return resolve();
                const result: SuggestionResult = failing.has(language)
                  ? {
                      language,
                      state: "failed",
                      text: "",
                      reason: "Translation failed. Nothing was dropped.",
                    }
                  : {
                      language,
                      state: "suggested",
                      text: demoSuggestions[language] ?? input.headword,
                    };
                onResult(result);
                resolve();
              };
              if (delay <= 0) {
                finish();
                return;
              }
              const timer = setTimeout(finish, delay);
              signal?.addEventListener("abort", () => {
                clearTimeout(timer);
                resolve();
              });
            }),
        ),
      );
    },

    async updateEquivalent(
      entryId: string,
      senseId: string,
      equivalentId: string,
      patch: EquivalentPatch,
    ): Promise<Entry> {
      const entry = findEntry(entryId);
      const sense = entry.senses.find((candidate) => candidate.id === senseId);
      const equivalent = sense?.equivalents.find(
        (candidate) => candidate.id === equivalentId,
      );
      if (!sense || !equivalent) {
        throw new OwnwordsError(
          "not_found",
          "That equivalent is no longer on this entry.",
          404,
        );
      }
      if (patch.text !== undefined) {
        equivalent.text = patch.text.trim();
        equivalent.state = "manual";
      }
      if (patch.fit !== undefined) equivalent.fit = patch.fit;
      if (patch.state !== undefined) equivalent.state = patch.state;
      entry.version += 1;
      return copyEntry(entry);
    },

    async retryTranslation(
      entryId: string,
      senseId: string,
      equivalentId: string,
    ): Promise<Entry> {
      const entry = findEntry(entryId);
      const sense = entry.senses.find((candidate) => candidate.id === senseId);
      const equivalent = sense?.equivalents.find(
        (candidate) => candidate.id === equivalentId,
      );
      if (!sense || !equivalent) {
        throw new OwnwordsError(
          "not_found",
          "That equivalent is no longer on this entry.",
          404,
        );
      }
      equivalent.state = "suggested";
      equivalent.text = demoSuggestions[equivalent.language] ?? equivalent.text;
      equivalent.fit = equivalent.fit ?? "exact";
      entry.version += 1;
      return copyEntry(entry);
    },

    async addSense(entryId: string, gloss: string): Promise<Entry> {
      const entry = findEntry(entryId);
      if (!gloss.trim()) {
        throw new OwnwordsError(
          "invalid_request",
          "A sense needs a gloss that says what it means.",
          400,
        );
      }
      entry.senses.push({
        id: localId("s"),
        gloss: gloss.trim(),
        equivalents: [],
      });
      entry.version += 1;
      return copyEntry(entry);
    },

    async listStarters(): Promise<Starter[]> {
      return demoStarters.map(({ id, headword, note, language }) => ({
        id,
        headword,
        note,
        language,
      }));
    },

    async addStarter(starterId: string): Promise<Entry> {
      const starter = demoStarters.find(
        (candidate) => candidate.id === starterId,
      );
      if (!starter) {
        throw new OwnwordsError(
          "not_found",
          "That starter expression is no longer offered.",
          404,
        );
      }
      const entry: Entry = {
        id: localId("e"),
        headword: starter.headword,
        note: starter.note,
        kind: starter.kind,
        language: starter.language,
        version: 1,
        createdAt: new Date().toISOString(),
        senses: [
          {
            id: localId("s"),
            gloss: starter.note,
            equivalents: starter.equivalents.map((equivalent) => ({
              ...equivalent,
              id: localId("q"),
            })),
          },
        ],
        mastery: {},
      };
      entries = [entry, ...entries];
      // Vetted equivalents are due at once, so there is practice on day one.
      for (const equivalent of starter.equivalents) {
        due.push({
          cardId: localId("c"),
          entryId: entry.id,
          language: equivalent.language,
          promptLanguage: starter.language,
          direction: "produce",
          prompt: starter.headword,
          answer: equivalent.text,
          hint: starter.note,
        });
      }
      return copyEntry(entry);
    },

    async getDueQueue(scope): Promise<DueQueue> {
      const coming = pending(upcoming, scope.mode);
      const cards = (scope.ahead ? coming : pending(due, scope.mode)).map(
        toPracticeCard,
      );
      return {
        cards,
        estimate: estimateFor(cards.length),
        comingUp: scope.ahead ? [] : coming.map(toUpcoming),
      };
    },

    async submitReview(submission: ReviewSubmission): Promise<void> {
      // "Again" keeps the card in this session, the way the scheduler does.
      if (submission.rating !== "again") reviewed.add(submission.cardId);
    },

    async getProgress(): Promise<ProgressSummary> {
      const practised = (card: DemoCard): LanguageTag =>
        card.language === native ? card.promptLanguage : card.language;
      const has = (
        cards: readonly DemoCard[],
        language: LanguageTag,
        direction: Direction,
      ): boolean =>
        pending(cards, "maintain").some(
          (card) =>
            practised(card) === language && card.direction === direction,
        );
      const nextDueFor = (
        language: LanguageTag,
        direction: Direction,
      ): string | null => {
        if (has(due, language, direction)) return new Date().toISOString();
        if (has(upcoming, language, direction))
          return new Date(Date.now() + 86_400_000).toISOString();
        return null;
      };
      return {
        estimate: estimateFor(pending(due, "maintain").length),
        comingUp: pending(upcoming, "maintain").map(toUpcoming),
        perLanguage: retention.map((row) => ({
          ...row,
          nextDueAt: nextDueFor(row.language, row.direction),
        })),
      };
    },

    async getCourse(): Promise<Course> {
      return clone(demoCourse);
    },

    async getLesson(lessonId: string): Promise<Lesson> {
      if (lessonId !== demoLesson.id) {
        throw new OwnwordsError(
          "not_found",
          "That lesson is not in the course yet.",
          404,
        );
      }
      return clone(demoLesson);
    },

    async completeLessonStep(): Promise<void> {
      // Recorded by the learning package once it is mounted.
    },

    async getAlphabet(): Promise<AlphabetLetter[]> {
      return clone(demoAlphabet);
    },

    async listReferenceTopics(): Promise<ReferenceTopic[]> {
      return clone(demoReferenceTopics);
    },

    async getPreferences(): Promise<Preferences> {
      return clone(preferences);
    },

    async savePreferences(next: Preferences): Promise<Preferences> {
      preferences = clone(next);
      return clone(preferences);
    },
  };
}
