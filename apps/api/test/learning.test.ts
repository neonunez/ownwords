import { env } from "cloudflare:workers";
import {
  ContentTransitionError,
  ingestCourseVersion,
  publishCourseVersion,
} from "@ownwords/learning/operator";
import { createCourseLexiconImporter } from "@ownwords/lexicon";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  call,
  callJson,
  finishLesson,
  personalEntry,
  publishCourseVersions,
  signedInUser,
  type TestUser,
} from "./e2e.js";
import { COURSE_ID, coursePack } from "./fixtures/course.js";
import { TRUSTED_ORIGIN } from "./helpers.js";

const course = `/api/v1/learning/courses/${COURSE_ID}`;
const GREET_STEPS = ["greet-read", "greet-use"] as const;
const PART_STEPS = ["part-rule", "part-use"] as const;

async function lexiconTexts(user: TestUser): Promise<string[]> {
  const list = await callJson(user, "GET", "/api/v1/lexicon/entries", 200);
  return list.data.flatMap(
    (entry: { senses: Array<{ equivalents: Array<{ text: string }> }> }) =>
      entry.senses.flatMap((sense) => sense.equivalents.map((q) => q.text)),
  );
}

async function courseImportCount(userId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM lexicon_course_imports WHERE owner_id = ?",
  )
    .bind(userId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

beforeAll(async () => {
  await publishCourseVersions(1);
});

describe("first-start enrollment and version pinning", () => {
  it("keeps a learner on the version they started, with no automatic migration", async () => {
    const early = await signedInUser("pin-early");
    await callJson(
      early,
      "PUT",
      `${course}/versions/1/lessons/greet/progress`,
      200,
      {
        body: { stepId: "greet-read" },
      },
    );

    await publishCourseVersions(2);
    const late = await signedInUser("pin-late");

    const earlyCourses = await callJson(
      early,
      "GET",
      "/api/v1/learning/courses",
      200,
    );
    const lateCourses = await callJson(
      late,
      "GET",
      "/api/v1/learning/courses",
      200,
    );
    expect(earlyCourses.courses).toEqual([
      expect.objectContaining({
        id: COURSE_ID,
        version: 1,
        title: "Synthetic Russian v1",
      }),
    ]);
    expect(lateCourses.courses).toEqual([
      expect.objectContaining({
        id: COURSE_ID,
        version: 2,
        title: "Synthetic Russian v2",
      }),
    ]);

    const resume = await callJson(early, "GET", `${course}/resume`, 200);
    expect(resume.resume).toMatchObject({
      version: 1,
      lessonId: "greet",
      stepId: "greet-read",
    });

    for (const [method, path, body] of [
      ["GET", `${course}/versions/2`, undefined],
      ["GET", `${course}/versions/2/lessons/greet`, undefined],
      [
        "PUT",
        `${course}/versions/2/lessons/greet/progress`,
        { stepId: "greet-read" },
      ],
      ["POST", `${course}/versions/2/lessons/greet/complete`, undefined],
      [
        "GET",
        `/api/v1/learning/references?courseId=${COURSE_ID}&version=2&category=alphabet`,
        undefined,
      ],
    ] as const) {
      const response = await call(early, method, path, { body });
      expect(response.status, `${method} ${path}`).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "COURSE_VERSION_MISMATCH" },
      });
    }

    const enrollment = await env.DB.prepare(
      "SELECT course_version AS version FROM learning_user_course_progress WHERE user_id = ? AND course_id = ?",
    )
      .bind(early.id, COURSE_ID)
      .first<{ version: number }>();
    expect(enrollment?.version).toBe(1);

    // A learner who first starts after v2 is published enrolls in v2.
    await callJson(
      late,
      "PUT",
      `${course}/versions/2/lessons/greet/progress`,
      200,
      {
        body: { stepId: "greet-read" },
      },
    );
    const lateV1 = await call(late, "GET", `${course}/versions/1`);
    expect(lateV1.status).toBe(409);
  });

  it("rejects unsupported content version transitions at the operator boundary", async () => {
    await publishCourseVersions(2);
    await expect(
      ingestCourseVersion(env.DB, coursePack(4)),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_VERSION_TRANSITION",
    });
    await expect(
      ingestCourseVersion(env.DB, coursePack(1, "Rewritten")),
    ).rejects.toThrow(ContentTransitionError);
    await expect(publishCourseVersion(env.DB, COURSE_ID, 9)).rejects.toThrow(
      ContentTransitionError,
    );
    const changedLanguage = {
      ...coursePack(3),
      course: { ...coursePack(3).course, languageTag: "uk" },
    };
    for (const item of changedLanguage.items) item.languageTag = "uk";
    await expect(
      ingestCourseVersion(env.DB, changedLanguage),
    ).rejects.toMatchObject({
      code: "COURSE_IDENTITY_MISMATCH",
    });
  });

  it("rejects invalid prerequisites, broken links, and unsafe URLs before touching D1", async () => {
    const forward = coursePack(3);
    forward.units[0]!.lessons[0]!.prerequisites = ["part"];
    const missing = coursePack(3);
    missing.units[0]!.lessons[1]!.prerequisites = ["no-such-lesson"];
    const unsafeAudio = coursePack(3);
    (unsafeAudio.items[0] as { audio?: { url: string } }).audio!.url =
      "http://audio.example.invalid/plain.ogg";
    const twiceIntroduced = coursePack(3);
    twiceIntroduced.units[0]!.lessons[1]!.steps[0]!.items[0]!.itemId =
      "spasibo";
    for (const pack of [forward, missing, unsafeAudio, twiceIntroduced]) {
      await expect(ingestCourseVersion(env.DB, pack)).rejects.toThrow(
        /Invalid content pack/,
      );
    }
    const draft = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM learning_course_versions WHERE course_id = ? AND version = 3",
    )
      .bind(COURSE_ID)
      .first<{ count: number }>();
    expect(draft?.count).toBe(0);
  });
});

