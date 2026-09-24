import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLearningRoutes,
  type LexiconCourseImportService,
  type LearningEnv,
} from "../src";
import { ingestCourseVersion, publishCourseVersion } from "../src/operator";
import { fixture, TestD1 } from "./d1";

const users = new Map([
  ["alice-token", "alice"],
  ["bob-token", "bob"],
]);

let test: TestD1;
let importer: LexiconCourseImportService;
let app: Hono<LearningEnv>;

function request(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return Promise.resolve(
    app.request(`http://test${path}`, { ...init, headers }, { DB: test.db }),
  );
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function recordLesson(
  userToken: string,
  lessonId: string,
  steps: readonly string[],
  version = 1,
): Promise<void> {
  for (const stepId of steps) {
    const response = await request(
      `/api/v1/learning/courses/russian-zero/versions/${version}/lessons/${lessonId}/progress`,
      json("PUT", { stepId }),
      userToken,
    );
    expect(response.status).toBe(200);
  }
}

async function completeHello(
  userToken = "alice-token",
  version = 1,
): Promise<Response> {
  await recordLesson(userToken, "hello", ["hello-hear", "hello-use"], version);
  return request(
    `/api/v1/learning/courses/russian-zero/versions/${version}/lessons/hello/complete`,
    { method: "POST" },
    userToken,
  );
}

interface GatedDatabase {
  gated: D1Database;
  outcomes: unknown[];
}

function gatedBatches(
  database: D1Database,
  participants: number,
): GatedDatabase {
  const waiting: Array<() => void> = [];
  const outcomes: unknown[] = [];
  const gated = Object.create(database) as D1Database;
  gated.batch = async <T = unknown>(statements: D1PreparedStatement[]) => {
    await new Promise<void>((release) => {
      waiting.push(release);
      if (waiting.length === participants) waiting.shift()?.();
    });
    try {
      const results = await database.batch<T>(statements);
      outcomes.push("committed");
      return results;
    } catch (error) {
      outcomes.push(error);
      throw error;
    } finally {
      waiting.shift()?.();
    }
  };
  return { gated, outcomes };
}

function submitStep(
  db: D1Database,
  version: number,
  stepId: string,
): Promise<Response> {
  return Promise.resolve(
    app.request(
      `http://test/api/v1/learning/courses/russian-zero/versions/${version}/lessons/hello/progress`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer alice-token",
        },
        body: JSON.stringify({ stepId }),
      },
      { DB: db },
    ),
  );
}

async function publishVersionTwo(
  course: Record<string, unknown> = {},
): Promise<void> {
  const next = structuredClone(fixture()) as {
    version: number;
    course: Record<string, unknown>;
  };
  next.version = 2;
  Object.assign(next.course, course);
  await ingestCourseVersion(test.db, next);
  await publishCourseVersion(test.db, "russian-zero", 2);
}

function createRoot(
  options: Parameters<typeof createLearningRoutes>[0],
): Hono<LearningEnv> {
  const root = new Hono<LearningEnv>();
  root.use("/api/v1/learning/*", async (c, next) => {
    const authorization = c.req.header("authorization");
    const userId = authorization?.startsWith("Bearer ")
      ? users.get(authorization.slice("Bearer ".length))
      : undefined;
    if (userId) c.set("userId", userId);
    await next();
  });
  root.route("/api/v1/learning", createLearningRoutes(options));
  return root;
}

beforeEach(async () => {
  test = new TestD1();
  await ingestCourseVersion(
    test.db,
    fixture(),
    new Date("2026-01-01T00:00:00Z"),
  );
  await publishCourseVersion(
    test.db,
    "russian-zero",
    1,
    new Date("2026-01-02T00:00:00Z"),
  );
  importer = {
    importCourseEntry: vi.fn(async () => ({
      entryId: "fixture-entry",
      created: true,
    })),
  };
});

afterEach(() => test.close());

beforeEach(() => {
  app = createRoot({
    lexiconImporter: importer,
    clock: () => new Date("2026-01-03T00:00:00Z"),
  });
});

