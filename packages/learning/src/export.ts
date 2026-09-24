import { all } from "./db";

type Row = Record<string, unknown>;

/** One learner's private Learning state; published course content is not personal data. */
export interface LearnerExport {
  enrollments: Row[];
  lessonProgress: Row[];
  lexiconSync: Row[];
}

function camel(row: Row): Row {
  const output: Row = {};
  for (const [column, value] of Object.entries(row)) {
    if (column === "user_id") continue;
    output[
      column.replace(/_([a-z])/gu, (_, letter: string) => letter.toUpperCase())
    ] = value;
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

/** Reads only Learning-owned progress tables, scoped to one user. */
export async function exportLearnerData(
  db: D1Database,
  userId: string,
): Promise<LearnerExport> {
  const [enrollments, lessonProgress, lexiconSync] = await Promise.all([
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
  ]);
  return { enrollments, lessonProgress, lexiconSync };
}
