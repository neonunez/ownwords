import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  ContentValidationError,
  validateContentPack,
  type ContentPack,
} from "../src/content";
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

describe("authored course pack", () => {
  it("is valid, teacher-reviewed, and has no fabricated audio", async () => {
    const input = JSON.parse(
      await readFile(
        new URL("../content/russian-foundations-v1.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;
    const authored = validateContentPack(input);

    expect(authored.course).toMatchObject({
      id: "russian-foundations",
      languageTag: "ru",
    });
    expect(authored.version).toBe(1);
    expect(authored.course.description).toMatch(/reviewed by a qualified/i);
    // The description is stored on the published version row and is frozen at
    // first publication, so it must not claim a review that has not happened
    // or a recording the app cannot play.
    expect(authored.course.description).not.toMatch(/unreviewed/i);
    expect(authored.course.description).toMatch(/without recordings/i);
    // No step may promise a recording the app cannot play.
    const payloads = JSON.stringify(authored.units);
    expect(payloads).not.toMatch(
      /listen|listening|record|recorded|play(ing|back)?\b|audio|spoken/i,
    );
    expect(authored.units.map((unit) => unit.id)).toEqual([
      "a0-script",
      "a1-greetings",
    ]);
    expect(authored.units[1]?.lessons[1]?.prerequisites).toEqual(["a1-hello"]);
    expect(authored.items).toHaveLength(25);
    expect(
      authored.items.every((item) => item.license.spdxId === "CC-BY-4.0"),
    ).toBe(true);
    expect(authored.items.every((item) => !item.audio)).toBe(true);
    expect(
      authored.items.every(
        (item) =>
          item.provenance.author === "Ownwords" &&
          item.grammaticalMetadata.examples !== undefined,
      ),
    ).toBe(true);
    for (const unit of authored.units) {
      for (const lesson of unit.lessons) {
        for (const step of lesson.steps) {
          if (step.kind === "use" || step.kind === "perception") {
            const options = step.payload.options as unknown[] | undefined;
            const answer = step.payload.answer as string | undefined;
            const responses = step.payload.responses as
              Record<string, unknown> | undefined;
            expect(options).toEqual(expect.arrayContaining([answer]));
            expect(Object.keys(responses ?? {})).toEqual(
              expect.arrayContaining(options ?? []),
            );
          }
        }
      }
    }
  });
});

describe("content validation and ingestion", () => {
  it("accepts the bounded synthetic pack and rejects unsafe audio URLs", () => {
    const valid = pack();
    expect(valid.items[0]?.audio?.kind).toBe("recorded");
    const unsafe = structuredClone(valid);
    if (unsafe.items[0]?.audio)
      unsafe.items[0].audio.url = "javascript:alert(1)";
    expect(() => validateContentPack(unsafe)).toThrow(ContentValidationError);

    const credentialed = structuredClone(valid);
    if (credentialed.items[0]?.audio) {
      credentialed.items[0].audio.url =
        "https://operator:secret@audio.example.invalid/file.ogg";
    }
    expect(() => validateContentPack(credentialed)).toThrow(
      /URL credentials are not allowed/,
    );
  });

  it("rejects learned items that do not match the course language", () => {
    const mismatched = structuredClone(pack());
    if (mismatched.items[0]) mismatched.items[0].languageTag = "en";
    expect(() => validateContentPack(mismatched)).toThrow(
      /language must match the course language/,
    );
  });

  it("rejects lesson steps outside the core curriculum step kinds", () => {
    const withPractice = structuredClone(pack()) as unknown as {
      units: Array<{ lessons: Array<{ steps: Array<{ kind: string }> }> }>;
    };
    const step = withPractice.units[0]?.lessons[1]?.steps[1];
    expect(step?.kind).toBe("use");
    if (step) step.kind = "practice";
    expect(() => validateContentPack(withPractice)).toThrow(
      ContentValidationError,
    );
  });

  it("rejects a pack where two lessons introduce the same item", () => {
    const shared = structuredClone(pack());
    const goodbye = shared.units[0]?.lessons[1];
    const introduction = goodbye?.steps[0]?.items[0];
    expect(introduction?.role).toBe("introduced");
    if (introduction) introduction.itemId = "privet";
    expect(() => validateContentPack(shared)).toThrow(
      /item 'privet' is introduced by lessons 'hello' and 'goodbye'/,
    );
  });

  it("rejects items a lesson uses that no lesson introduces", () => {
    const neverIntroduced = structuredClone(pack());
    const goodbyeIntroduction =
      neverIntroduced.units[0]?.lessons[1]?.steps[0]?.items[0];
    if (goodbyeIntroduction) goodbyeIntroduction.role = "reviewed";
    expect(() => validateContentPack(neverIntroduced)).toThrow(
      /item 'poka' is used by a lesson but no lesson introduces it/,
    );
  });

  it("rejects missing content links and invalid prerequisites before touching D1", () => {
    const missingItem = structuredClone(pack());
    const firstStep = missingItem.units[0]?.lessons[0]?.steps[0];
    if (firstStep?.items[0]) firstStep.items[0].itemId = "missing-item";
    expect(() => validateContentPack(missingItem)).toThrow(
      /references missing item/,
    );

    const forwardPrerequisite = structuredClone(pack());
    const firstLesson = forwardPrerequisite.units[0]?.lessons[0];
    if (firstLesson) firstLesson.prerequisites = ["goodbye"];
    expect(() => validateContentPack(forwardPrerequisite)).toThrow(
      /must come earlier/,
    );
  });

  it("enforces sequential versions, immutable publication, and idempotent identical draft imports", async () => {
    const test = database();
    const first = await ingestCourseVersion(
      test.db,
      pack(),
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(first.outcome).toBe("created");
    await expect(ingestCourseVersion(test.db, pack())).resolves.toMatchObject({
      outcome: "unchanged",
    });
    await publishCourseVersion(
      test.db,
      "russian-zero",
      1,
      new Date("2026-01-02T00:00:00Z"),
    );
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
    await expect(
      ingestCourseVersion(test.db, relanguaged),
    ).rejects.toMatchObject({
      code: "COURSE_IDENTITY_MISMATCH",
    });

    const corrected = structuredClone(pack());
    corrected.version = 2;
    corrected.course.title = "Corrected title";
    corrected.course.description = "Corrected description.";
    await expect(
      ingestCourseVersion(test.db, corrected),
    ).resolves.toMatchObject({ outcome: "created" });
    await publishCourseVersion(test.db, "russian-zero", 2);
    expect(
      test.sqlite
        .prepare(
          "SELECT version, title, description FROM learning_course_versions WHERE course_id = 'russian-zero' ORDER BY version",
        )
        .all(),
    ).toEqual([
      {
        version: 1,
        title: "Synthetic Russian Test Course",
        description: pack().course.description,
      },
      {
        version: 2,
        title: "Corrected title",
        description: "Corrected description.",
      },
    ]);
    expect(() =>
      test.sqlite.exec(
        "UPDATE learning_course_versions SET title = 'changed' WHERE course_id = 'russian-zero' AND version = 1",
      ),
    ).toThrow(/unsupported content version transition/);
  });

  it("allows explicit draft discard but never published deletion", async () => {
    const test = database();
    await ingestCourseVersion(test.db, pack());
    await discardDraftCourseVersion(test.db, "russian-zero", 1);
    expect(
      test.sqlite.prepare("SELECT COUNT(*) AS count FROM learning_units").get(),
    ).toEqual({ count: 0 });
    await ingestCourseVersion(test.db, pack());
    await publishCourseVersion(test.db, "russian-zero", 1);
    await expect(
      discardDraftCourseVersion(test.db, "russian-zero", 1),
    ).rejects.toBeInstanceOf(ContentTransitionError);
  });
});
