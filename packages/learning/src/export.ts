import { all } from "./db";

type Row = Record<string, unknown>;

/** One learner's private Learning state; published course content is not personal data. */
export interface LearnerExport {
  enrollments: Row[];
  lessonProgress: Row[];
  /** What the learner asked to keep in their Lexicon, and what got there. */
  lexiconSync: Row[];
  /** Learn practice state: the schedule of each lesson word in each direction. */
  practiceCards: Row[];
  reviewEvents: Row[];
}

const JSON_COLUMNS = new Set(["result_json"]);

function camel(row: Row): Row {
  const output: Row = {};
  for (const [column, value] of Object.entries(row)) {
    if (column === "user_id") continue;
    const name = column.replace(/_([a-z])/gu, (_, letter: string) =>
      letter.toUpperCase(),
    );
    output[name] = JSON_COLUMNS.has(column)
      ? (JSON.parse(value as string) as unknown)
      : value;
  }
  return output;
}

async function rows(
  db: D1Database,
  table: string,
  userId: string,
  order: string,
): Promise<Row[]> {
  const result = await all<Row>(
    db
      .prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY ${order}`)
      .bind(userId),
  );
  return result.map(camel);
}

/**
 * Reads only Learning-owned tables, scoped to one user. Session-scoped
 * wrong-answer revisits are transient working state and are omitted.
 */
export async function exportLearnerData(
  db: D1Database,
  userId: string,
): Promise<LearnerExport> {
  const [
    enrollments,
    lessonProgress,
    lexiconSync,
    practiceCards,
    reviewEvents,
  ] = await Promise.all([
    rows(db, "learning_user_course_progress", userId, "course_id"),
    rows(
      db,
      "learning_user_lesson_progress",
      userId,
      "course_id, course_version, lesson_id",
    ),
    rows(
      db,
      "learning_lexicon_sync",
      userId,
      "course_id, course_version, item_id",
    ),
    rows(
      db,
      "learning_practice_cards",
      userId,
      "course_id, course_version, item_id, direction",
    ),
    rows(db, "learning_review_events", userId, "reviewed_at, id"),
  ]);
  return {
    enrollments,
    lessonProgress,
    lexiconSync,
    practiceCards,
    reviewEvents,
  };
}
