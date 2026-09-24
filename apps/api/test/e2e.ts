import { env, exports } from "cloudflare:workers";
import {
  ingestCourseVersion,
  publishCourseVersion,
} from "@ownwords/learning/operator";
import { coursePack } from "./fixtures/course.js";
import { insertUser, sessionCookie, TRUSTED_ORIGIN } from "./helpers.js";

/**
 * Credential-free signed-in user: a real Better Auth session row whose cookie is
 * signed with the test secret, so every request passes the production session
 * verification and invitation-authorization checks.
 */
export interface TestUser {
  id: string;
  cookie: string;
}

export async function signedInUser(id: string): Promise<TestUser> {
  const now = Date.now();
  await insertUser(env.DB, id, `${id}@example.com`, now);
  const cookie = await sessionCookie(
    env.DB,
    id,
    `${id}-session-token`,
    now + 60 * 60 * 1000,
    now,
  );
  return { id, cookie };
}

export interface CallOptions {
  body?: unknown;
  headers?: Record<string, string>;
}

/** Sends a request through the deployed Worker entrypoint, not a test-built app. */
export async function call(
  user: TestUser | null,
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (!headers.has("Origin")) headers.set("Origin", TRUSTED_ORIGIN);
  if (user) headers.set("Cookie", user.cookie);
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body =
      typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body);
  }
  return exports.default.fetch(
    new Request(`${TRUSTED_ORIGIN}${path}`, { method, headers, body }),
  );
}

export async function callJson<T = any>(
  user: TestUser | null,
  method: string,
  path: string,
  expectedStatus: number,
  options: CallOptions = {},
): Promise<T> {
  const response = await call(user, method, path, options);
  const text = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(
      `${method} ${path} returned ${response.status}, expected ${expectedStatus}: ${text}`,
    );
  }
  return JSON.parse(text) as T;
}

/** Publishes synthetic course versions in order, skipping any already published. */
export async function publishCourseVersions(through: number): Promise<void> {
  const courseId = coursePack(1).course.id;
  const row = await env.DB.prepare(
    "SELECT MAX(version) AS version FROM learning_course_versions WHERE course_id = ?",
  )
    .bind(courseId)
    .first<{ version: number | null }>();
  for (
    let version = (row?.version ?? 0) + 1;
    version <= through;
    version += 1
  ) {
    await ingestCourseVersion(
      env.DB,
      coursePack(version, `Synthetic Russian v${version}`),
    );
    await publishCourseVersion(env.DB, courseId, version);
  }
}

/** Records every step of a lesson in order, then completes it. */
export async function finishLesson(
  user: TestUser,
  courseId: string,
  version: number,
  lessonId: string,
  stepIds: readonly string[],
): Promise<Response> {
  const base = `/api/v1/learning/courses/${courseId}/versions/${version}/lessons/${lessonId}`;
  for (const stepId of stepIds) {
    await callJson(user, "PUT", `${base}/progress`, 200, {
      body: { stepId },
    });
  }
  return call(user, "POST", `${base}/complete`);
}

export const personalEntry = {
  kind: "expression",
  note: "what I say when I leave a meeting",
  senses: [
    {
      gloss: "leaving politely",
      equivalents: [
        { languageTag: "en", text: "see you later", status: "manual" },
        { languageTag: "es", text: "hasta luego", status: "confirmed" },
        { languageTag: "ru", text: "пока́", status: "confirmed" },
      ],
    },
  ],
};
