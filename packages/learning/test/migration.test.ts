import { afterEach, describe, expect, it } from "vitest";
import { ingestCourseVersion, publishCourseVersion } from "../src/operator";
import { fixture, TestD1 } from "./d1";

const databases: TestD1[] = [];
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("0200 learning migration", () => {
  it("loads with foreign keys intact", () => {
    const test = new TestD1();
    databases.push(test);
    expect(test.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const tables = test.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'learning_%' ORDER BY name",
      )
      .all();
    expect(tables).toHaveLength(12);
  });

  it("protects every published content layer against update, insert, and delete", async () => {
    const test = new TestD1();
    databases.push(test);
    await ingestCourseVersion(test.db, fixture());
    await publishCourseVersion(test.db, "russian-zero", 1);
    expect(() =>
      test.sqlite.exec(
        "UPDATE learning_lessons SET title = 'changed' WHERE course_id = 'russian-zero' AND course_version = 1",
      ),
    ).toThrow(/published version is immutable/);
    expect(() =>
      test.sqlite.exec(
        "DELETE FROM learning_content_items WHERE course_id = 'russian-zero' AND course_version = 1 AND item_id = 'privet'",
      ),
    ).toThrow(/published version is immutable/);
    expect(() =>
      test.sqlite.exec(
        "INSERT INTO learning_units VALUES ('russian-zero', 1, 'late-unit', 2, 'Late', 'Not allowed')",
      ),
    ).toThrow(/published version is immutable/);
    expect(() =>
      test.sqlite.exec(
        "UPDATE learning_course_versions SET status = 'draft', published_at = NULL WHERE course_id = 'russian-zero' AND version = 1",
      ),
    ).toThrow(/unsupported content version transition/);
  });

  it("rejects missing references and leaves no dangling links after draft content deletion", async () => {
    const test = new TestD1();
    databases.push(test);
    await ingestCourseVersion(test.db, fixture());
    expect(() =>
      test.sqlite.exec(
        `INSERT INTO learning_step_items
       (course_id, course_version, step_id, item_id, role, position)
       VALUES ('russian-zero', 1, 'hello-hear', 'missing', 'reviewed', 2)`,
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
    test.sqlite.exec(
      "DELETE FROM learning_content_items WHERE course_id = 'russian-zero' AND course_version = 1 AND item_id = 'privet'",
    );
    expect(
      test.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM learning_step_items WHERE item_id = 'privet'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(test.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("binds user progress rows to the single pinned course version", async () => {
    const test = new TestD1();
    databases.push(test);
    await ingestCourseVersion(test.db, fixture());
    await publishCourseVersion(test.db, "russian-zero", 1);
    const next = structuredClone(fixture()) as { version: number };
    next.version = 2;
    await ingestCourseVersion(test.db, next);
    await publishCourseVersion(test.db, "russian-zero", 2);
    test.sqlite.exec(
      `INSERT INTO learning_user_course_progress
       (user_id, course_id, course_version, started_at, updated_at)
       VALUES ('alice', 'russian-zero', 1, 't', 't')`,
    );
    expect(() =>
      test.sqlite.exec(
        `INSERT INTO learning_user_course_progress
       (user_id, course_id, course_version, started_at, updated_at)
       VALUES ('alice', 'russian-zero', 2, 't', 't')`,
      ),
    ).toThrow(/UNIQUE constraint failed/);
    expect(() =>
      test.sqlite.exec(
        "UPDATE learning_user_course_progress SET course_version = 2 WHERE user_id = 'alice'",
      ),
    ).toThrow(/course enrollment version is immutable/);
    expect(() =>
      test.sqlite.exec(
        `INSERT INTO learning_user_lesson_progress
       (user_id, course_id, course_version, lesson_id, status, current_step_id,
        farthest_step_position, started_at, completed_at, updated_at)
       VALUES ('alice', 'russian-zero', 2, 'hello', 'in_progress', 'hello-hear', 1, 't', NULL, 't')`,
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});
