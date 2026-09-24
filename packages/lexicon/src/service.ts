import { encodeJson, first } from "./db.js";
import { normalizeSearchText } from "./normalize.js";
import { cryptoIdGenerator, iso, systemClock } from "./runtime.js";
import { newStoredCard } from "./scheduler.js";
import type {
  Clock,
  CourseLexiconImport,
  CourseLexiconImportResult,
  CreateCourseImporterOptions,
  EntryKind,
  IdGenerator,
  LexiconCourseImportService,
  SenseInput,
} from "./types.js";
import {
  InputError,
  enumValue,
  jsonRecord,
  kinds,
  optionalString,
  parseSense,
} from "./validation.js";

export interface CreateEntryInput {
  kind: EntryKind;
  note?: string | null | undefined;
  source?: string | null | undefined;
  provenance?: Record<string, unknown> | null | undefined;
  senses: SenseInput[];
}

export interface CreatedEntry {
  id: string;
  version: number;
}

export async function createEntry(
  db: D1Database,
  ownerId: string,
  input: CreateEntryInput,
  clock: Clock,
  ids: IdGenerator,
): Promise<CreatedEntry> {
  const now = clock.now();
  const entryId = ids.next();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO lexicon_entries
          (id, owner_id, kind, note, source, provenance_json, human_edited, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
      )
      .bind(
        entryId,
        ownerId,
        input.kind,
        input.note ?? null,
        input.source ?? null,
        encodeJson(input.provenance),
        iso(now),
        iso(now),
      ),
  ];
  appendSenseStatements(
    statements,
    db,
    ownerId,
    entryId,
    input.senses,
    now,
    ids,
    true,
  );
  await db.batch(statements);
  return { id: entryId, version: 1 };
}

