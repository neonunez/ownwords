import { afterEach, describe, expect, it } from "vitest";
import { carryoverMigrationSql } from "../src/carryover";
import { ingestCourseVersion, publishCourseVersion } from "../src/operator";
import { composedMigrations, fixture, migrationSql, TestD1 } from "./d1";

const databases: TestD1[] = [];
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("learning migrations", () => {
  it("loads with foreign keys intact", () => {
    const test = new TestD1();
    databases.push(test);
    expect(test.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const tables = test.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'learning_%' ORDER BY name",
      )
      .all();
    expect(tables).toHaveLength(15);
  });

  it("ships the carry-over migration exactly as the rules completion runs render it", () => {
    // 0202 is generated output (`npm run migration:carryover`), and its exact
    // bytes are what the release authorization hashes.
    expect(migrationSql(composedMigrations.at(-1)!)).toBe(
      carryoverMigrationSql(),
    );
  });

  it("carries finished lessons into Learn once, keeping each word's Lexicon schedule", async () => {
    const carryover = composedMigrations.at(-1)!;
    const test = new TestD1(composedMigrations.slice(0, -1));
    databases.push(test);
    await ingestCourseVersion(test.db, fixture());
    await publishCourseVersion(test.db, "russian-zero", 1);
    // Alice finished "hello" before Learn owned its own list, so privet is a
    // course import in her Lexicon with reviews behind it. Bob practised the
    // same word in his own Lexicon but never finished the lesson.
    test.sqlite.exec(`
      INSERT INTO learning_user_course_progress
        (user_id, course_id, course_version, started_at, updated_at)
      VALUES ('alice', 'russian-zero', 1, 't', 't'), ('bob', 'russian-zero', 1, 't', 't');
      INSERT INTO learning_user_lesson_progress
        (user_id, course_id, course_version, lesson_id, status, current_step_id,
         farthest_step_position, started_at, completed_at, updated_at)
      VALUES ('alice', 'russian-zero', 1, 'hello', 'completed', 'hello-use', 2, 't', 't', 't'),
             ('bob', 'russian-zero', 1, 'hello', 'in_progress', 'hello-hear', 1, 't', NULL, 't');
    `);
    for (const owner of ["alice", "bob"]) {
      test.sqlite.exec(`
        INSERT INTO lexicon_entries
          (id, owner_id, kind, source, provenance_json, human_edited, version, created_at, updated_at)
        VALUES ('${owner}-entry', '${owner}', 'word', 'course', '{}', 0, 1, 't', 't');
        INSERT INTO lexicon_senses
          (id, owner_id, entry_id, gloss, position, human_edited, version, created_at, updated_at)
        VALUES ('${owner}-sense', '${owner}', '${owner}-entry', 'greeting', 0, 0, 1, 't', 't');
        INSERT INTO lexicon_equivalents
          (id, owner_id, sense_id, language_tag, text, search_text, fit, status,
           human_edited, version, created_at, updated_at)
        VALUES ('${owner}-equivalent', '${owner}', '${owner}-sense', 'ru', 'привет', 'привет',
                'exact', 'confirmed', 0, 1, 't', 't');
        INSERT INTO lexicon_course_imports
          (owner_id, course_id, course_version, item_id, entry_id, created_at)
        VALUES ('${owner}', 'russian-zero', '1', 'privet', '${owner}-entry', 't');
        INSERT INTO lexicon_practice_cards
          (id, owner_id, equivalent_id, language_tag, direction, due_at, stability, difficulty,
           elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review_at,
           revision, created_at, updated_at)
        VALUES ('${owner}-card', '${owner}', '${owner}-equivalent', 'ru', 'recognize',
                '2026-06-01T00:00:00.000Z', ${owner === "alice" ? 12.5 : 99}, 4.25, 3, 3, 0,
                3, 0, 2, '2026-01-01T00:00:00.000Z', 3, 't', 't');
      `);
    }

    const cards = () =>
      test.sqlite
        .prepare(
          `SELECT user_id, id, direction, due_at, stability, difficulty, reps, state,
                  last_review_at, revision
             FROM learning_practice_cards ORDER BY user_id, id`,
        )
        .all();
    test.sqlite.exec(migrationSql(carryover));
    const carried = cards();
    expect(carried).toMatchObject([
      {
        user_id: "alice",
        id: "russian-zero.1.privet.produce",
        stability: 0,
        reps: 0,
        state: 0,
        last_review_at: null,
        revision: 0,
      },
      {
        user_id: "alice",
        id: "russian-zero.1.privet.recognize",
        due_at: "2026-06-01T00:00:00.000Z",
        stability: 12.5,
        difficulty: 4.25,
        reps: 3,
        state: 2,
        last_review_at: "2026-01-01T00:00:00.000Z",
        revision: 3,
      },
    ]);
    expect(carried).toHaveLength(2);
    expect(test.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    // Running it again changes nothing, and it never rewrites a card.
    test.sqlite.exec(
      "UPDATE learning_practice_cards SET reps = 7 WHERE id = 'russian-zero.1.privet.produce'",
    );
    test.sqlite.exec(migrationSql(carryover));
    expect(cards()).toEqual(
      carried.map((card) =>
        card.id === "russian-zero.1.privet.produce"
          ? { ...card, reps: 7 }
          : card,
      ),
    );
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
