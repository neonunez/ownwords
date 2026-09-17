import { afterEach, describe, expect, it } from "vitest";
import { ContentValidationError, validateContentPack, type ContentPack } from "../src/content";
import {
  ContentTransitionError,
  discardDraftCourseVersion,
  ingestCourseVersion,
  publishCourseVersion,
} from "../src/operator";
import { fixture, TestD1 } from "./d1";

const databases: TestD1[] = [];
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

function database(): TestD1 {
  const db = new TestD1();
  databases.push(db);
  return db;
}

function pack(): ContentPack {
  return validateContentPack(fixture());
}

describe("content validation and ingestion", () => {
  it("accepts the bounded synthetic pack and rejects unsafe audio URLs", () => {
    const valid = pack();
    expect(valid.items[0]?.audio?.kind).toBe("recorded");
    const unsafe = structuredClone(valid);
    if (unsafe.items[0]?.audio) unsafe.items[0].audio.url = "javascript:alert(1)";
    expect(() => validateContentPack(unsafe)).toThrow(ContentValidationError);

    const credentialed = structuredClone(valid);
    if (credentialed.items[0]?.audio) {
      credentialed.items[0].audio.url = "https://operator:secret@audio.example.invalid/file.ogg";
    }
    expect(() => validateContentPack(credentialed)).toThrow(/URL credentials are not allowed/);
  });

  it("rejects learned items that do not match the course language", () => {
    const mismatched = structuredClone(pack());
    if (mismatched.items[0]) mismatched.items[0].languageTag = "en";
    expect(() => validateContentPack(mismatched)).toThrow(/language must match the course language/);
  });

  it("rejects missing content links and invalid prerequisites before touching D1", () => {
    const missingItem = structuredClone(pack());
    const firstStep = missingItem.units[0]?.lessons[0]?.steps[0];
    if (firstStep?.items[0]) firstStep.items[0].itemId = "missing-item";
    expect(() => validateContentPack(missingItem)).toThrow(/references missing item/);

    const forwardPrerequisite = structuredClone(pack());
    const firstLesson = forwardPrerequisite.units[0]?.lessons[0];
    if (firstLesson) firstLesson.prerequisites = ["goodbye"];
    expect(() => validateContentPack(forwardPrerequisite)).toThrow(/must come earlier/);
  });

  it("enforces sequential versions, immutable publication, and idempotent identical draft imports", async () => {
    const test = database();
    const first = await ingestCourseVersion(test.db, pack(), new Date("2026-01-01T00:00:00Z"));
    expect(first.outcome).toBe("created");
    await expect(ingestCourseVersion(test.db, pack())).resolves.toMatchObject({ outcome: "unchanged" });
    await publishCourseVersion(test.db, "russian-zero", 1, new Date("2026-01-02T00:00:00Z"));
    await expect(ingestCourseVersion(test.db, pack())).rejects.toMatchObject({
      code: "PUBLISHED_VERSION_IMMUTABLE",
    });

    const skipped = structuredClone(pack());
    skipped.version = 3;
    await expect(ingestCourseVersion(test.db, skipped)).rejects.toMatchObject({
      code: "UNSUPPORTED_VERSION_TRANSITION",
    });
  });

  it("accepts corrected title and description in a new version but not a changed course language", async () => {
    const test = database();
    await ingestCourseVersion(test.db, pack());
    await publishCourseVersion(test.db, "russian-zero", 1);

    const relanguaged = structuredClone(pack());
    relanguaged.version = 2;
    relanguaged.course.languageTag = "uk";
    for (const item of relanguaged.items) item.languageTag = "uk";
    await expect(ingestCourseVersion(test.db, relanguaged)).rejects.toMatchObject({
      code: "COURSE_IDENTITY_MISMATCH",
    });

    const corrected = structuredClone(pack());
    corrected.version = 2;
    corrected.course.title = "Corrected title";
    corrected.course.description = "Corrected description.";
    await expect(ingestCourseVersion(test.db, corrected)).resolves.toMatchObject({ outcome: "created" });
    await publishCourseVersion(test.db, "russian-zero", 2);
    expect(test.sqlite.prepare(
      "SELECT version, title, description FROM learning_course_versions WHERE course_id = 'russian-zero' ORDER BY version",
    ).all()).toEqual([
      { version: 1, title: "Synthetic Russian Test Course", description: pack().course.description },
      { version: 2, title: "Corrected title", description: "Corrected description." },
    ]);
    expect(() => test.sqlite.exec(
      "UPDATE learning_course_versions SET title = 'changed' WHERE course_id = 'russian-zero' AND version = 1",
    )).toThrow(/unsupported content version transition/);
  });

  it("allows explicit draft discard but never published deletion", async () => {
    const test = database();
    await ingestCourseVersion(test.db, pack());
    await discardDraftCourseVersion(test.db, "russian-zero", 1);
    expect(test.sqlite.prepare("SELECT COUNT(*) AS count FROM learning_units").get()).toEqual({ count: 0 });
    await ingestCourseVersion(test.db, pack());
    await publishCourseVersion(test.db, "russian-zero", 1);
    await expect(discardDraftCourseVersion(test.db, "russian-zero", 1)).rejects.toBeInstanceOf(
      ContentTransitionError,
    );
  });
});
