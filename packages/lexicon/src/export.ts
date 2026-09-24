import { all, decodeJson } from "./db.js";

type Row = Record<string, unknown>;

/** Everything one owner keeps in the Lexicon, including soft-deleted rows and review history. */
export interface LexiconOwnerExport {
  entries: Row[];
  senses: Row[];
  equivalents: Row[];
  clozeItems: Row[];
  practiceCards: Row[];
  reviewEvents: Row[];
  courseImports: Row[];
}

const JSON_COLUMNS = new Set([
  "provenance_json",
  "script_data_json",
  "accepted_answers_json",
  "result_json",
]);

function camel(column: string): string {
  return column
    .replace(/_json$/u, "")
    .replace(/_([a-z])/gu, (_, letter: string) => letter.toUpperCase());
}

function present(row: Row): Row {
  const output: Row = {};
  for (const [column, value] of Object.entries(row)) {
    if (column === "owner_id" || column === "search_text") continue;
    output[camel(column)] = JSON_COLUMNS.has(column)
      ? decodeJson(value as string | null)
      : value;
  }
  return output;
}

async function rows(
  db: D1Database,
  table: string,
  ownerId: string,
  order: string,
): Promise<Row[]> {
  const result = await all<Row>(
    db
      .prepare(`SELECT * FROM ${table} WHERE owner_id = ? ORDER BY ${order}`)
      .bind(ownerId),
  );
  return result.map(present);
}

/**
 * Reads only Lexicon-owned tables, scoped to one owner. The translation cache and
 * session-scoped wrong-answer revisits are transient working state and are omitted.
 */
export async function exportLexiconOwnerData(
  db: D1Database,
  ownerId: string,
): Promise<LexiconOwnerExport> {
  const [
    entries,
    senses,
    equivalents,
    clozeItems,
    practiceCards,
    reviewEvents,
    courseImports,
  ] = await Promise.all([
    rows(db, "lexicon_entries", ownerId, "created_at, id"),
    rows(db, "lexicon_senses", ownerId, "entry_id, position, id"),
    rows(db, "lexicon_equivalents", ownerId, "sense_id, created_at, id"),
    rows(db, "lexicon_cloze_items", ownerId, "equivalent_id, created_at, id"),
    rows(db, "lexicon_practice_cards", ownerId, "equivalent_id, direction"),
    rows(db, "lexicon_review_events", ownerId, "reviewed_at, id"),
    rows(
      db,
      "lexicon_course_imports",
      ownerId,
      "course_id, course_version, item_id",
    ),
  ]);
  return {
    entries,
    senses,
    equivalents,
    clozeItems,
    practiceCards,
    reviewEvents,
    courseImports,
  };
}