describe("authenticated learning routes", () => {
  it("refuses missing and fabricated HTTP identity", async () => {
    const missing = await request("/api/v1/learning/courses");
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Authentication is required" },
    });
    const fabricated = await request("/api/v1/learning/courses", {
      headers: { "x-user-id": "alice" },
    });
    expect(fabricated.status).toBe(401);
  });

  it("shows only published versions and returns missing/deleted content as not found", async () => {
    const draft = structuredClone(fixture()) as Record<string, unknown>;
    draft.version = 2;
    await ingestCourseVersion(test.db, draft);
    const list = await request("/api/v1/learning/courses", {}, "alice-token");
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      courses: [{ id: "russian-zero", version: 1 }],
    });
    const hidden = await request(
      "/api/v1/learning/courses/russian-zero/versions/2",
      {},
      "alice-token",
    );
    expect(hidden.status).toBe(404);
    const missing = await request(
      "/api/v1/learning/courses/russian-zero/versions/1/lessons/no-such-lesson",
      {},
      "alice-token",
    );
    expect(missing.status).toBe(404);
  });

  it("retrieves renderable lesson items with recorded-audio provenance", async () => {
    const response = await request(
      "/api/v1/learning/courses/russian-zero/versions/1/lessons/hello",
      {},
      "alice-token",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      lesson: {
        steps: [
          { items: [{ itemId: "privet", role: "introduced" }] },
          { items: [{ itemId: "privet", role: "reviewed" }] },
        ],
        contentItems: [
          {
            id: "privet",
            languageTag: "ru",
            displayText: "привет",
            stressText: "приве́т",
            license: { spdxId: "CC0-1.0" },
            provenance: { sourceName: "Ownwords tests" },
            audio: {
              kind: "recorded",
              url: "https://audio.example.invalid/synthetic/privet.ogg",
            },
          },
        ],
      },
    });
  });

  it("rejects invalid, skipped, and cross-lesson progress", async () => {
    const skipped = await request(
      "/api/v1/learning/courses/russian-zero/versions/1/lessons/hello/progress",
      json("PUT", { stepId: "hello-use" }),
      "alice-token",
    );
    expect(skipped.status).toBe(409);
    const crossLesson = await request(
      "/api/v1/learning/courses/russian-zero/versions/1/lessons/hello/progress",
      json("PUT", { stepId: "goodbye-rule" }),
      "alice-token",
    );
    expect(crossLesson.status).toBe(400);
    const unexpectedField = await request(
      "/api/v1/learning/courses/russian-zero/versions/1/lessons/hello/progress",
      json("PUT", { stepId: "hello-hear", userId: "bob" }),
      "alice-token",
    );
    expect(unexpectedField.status).toBe(400);
  });

  it("enforces prerequisites and isolates resume state per user", async () => {
    const locked = await request(
      "/api/v1/learning/courses/russian-zero/versions/1/lessons/goodbye/progress",
      json("PUT", { stepId: "goodbye-rule" }),
      "alice-token",
    );
    expect(locked.status).toBe(403);
    expect((await completeHello()).status).toBe(200);
    const alice = await request(
      "/api/v1/learning/courses/russian-zero/resume",
      {},
      "alice-token",
    );
    expect(await alice.json()).toMatchObject({
      resume: { lessonId: "goodbye", stepId: "goodbye-rule" },
    });
    const bob = await request(
      "/api/v1/learning/courses/russian-zero/resume",
      {},
      "bob-token",
    );
    expect(await bob.json()).toMatchObject({
      resume: { lessonId: "hello", stepId: "hello-hear" },
    });
  });

  it("persists completion and retries failed Lexicon callbacks without duplicates", async () => {
    let fail = true;
    const callback = vi.fn<LexiconCourseImportService["importCourseEntry"]>(
      async () => {
        if (fail) throw new Error("synthetic Lexicon outage");
        return { entryId: "fixture-entry", created: false };
      },
    );
    importer.importCourseEntry = callback;
    const firstCompletion = await completeHello();
    expect(firstCompletion.status).toBe(202);
    expect(await firstCompletion.json()).toMatchObject({
      completion: { lexiconSync: { status: "pending", pendingItems: 1 } },
    });
    expect(
      test.sqlite
        .prepare(
          "SELECT status FROM learning_user_lesson_progress WHERE user_id = 'alice' AND lesson_id = 'hello'",
        )
        .get(),
    ).toEqual({ status: "completed" });

    fail = false;
    const retry = await request(
      "/api/v1/learning/courses/russian-zero/versions/1/lessons/hello/complete",
      { method: "POST" },
      "alice-token",
    );
    expect(retry.status).toBe(200);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ownerId: "alice",
        courseId: "russian-zero",
        courseVersion: "1",
        itemId: "privet",
        senses: [expect.objectContaining({ gloss: "synthetic test greeting" })],
      }),
    );
    const repeated = await request(
      "/api/v1/learning/courses/russian-zero/versions/1/lessons/hello/complete",
      { method: "POST" },
      "alice-token",
    );
    expect(repeated.status).toBe(200);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("reports only the completing lesson's Lexicon export state", async () => {
    const callback = vi.fn<LexiconCourseImportService["importCourseEntry"]>(
      async (input) => {
        if (input.itemId === "privet")
          throw new Error("synthetic Lexicon outage");
        return { entryId: "fixture-entry", created: true };
      },
    );
    importer.importCourseEntry = callback;
    const hello = await completeHello();
    expect(hello.status).toBe(202);
    expect(await hello.json()).toMatchObject({
      completion: { lexiconSync: { status: "pending", pendingItems: 1 } },
    });

    await recordLesson("alice-token", "goodbye", [
      "goodbye-rule",
      "goodbye-use",
    ]);
    const goodbye = await request(
      "/api/v1/learning/courses/russian-zero/versions/1/lessons/goodbye/complete",
      { method: "POST" },
      "alice-token",
    );
    expect(goodbye.status).toBe(200);
    expect(await goodbye.json()).toMatchObject({
      completion: {
        lessonId: "goodbye",
        lexiconSync: { status: "synced", pendingItems: 0 },
      },
    });
    expect(callback.mock.calls.map(([input]) => input.itemId).sort()).toEqual([
      "poka",
      "privet",
    ]);
    expect(
      test.sqlite
        .prepare(
          "SELECT item_id, lesson_id, status FROM learning_lexicon_sync WHERE user_id = 'alice' ORDER BY item_id",
        )
        .all(),
    ).toEqual([
      { item_id: "poka", lesson_id: "goodbye", status: "synced" },
      { item_id: "privet", lesson_id: "hello", status: "pending" },
    ]);
  });

  it("refuses a step write when the lesson completes before the write lands", async () => {
    await recordLesson("alice-token", "hello", ["hello-hear", "hello-use"]);
    let interleaved = false;
    const interleaving = Object.create(test.db) as D1Database;
    interleaving.batch = async <T = unknown>(
      statements: D1PreparedStatement[],
    ) => {
      if (!interleaved) {
        interleaved = true;
        const completion = await request(
          "/api/v1/learning/courses/russian-zero/versions/1/lessons/hello/complete",
          { method: "POST" },
          "alice-token",
        );
        expect(completion.status).toBe(200);
      }
      return test.db.batch<T>(statements);
    };
    const retry = await submitStep(interleaving, 1, "hello-use");
    expect(retry.status).toBe(409);
    expect(await retry.json()).toMatchObject({
      error: { code: "LESSON_ALREADY_COMPLETED" },
    });
    expect(
      test.sqlite
        .prepare(
          `SELECT status, current_step_id, farthest_step_position
           FROM learning_user_lesson_progress WHERE user_id = 'alice' AND lesson_id = 'hello'`,
        )
        .get(),
    ).toEqual({
      status: "completed",
      current_step_id: "hello-use",
      farthest_step_position: 2,
    });
  });

  it("locks reference bodies until their lesson is complete", async () => {
    const before = await request(
      "/api/v1/learning/references?courseId=russian-zero&version=1&category=grammar",
      {},
      "alice-token",
    );
    expect(await before.json()).toMatchObject({
      references: [{ locked: true, body: null }],
    });
    await completeHello();
    const after = await request(
      "/api/v1/learning/references?courseId=russian-zero&version=1&category=grammar",
      {},
      "alice-token",
    );
    expect(await after.json()).toMatchObject({
      references: [{ locked: false, body: { summary: "Test only" } }],
    });
  });

  it("mounts and serves content without any practice adapter", async () => {
    app = createRoot({ lexiconImporter: importer });
    const courses = await request(
      "/api/v1/learning/courses",
      {},
      "alice-token",
    );
    expect(courses.status).toBe(200);
    expect(await courses.json()).toMatchObject({
      courses: [{ id: "russian-zero", version: 1 }],
    });
    await recordLesson("alice-token", "hello", ["hello-hear"]);
    const practice = await request(
      "/api/v1/learning/practice?courseId=russian-zero",
      {},
      "alice-token",
    );
    expect(practice.status).toBe(404);
  });
});