describe("content licences for Settings", () => {
  it("lists item and recording licences for the version the learner sees", async () => {
    const learner = await signedInUser("licence-learner");
    await publishCourseVersions(2);
    const body = await callJson(
      learner,
      "GET",
      `${course}/versions/2/licenses`,
      200,
    );
    expect(body.licenses).toEqual([
      {
        spdxId: "CC-BY-4.0",
        sourceName: "Synthetic recordings",
        sourceUrl: "https://audio.example.invalid/synthetic",
        attribution: "Synthetic Speaker, CC BY 4.0",
      },
      {
        spdxId: "CC0-1.0",
        sourceName: "Ownwords synthetic test fixture",
        sourceUrl: null,
        attribution: null,
      },
    ]);
    await callJson(
      learner,
      "PUT",
      `${course}/versions/2/lessons/greet/progress`,
      200,
      {
        body: { stepId: "greet-read" },
      },
    );
    const otherVersion = await call(
      learner,
      "GET",
      `${course}/versions/1/licenses`,
    );
    expect(otherVersion.status).toBe(409);
  });
});

describe("the Lexicon is the learner's own", () => {
  it("keeps a finished lesson out of the Lexicon until the learner asks for it", async () => {
    const learner = await signedInUser("export-learner");
    const other = await signedInUser("export-other");
    const version = 2;
    await publishCourseVersions(version);

    const completed = await finishLesson(
      learner,
      COURSE_ID,
      version,
      "greet",
      GREET_STEPS,
    );
    expect(completed.status).toBe(200);
    await expect(completed.json()).resolves.toMatchObject({
      completion: {
        lessonId: "greet",
        words: { total: 2, inLexicon: 0 },
      },
    });
    expect(await lexiconTexts(learner)).toEqual([]);
    expect(await courseImportCount(learner.id)).toBe(0);

    const added = await callJson(
      learner,
      "POST",
      `${course}/versions/${version}/lessons/greet/lexicon`,
      200,
    );
    expect(added.lexicon).toEqual({
      total: 2,
      inLexicon: 2,
      added: 2,
      alreadyThere: 0,
      pending: 0,
    });
    const texts = await lexiconTexts(learner);
    expect(texts.sort()).toEqual(["здравствуй", "спасибо"]);
    expect(await lexiconTexts(other)).toEqual([]);
    expect(await courseImportCount(learner.id)).toBe(2);

    const imported = await callJson(
      learner,
      "GET",
      "/api/v1/lexicon/entries?query=здравствуй",
      200,
    );
    const entry = imported.data[0];
    expect(entry.source).toBe("course");
    expect(entry.provenance).toMatchObject({
      license: { spdxId: "CC0-1.0" },
      content: { author: "Ownwords test authors" },
    });
    const equivalent = entry.senses[0].equivalents[0];
    expect(equivalent).toMatchObject({
      languageTag: "ru",
      status: "confirmed",
      fit: "exact",
      provenance: { license: { spdxId: "CC0-1.0" } },
      scriptData: {
        stressText: "здра́вствуй",
        audio: { kind: "recorded", license: { spdxId: "CC-BY-4.0" } },
      },
    });

    // Asking again is safe: nothing is stored twice, and the answer is honest.
    const again = await callJson(
      learner,
      "POST",
      `${course}/versions/${version}/lessons/greet/lexicon`,
      200,
    );
    expect(again.lexicon).toEqual({
      total: 2,
      inLexicon: 2,
      added: 0,
      alreadyThere: 0,
      pending: 0,
    });
    expect(await courseImportCount(learner.id)).toBe(2);

    // The next lesson reviews spasibo but only offers what it introduces.
    const part = await finishLesson(
      learner,
      COURSE_ID,
      version,
      "part",
      PART_STEPS,
    );
    expect(part.status).toBe(200);
    const offered = await callJson(
      learner,
      "POST",
      `${course}/versions/${version}/lessons/part/lexicon`,
      200,
    );
    expect(offered.lexicon).toMatchObject({ total: 1, added: 1 });
    expect((await lexiconTexts(learner)).sort()).toEqual([
      "до свидания",
      "здравствуй",
      "спасибо",
    ]);
    expect(await courseImportCount(learner.id)).toBe(3);
    expect(await courseImportCount(other.id)).toBe(0);
  });

  it("puts a lesson's words back after the learner deleted them from the Lexicon", async () => {
    const learner = await signedInUser("deleted-learner");
    const lesson = `${course}/versions/1/lessons/greet`;
    expect(
      (await finishLesson(learner, COURSE_ID, 1, "greet", GREET_STEPS)).status,
    ).toBe(200);
    await callJson(learner, "POST", `${lesson}/lexicon`, 200);
    const kept = await callJson(learner, "GET", "/api/v1/lexicon/entries", 200);
    expect(kept.data).toHaveLength(2);
    for (const entry of kept.data as Array<{ id: string; version: number }>) {
      expect(
        (
          await call(learner, "DELETE", `/api/v1/lexicon/entries/${entry.id}`, {
            headers: { "If-Match": `"${entry.version}"` },
          })
        ).status,
      ).toBe(204);
    }
    expect(await lexiconTexts(learner)).toEqual([]);

    // The finished lesson no longer claims the words, and offers them again.
    const reopened = await callJson(learner, "GET", lesson, 200);
    expect(reopened.lesson.words).toEqual({ total: 2, inLexicon: 0 });

    const restored = await callJson(learner, "POST", `${lesson}/lexicon`, 200);
    expect(restored.lexicon).toEqual({
      total: 2,
      inLexicon: 2,
      added: 2,
      alreadyThere: 0,
      pending: 0,
    });
    expect((await lexiconTexts(learner)).sort()).toEqual([
      "здравствуй",
      "спасибо",
    ]);
    expect(await courseImportCount(learner.id)).toBe(2);
    expect((await callJson(learner, "GET", lesson, 200)).lesson.words).toEqual({
      total: 2,
      inLexicon: 2,
    });
  });

  it("never reports a failed save as done, and retries without losing or duplicating vocabulary", async () => {
    const learner = await signedInUser("retry-learner");
    await publishCourseVersions(2);
    let failures = 1;
    const flaky = createApp({
      lexiconImporter: (bindings) => {
        const real = createCourseLexiconImporter({ db: bindings.DB });
        return {
          async importCourseEntry(input) {
            if (input.itemId === "spasibo" && failures > 0) {
              failures -= 1;
              throw new Error("simulated Lexicon outage");
            }
            return real.importCourseEntry(input);
          },
          courseEntriesStored: (input) => real.courseEntriesStored(input),
        };
      },
    });
    const request = (method: string, path: string, body?: unknown) =>
      flaky.request(
        `${TRUSTED_ORIGIN}${path}`,
        {
          method,
          headers: {
            Cookie: learner.cookie,
            Origin: TRUSTED_ORIGIN,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        env,
      );
    for (const stepId of GREET_STEPS) {
      expect(
        (
          await request("PUT", `${course}/versions/2/lessons/greet/progress`, {
            stepId,
          })
        ).status,
      ).toBe(200);
    }
    expect(
      (await request("POST", `${course}/versions/2/lessons/greet/complete`))
        .status,
    ).toBe(200);
    const first = await request(
      "POST",
      `${course}/versions/2/lessons/greet/lexicon`,
    );
    expect(first.status).toBe(202);
    await expect(first.json()).resolves.toMatchObject({
      lexicon: { inLexicon: 1, added: 1, pending: 1 },
    });
    // The one that worked landed; the one that failed is still owed.
    expect(await lexiconTexts(learner)).toEqual(["здравствуй"]);
    const pending = await env.DB.prepare(
      "SELECT item_id AS itemId, status, attempt_count AS attempts FROM learning_lexicon_sync WHERE user_id = ? ORDER BY item_id",
    )
      .bind(learner.id)
      .all<{ itemId: string; status: string; attempts: number }>();
    expect(pending.results).toEqual([
      { itemId: "spasibo", status: "pending", attempts: 1 },
      { itemId: "zdravstvuj", status: "synced", attempts: 1 },
    ]);

    const retry = await request(
      "POST",
      `${course}/versions/2/lessons/greet/lexicon`,
    );
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({
      lexicon: { inLexicon: 2, added: 1, pending: 0 },
    });
    expect((await lexiconTexts(learner)).sort()).toEqual([
      "здравствуй",
      "спасибо",
    ]);
    expect(await courseImportCount(learner.id)).toBe(2);
  });
});

describe("Learn practises the course, Maintain the collection", () => {
  it("serves lesson words in Learn practice and keeps them out of the Lexicon", async () => {
    const learner = await signedInUser("practice-learner");
    await publishCourseVersions(2);
    await callJson(learner, "POST", "/api/v1/lexicon/entries", 201, {
      body: personalEntry,
    });
    expect(
      (await finishLesson(learner, COURSE_ID, 2, "greet", GREET_STEPS)).status,
    ).toBe(200);

    const due = (path: string) =>
      callJson(learner, "GET", path, 200) as Promise<{
        data: Array<{ target: { text: string } }>;
        nextDueAt: string | null;
      }>;
    for (const direction of ["recognize", "produce"]) {
      const learn = await due(
        `/api/v1/learning/practice/due?language=ru&direction=${direction}&format=flashcard&sessionId=learn`,
      );
      expect(learn.data.map((item) => item.target.text).sort()).toEqual([
        "здравствуй",
        "спасибо",
      ]);
      expect(learn.nextDueAt).toBeNull();
    }
    // A review is Learn's own: it schedules a Learn card and imports nothing.
    const card = (
      await due(
        "/api/v1/learning/practice/due?language=ru&direction=recognize&format=flashcard&sessionId=learn",
      )
    ).data[0] as unknown as { card: { id: string } };
    await callJson(learner, "POST", "/api/v1/learning/practice/reviews", 201, {
      body: {
        submissionId: "practice-1",
        cardId: card.card.id,
        sessionId: "learn",
        rating: 3,
      },
    });
    expect(await courseImportCount(learner.id)).toBe(0);

    // The personal collection keeps its own queue, and the lesson's words are
    // not in it until the learner asks for them there.
    const maintain = await due(
      "/api/v1/lexicon/practice/due?language=ru&direction=produce&format=flashcard&sessionId=learn",
    );
    expect(maintain.data.map((item) => item.target.text)).toEqual(["пока́"]);
  });

  it("serves lessons, references, and resume from course content, never personal vocabulary", async () => {
    const learner = await signedInUser("curriculum-learner");
    await publishCourseVersions(2);
    await callJson(learner, "POST", "/api/v1/lexicon/entries", 201, {
      body: personalEntry,
    });

    const lesson = await callJson(
      learner,
      "GET",
      `${course}/versions/2/lessons/greet`,
      200,
    );
    expect(
      lesson.lesson.contentItems.map((item: { id: string }) => item.id).sort(),
    ).toEqual(["spasibo", "zdravstvuj"]);
    const serialized =
      JSON.stringify(lesson) +
      JSON.stringify(await callJson(learner, "GET", `${course}/resume`, 200)) +
      JSON.stringify(
        await callJson(
          learner,
          "GET",
          `/api/v1/learning/references?courseId=${COURSE_ID}&version=2&category=grammar`,
          200,
        ),
      );
    expect(serialized).not.toContain("пока");
    expect(serialized).not.toContain("hasta luego");

    const practice = await call(
      learner,
      "GET",
      `/api/v1/learning/practice?courseId=${COURSE_ID}`,
    );
    expect(practice.status).toBe(404);
  });
});

describe("learning security failures", () => {
  it("refuses invalid payloads, paths, and skipped or regressive progress without reporting success", async () => {
    const learner = await signedInUser("security-learner");
    await publishCourseVersions(2);
    const progress = `${course}/versions/2/lessons/greet/progress`;
    const cases: Array<[string, string, unknown, number, string]> = [
      ["PUT", progress, "{not json", 400, "INVALID_JSON"],
      [
        "PUT",
        progress,
        { stepId: "greet-read", extra: true },
        400,
        "INVALID_PROGRESS",
      ],
      ["PUT", progress, { stepId: "part-rule" }, 400, "INVALID_PROGRESS"],
      [
        "PUT",
        progress,
        { stepId: "greet-use" },
        409,
        "INVALID_PROGRESS_SEQUENCE",
      ],
      [
        "PUT",
        `${course}/versions/2/lessons/part/progress`,
        { stepId: "part-rule" },
        403,
        "PREREQUISITES_NOT_MET",
      ],
      [
        "POST",
        `${course}/versions/2/lessons/greet/complete`,
        undefined,
        409,
        "LESSON_NOT_FINISHED",
      ],
      ["GET", `${course}/versions/0`, undefined, 400, "INVALID_VERSION"],
      [
        "GET",
        `/api/v1/learning/courses/Bad%20Id/versions/1`,
        undefined,
        400,
        "INVALID_PATH",
      ],
      [
        "GET",
        `/api/v1/learning/references?courseId=${COURSE_ID}&version=2&category=secrets`,
        undefined,
        400,
        "INVALID_CATEGORY",
      ],
    ];
    for (const [method, path, body, status, code] of cases) {
      const response = await call(learner, method, path, { body });
      expect(response.status, `${method} ${path}`).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ error: { code } });
    }
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM learning_user_lesson_progress WHERE user_id = ?",
    )
      .bind(learner.id)
      .first<{ count: number }>();
    expect(rows?.count).toBe(0);

    // Completed lessons refuse further progress writes rather than silently no-op.
    expect(
      (await finishLesson(learner, COURSE_ID, 2, "greet", GREET_STEPS)).status,
    ).toBe(200);
    const late = await call(learner, "PUT", progress, {
      body: { stepId: "greet-use" },
    });
    expect(late.status).toBe(409);
    await expect(late.json()).resolves.toMatchObject({
      error: { code: "LESSON_ALREADY_COMPLETED" },
    });
  });

  it("refuses invalid Lexicon payloads and oversize limits with the shared error envelope", async () => {
    const user = await signedInUser("security-lexicon");
    const invalid: unknown[] = [
      "{not json",
      { kind: "sentence", senses: [] },
      {
        kind: "word",
        senses: [
          {
            equivalents: [
              { languageTag: "not a tag!", text: "x", status: "manual" },
            ],
          },
        ],
      },
      {
        kind: "word",
        senses: [{ equivalents: [{ languageTag: "ru", status: "confirmed" }] }],
      },
      {
        kind: "word",
        senses: Array.from({ length: 21 }, () => ({
          equivalents: [{ languageTag: "en", text: "x", status: "manual" }],
        })),
      },
    ];
    for (const body of invalid) {
      const response = await call(user, "POST", "/api/v1/lexicon/entries", {
        body,
      });
      expect(response.status).toBe(400);
      const payload = await response.json<{
        error: { code: string; message: string };
      }>();
      expect(payload.error.code).toBe("INVALID_REQUEST");
      expect(JSON.stringify(payload)).not.toMatch(/SQLITE|stack|at \w+ \(/);
    }
    const badId = await call(
      user,
      "GET",
      "/api/v1/lexicon/entries/..%2F..%2Fetc",
    );
    expect([400, 404]).toContain(badId.status);
    const list = await callJson(user, "GET", "/api/v1/lexicon/entries", 200);
    expect(list.data).toEqual([]);
  });
});
