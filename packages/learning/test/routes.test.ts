import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLearningRoutes,
  type LexiconCourseImportService,
  type LearningEnv,
  type LearningPracticeSource,
} from "../src";
import { ingestCourseVersion, publishCourseVersion } from "../src/operator";
import { fixture, TestD1 } from "./d1";

const users = new Map([
  ["alice-token", "alice"],
  ["bob-token", "bob"],
]);

let test: TestD1;
let importer: LexiconCourseImportService;
let practice: LearningPracticeSource;
let app: Hono<LearningEnv>;

function request(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return Promise.resolve(app.request(`http://test${path}`, { ...init, headers }, { DB: test.db }));
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function recordLesson(userToken: string, lessonId: string, steps: readonly string[]): Promise<void> {
  for (const stepId of steps) {
    const response = await request(
      `/api/v1/learning/courses/russian-zero/versions/1/lessons/${lessonId}/progress`,
      json("PUT", { stepId }),
      userToken,
    );
    expect(response.status).toBe(200);
  }
}

async function completeHello(userToken = "alice-token"): Promise<Response> {
  await recordLesson(userToken, "hello", ["hello-hear", "hello-use"]);
  return request(
    "/api/v1/learning/courses/russian-zero/versions/1/lessons/hello/complete",
    { method: "POST" },
    userToken,
  );
}

beforeEach(async () => {
  test = new TestD1();
  await ingestCourseVersion(test.db, fixture(), new Date("2026-01-01T00:00:00Z"));
  await publishCourseVersion(test.db, "russian-zero", 1, new Date("2026-01-02T00:00:00Z"));
  importer = { importCourseEntry: vi.fn(async () => ({ entryId: "fixture-entry", created: true })) };
  practice = {
    listDue: vi.fn<LearningPracticeSource["listDue"]>(async () => [
      { id: "shared-due-1", format: "cloze", payload: { fixture: true } },
    ]),
  };
});

afterEach(() => test.close());

beforeEach(() => {
  const root = new Hono<LearningEnv>();
  root.use("/api/v1/learning/*", async (c, next) => {
    const authorization = c.req.header("authorization");
    const userId = authorization?.startsWith("Bearer ")
      ? users.get(authorization.slice("Bearer ".length))
      : undefined;
    if (userId) c.set("userId", userId);
    await next();
  });
  root.route(
    "/api/v1/learning",
    createLearningRoutes({
      lexiconImporter: importer,
      practiceSource: practice,
      clock: () => new Date("2026-01-03T00:00:00Z"),
    }),
  );
  app = root;
});

describe("authenticated learning routes", () => {
  it("refuses missing and fabricated HTTP identity", async () => {
    const missing = await request("/api/v1/learning/courses");
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Authentication is required" },
    });
    const fabricated = await request("/api/v1/learning/courses", { headers: { "x-user-id": "alice" } });
    expect(fabricated.status).toBe(401);
  });

  it("shows only published versions and returns missing/deleted content as not found", async () => {
    const draft = structuredClone(fixture()) as Record<string, unknown>;
    draft.version = 2;
    await ingestCourseVersion(test.db, draft);
    const list = await request("/api/v1/learning/courses", {}, "alice-token");
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ courses: [{ id: "russian-zero", version: 1 }] });
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
        contentItems: [{
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
        }],
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
    const alice = await request("/api/v1/learning/courses/russian-zero/resume", {}, "alice-token");
    expect(await alice.json()).toMatchObject({ resume: { lessonId: "goodbye", stepId: "goodbye-rule" } });
    const bob = await request("/api/v1/learning/courses/russian-zero/resume", {}, "bob-token");
    expect(await bob.json()).toMatchObject({ resume: { lessonId: "hello", stepId: "hello-hear" } });
  });

  it("persists completion and retries failed Lexicon callbacks without duplicates", async () => {
    let fail = true;
    const callback = vi.fn<LexiconCourseImportService["importCourseEntry"]>(async () => {
      if (fail) throw new Error("synthetic Lexicon outage");
      return { entryId: "fixture-entry", created: false };
    });
    importer.importCourseEntry = callback;
    const firstCompletion = await completeHello();
    expect(firstCompletion.status).toBe(202);
    expect(await firstCompletion.json()).toMatchObject({
      completion: { lexiconSync: { status: "pending", pendingItems: 1 } },
    });
    expect(test.sqlite.prepare(
      "SELECT status FROM learning_user_lesson_progress WHERE user_id = 'alice' AND lesson_id = 'hello'",
    ).get()).toEqual({ status: "completed" });

    fail = false;
    const retry = await request(
      "/api/v1/learning/courses/russian-zero/versions/1/lessons/hello/complete",
      { method: "POST" },
      "alice-token",
    );
    expect(retry.status).toBe(200);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({
      ownerId: "alice",
      courseId: "russian-zero",
      courseVersion: "1",
      itemId: "privet",
      senses: [expect.objectContaining({ gloss: "synthetic test greeting" })],
    }));
    const repeated = await request(
      "/api/v1/learning/courses/russian-zero/versions/1/lessons/hello/complete",
      { method: "POST" },
      "alice-token",
    );
    expect(repeated.status).toBe(200);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("locks reference bodies until their lesson is complete", async () => {
    const before = await request(
      "/api/v1/learning/references?courseId=russian-zero&version=1&category=grammar",
      {},
      "alice-token",
    );
    expect(await before.json()).toMatchObject({ references: [{ locked: true, body: null }] });
    await completeHello();
    const after = await request(
      "/api/v1/learning/references?courseId=russian-zero&version=1&category=grammar",
      {},
      "alice-token",
    );
    expect(await after.json()).toMatchObject({ references: [{ locked: false, body: { summary: "Test only" } }] });
  });

  it("delegates Learn practice to the shared scheduler with verified identity", async () => {
    const response = await request(
      "/api/v1/learning/practice?courseId=russian-zero&limit=7",
      {},
      "alice-token",
    );
    expect(response.status).toBe(200);
    expect(practice.listDue).toHaveBeenCalledWith({ userId: "alice", languageTag: "ru", limit: 7 });
    expect(await response.json()).toMatchObject({ practice: [{ id: "shared-due-1" }] });
  });
});