export function createCourseLexiconImporter(
  options: CreateCourseImporterOptions,
): LexiconCourseImportService {
  const clock = options.clock ?? systemClock;
  const ids = options.idGenerator ?? cryptoIdGenerator;
  return {
    async importCourseEntry(
      input: CourseLexiconImport,
    ): Promise<CourseLexiconImportResult> {
      const normalized = validateCourseImport(input);
      const existing = await findCourseImport(options.db, normalized);
      if (existing !== null)
        return { entryId: existing.entry_id, created: false };

      const now = clock.now();
      const entryId = ids.next();
      const statements: D1PreparedStatement[] = [
        options.db
          .prepare(
            `INSERT INTO lexicon_entries
              (id, owner_id, kind, note, source, provenance_json, human_edited, version, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'course', ?, 0, 1, ?, ?)`,
          )
          .bind(
            entryId,
            normalized.ownerId,
            normalized.kind,
            normalized.note ?? null,
            JSON.stringify(normalized.provenance),
            iso(now),
            iso(now),
          ),
      ];
      appendSenseStatements(
        statements,
        options.db,
        normalized.ownerId,
        entryId,
        normalized.senses,
        now,
        ids,
        false,
      );
      statements.push(
        options.db
          .prepare(
            `INSERT INTO lexicon_course_imports
              (owner_id, course_id, course_version, item_id, entry_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            normalized.ownerId,
            normalized.courseId,
            normalized.courseVersion,
            normalized.itemId,
            entryId,
            iso(now),
          ),
      );
      try {
        await options.db.batch(statements);
        return { entryId, created: true };
      } catch (error) {
        // A concurrent retry may have won the unique course identity. D1 batch is atomic,
        // so this attempt either fully committed or left no partial Lexicon rows.
        const winner = await findCourseImport(options.db, normalized);
        if (winner !== null)
          return { entryId: winner.entry_id, created: false };
        throw error;
      }
    },
  };
}

interface ImportRow {
  entry_id: string;
}

async function findCourseImport(
  db: D1Database,
  input: CourseLexiconImport,
): Promise<ImportRow | null> {
  return await first<ImportRow>(
    db
      .prepare(
        `SELECT entry_id FROM lexicon_course_imports
          WHERE owner_id = ? AND course_id = ? AND course_version = ? AND item_id = ?`,
      )
      .bind(input.ownerId, input.courseId, input.courseVersion, input.itemId),
  );
}

function appendSenseStatements(
  statements: D1PreparedStatement[],
  db: D1Database,
  ownerId: string,
  entryId: string,
  senses: SenseInput[],
  now: Date,
  ids: IdGenerator,
  humanEdited: boolean,
): void {
  senses.forEach((sense, position) => {
    const senseId = ids.next();
    statements.push(
      db
        .prepare(
          `INSERT INTO lexicon_senses
            (id, owner_id, entry_id, gloss, note, position, human_edited, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(
          senseId,
          ownerId,
          entryId,
          sense.gloss ?? null,
          sense.note ?? null,
          position,
          humanEdited ? 1 : 0,
          iso(now),
          iso(now),
        ),
    );
    for (const equivalent of sense.equivalents) {
      const equivalentId = ids.next();
      statements.push(
        db
          .prepare(
            `INSERT INTO lexicon_equivalents
              (id, owner_id, sense_id, language_tag, text, search_text, fit, status, note,
               source, provenance_json, script_data_json, human_edited, version, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .bind(
            equivalentId,
            ownerId,
            senseId,
            equivalent.languageTag,
            equivalent.text ?? null,
            equivalent.text == null
              ? null
              : normalizeSearchText(equivalent.text),
            equivalent.fit ?? "exact",
            equivalent.status,
            equivalent.note ?? null,
            equivalent.source ?? null,
            encodeJson(equivalent.provenance),
            encodeJson(equivalent.scriptData),
            humanEdited || equivalent.status === "manual" ? 1 : 0,
            iso(now),
            iso(now),
          ),
      );
      if (isPracticeEligible(equivalent.status, equivalent.fit ?? "exact")) {
        appendCardStatements(statements, db, ownerId, equivalentId, now, ids);
      }
    }
  });
}

export function appendCardStatements(
  statements: D1PreparedStatement[],
  db: D1Database,
  ownerId: string,
  equivalentId: string,
  now: Date,
  ids: IdGenerator,
): void {
  const initial = newStoredCard(now);
  for (const direction of ["recognize", "produce"] as const) {
    statements.push(
      db
        .prepare(
          `INSERT INTO lexicon_practice_cards
            (id, owner_id, equivalent_id, language_tag, direction, due_at, stability, difficulty,
             elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review_at,
             revision, created_at, updated_at)
           SELECT ?, q.owner_id, q.id, q.language_tag, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?
             FROM lexicon_equivalents q
            WHERE q.id = ? AND q.owner_id = ? AND q.deleted_at IS NULL
              AND q.status IN ('confirmed', 'manual') AND q.fit <> 'false_friend'
           ON CONFLICT(owner_id, equivalent_id, direction) DO UPDATE SET
             language_tag = excluded.language_tag,
             updated_at = excluded.updated_at`,
        )
        .bind(
          ids.next(),
          direction,
          initial.dueAt,
          initial.stability,
          initial.difficulty,
          initial.elapsedDays,
          initial.scheduledDays,
          initial.learningSteps,
          initial.reps,
          initial.lapses,
          initial.state,
          initial.lastReviewAt,
          iso(now),
          iso(now),
          equivalentId,
          ownerId,
        ),
    );
  }
}

export function isPracticeEligible(status: string, fit: string): boolean {
  return (
    (status === "confirmed" || status === "manual") && fit !== "false_friend"
  );
}

function validateCourseImport(input: CourseLexiconImport): CourseLexiconImport {
  for (const [name, value] of [
    ["ownerId", input.ownerId],
    ["courseId", input.courseId],
    ["courseVersion", input.courseVersion],
    ["itemId", input.itemId],
  ] as const) {
    if (
      typeof value !== "string" ||
      value.length < 1 ||
      value.length > 200 ||
      value.trim() !== value
    ) {
      throw new InputError(`${name} is invalid`);
    }
  }
  if (
    !Array.isArray(input.senses) ||
    input.senses.length < 1 ||
    input.senses.length > 20
  ) {
    throw new InputError("senses are invalid");
  }
  const senses = input.senses.map((sense, index) =>
    parseSense(sense, `senses[${index}]`),
  );
  if (
    senses.reduce((count, sense) => count + sense.equivalents.length, 0) > 100
  ) {
    throw new InputError("course imports support at most 100 equivalents");
  }
  for (const sense of senses) {
    if (
      sense.equivalents.some(
        (equivalent) =>
          !isPracticeEligible(equivalent.status, equivalent.fit ?? "exact"),
      )
    ) {
      throw new InputError(
        "course imports require verified, non-false-friend equivalents",
      );
    }
  }
  const provenance = jsonRecord(input.provenance, "provenance");
  if (provenance === null || provenance === undefined)
    throw new InputError("provenance is required");
  const note = optionalString(input.note, "note", 2000);
  return {
    ownerId: input.ownerId,
    courseId: input.courseId,
    courseVersion: input.courseVersion,
    itemId: input.itemId,
    kind: enumValue(input.kind, "kind", kinds),
    ...(note === undefined ? {} : { note }),
    provenance,
    senses,
  };
}