describe("course version pinning", () => {
  it("pins exactly one version when first progress races across versions", async () => {
    await publishVersionTwo();
    const { gated, outcomes } = gatedBatches(test.db, 2);
    const [winner, loser] = await Promise.all([
      submitStep(gated, 1, "hello-hear"),
      submitStep(gated, 2, "hello-hear"),
    ]);
    expect(winner.status).toBe(200);
    expect(loser.status).toBe(409);
    expect(await loser.json()).toMatchObject({
      error: { code: "COURSE_VERSION_MISMATCH" },
    });
    expect(outcomes).toEqual([
      "committed",
      expect.objectContaining({
        message: expect.stringMatching(/FOREIGN KEY constraint failed/),
      }),
    ]);
    expect(
      test.sqlite
        .prepare(
          "SELECT course_version FROM learning_user_course_progress WHERE user_id = 'alice'",
        )
        .all(),
    ).toEqual([{ course_version: 1 }]);
    expect(
      test.sqlite
        .prepare(
          "SELECT course_version, current_step_id FROM learning_user_lesson_progress WHERE user_id = 'alice'",
        )
        .all(),
    ).toEqual([{ course_version: 1, current_step_id: "hello-hear" }]);
  });

  it("accepts a duplicated first-step submission without failing the retry", async () => {
    const { gated, outcomes } = gatedBatches(test.db, 2);
    const responses = await Promise.all([
      submitStep(gated, 1, "hello-hear"),
      submitStep(gated, 1, "hello-hear"),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(outcomes).toEqual(["committed", "committed"]);
    expect(
      test.sqlite
        .prepare(
          `SELECT status, current_step_id, farthest_step_position
           FROM learning_user_lesson_progress WHERE user_id = 'alice'`,
        )
        .all(),
    ).toEqual([
      {
        status: "in_progress",
        current_step_id: "hello-hear",
        farthest_step_position: 1,
      },
    ]);
  });

  it("keeps started users on their version after a newer version is published", async () => {
    expect((await completeHello()).status).toBe(200);
    await publishVersionTwo();

    const aliceCourses = await request(
      "/api/v1/learning/courses",
      {},
      "alice-token",
    );
    expect(await aliceCourses.json()).toMatchObject({
      courses: [{ id: "russian-zero", version: 1 }],
    });
    const bobCourses = await request(
      "/api/v1/learning/courses",
      {},
      "bob-token",
    );
    expect(await bobCourses.json()).toMatchObject({
      courses: [{ id: "russian-zero", version: 2 }],
    });

    const resume = await request(
      "/api/v1/learning/courses/russian-zero/resume",
      {},
      "alice-token",
    );
    expect(await resume.json()).toMatchObject({
      resume: { version: 1, lessonId: "goodbye", stepId: "goodbye-rule" },
    });
    const outline = await request(
      "/api/v1/learning/courses/russian-zero/versions/1",
      {},
      "alice-token",
    );
    expect(await outline.json()).toMatchObject({
      course: {
        units: [
          {
            lessons: [{ id: "hello", status: "completed" }, { id: "goodbye" }],
          },
        ],
      },
    });
    const goodbye = await request(
      "/api/v1/learning/courses/russian-zero/versions/1/lessons/goodbye",
      {},
      "alice-token",
    );
    expect(goodbye.status).toBe(200);
    const references = await request(
      "/api/v1/learning/references?courseId=russian-zero&version=1&category=grammar",
      {},
      "alice-token",
    );
    expect(await references.json()).toMatchObject({
      references: [{ locked: false }],
    });
  });

  it("rejects reads and writes against a version the user did not start", async () => {
    await recordLesson("alice-token", "hello", ["hello-hear", "hello-use"]);
    await publishVersionTwo();
    const paths: Array<[string, RequestInit]> = [
      ["/courses/russian-zero/versions/2", {}],
      ["/courses/russian-zero/versions/2/lessons/hello", {}],
      ["/references?courseId=russian-zero&version=2&category=grammar", {}],
      [
        "/courses/russian-zero/versions/2/lessons/hello/progress",
        json("PUT", { stepId: "hello-hear" }),
      ],
      [
        "/courses/russian-zero/versions/2/lessons/hello/complete",
        { method: "POST" },
      ],
    ];
    for (const [path, init] of paths) {
      const response = await request(
        `/api/v1/learning${path}`,
        init,
        "alice-token",
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: "COURSE_VERSION_MISMATCH" },
      });
    }
    expect(
      test.sqlite
        .prepare(
          "SELECT course_version FROM learning_user_course_progress WHERE user_id = 'alice'",
        )
        .all(),
    ).toEqual([{ course_version: 1 }]);
    expect(
      test.sqlite
        .prepare(
          "SELECT current_step_id FROM learning_user_lesson_progress WHERE user_id = 'alice'",
        )
        .all(),
    ).toEqual([{ current_step_id: "hello-use" }]);
  });

  it("imports each course item into Lexicon once across published versions", async () => {
    const callback = vi.fn<LexiconCourseImportService["importCourseEntry"]>(
      async () => ({ entryId: "fixture-entry", created: true }),
    );
    importer.importCourseEntry = callback;
    expect((await completeHello()).status).toBe(200);
    await publishVersionTwo();
    const otherVersion = await request(
      "/api/v1/learning/courses/russian-zero/versions/2/lessons/hello/complete",
      { method: "POST" },
      "alice-token",
    );
    expect(otherVersion.status).toBe(409);
    const repeated = await request(
      "/api/v1/learning/courses/russian-zero/versions/1/lessons/hello/complete",
      { method: "POST" },
      "alice-token",
    );
    expect(repeated.status).toBe(200);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ courseVersion: "1", itemId: "privet" }),
    );
  });

  it("serves corrected course metadata from the version each user sees", async () => {
    await recordLesson("alice-token", "hello", ["hello-hear"]);
    await publishVersionTwo({
      title: "Corrected Synthetic Russian",
      description: "Corrected synthetic description.",
    });
    const alice = await request("/api/v1/learning/courses", {}, "alice-token");
    expect(await alice.json()).toMatchObject({
      courses: [{ version: 1, title: "Synthetic Russian Test Course" }],
    });
    const bob = await request("/api/v1/learning/courses", {}, "bob-token");
    expect(await bob.json()).toMatchObject({
      courses: [
        {
          version: 2,
          title: "Corrected Synthetic Russian",
          description: "Corrected synthetic description.",
        },
      ],
    });
    const bobOutline = await request(
      "/api/v1/learning/courses/russian-zero/versions/2",
      {},
      "bob-token",
    );
    expect(await bobOutline.json()).toMatchObject({
      course: { languageTag: "ru", title: "Corrected Synthetic Russian" },
    });
  });
});
