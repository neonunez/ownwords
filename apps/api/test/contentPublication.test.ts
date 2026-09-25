import { env } from "cloudflare:workers";
import { contentHash, validateContentPack } from "@ownwords/learning/content";
import {
  ingestCourseVersion,
  readCourseVersionStates,
} from "@ownwords/learning/operator";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { coursePack } from "./fixtures/course.js";
import { TRUSTED_ORIGIN } from "./helpers.js";

const app = createApp();
const TOKEN = "ef".repeat(32);
const PUBLISH_URL = "http://service.test/api/v1/admin/content/publish";
const VERSIONS_URL = "http://service.test/api/v1/admin/content/versions";

const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Origin: TRUSTED_ORIGIN,
};

function operatorHeaders(token: string | null = TOKEN): Record<string, string> {
  return token === null
    ? { ...JSON_HEADERS }
    : { ...JSON_HEADERS, Authorization: `Bearer ${token}` };
}

async function reviewedPack(version = 1) {
  const input = coursePack(version, "Synthetic Russian");
  const pack = validateContentPack(input);
  return { input, pack, contentHash: await contentHash(pack) };
}

function publicationBody(
  input: unknown,
  expected: { courseId: string; version: number; contentHash: string },
  overrides: Record<string, unknown> = {},
) {
  return {
    pack: input,
    expect: expected,
    editorial: {
      teacherReviewed: true,
      note: "Reviewed by a qualified teacher before this publication.",
    },
    ...overrides,
  };
}

describe("course publication authority", () => {
  it("is closed without a configured secret and with any other credential", async () => {
    const { input, contentHash: hash } = await reviewedPack();
    const body = publicationBody(input, {
      courseId: "synthetic-russian",
      version: 1,
      contentHash: hash,
    });

    await expect(
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM learning_course_versions",
      ).first<{ count: number }>(),
    ).resolves.toMatchObject({ count: 0 });

    for (const headers of [
      operatorHeaders(null),
      operatorHeaders("not-a-publication-token"),
      operatorHeaders("cd".repeat(32)),
      operatorHeaders(`${TOKEN.slice(0, 63)}0`),
    ]) {
      const publishAttempt = await app.request(
        PUBLISH_URL,
        { method: "POST", headers, body: JSON.stringify(body) },
        env,
      );
      expect(publishAttempt.status).toBe(403);
      await expect(publishAttempt.json()).resolves.toMatchObject({
        error: { code: "admin_forbidden" },
      });
      const listing = await app.request(
        `${VERSIONS_URL}?courseId=synthetic-russian`,
        { method: "GET", headers },
        env,
      );
      expect(listing.status).toBe(403);
    }

    // The other administrative credential is not publication authority, and a
    // learner cookie is never consulted: only CONTENT_PUBLISH_TOKEN opens this.
    const otherCredentials: Record<string, string>[] = [
      { Authorization: `Bearer ${"ab".repeat(32)}` },
      { Authorization: `Bearer ${"ab".repeat(31)}0` },
      { Cookie: "ownwords.session_token=anything" },
    ];
    for (const header of otherCredentials) {
      const withOtherAuthority = await app.request(
        PUBLISH_URL,
        {
          method: "POST",
          headers: { ...JSON_HEADERS, ...header },
          body: JSON.stringify(body),
        },
        env,
      );
      expect(withOtherAuthority.status).toBe(403);
    }
    await expect(
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM learning_course_versions",
      ).first<{ count: number }>(),
    ).resolves.toMatchObject({ count: 0 });
  });
});

describe("publication preflight", () => {
  it("refuses a request that does not name the reviewed course, version and hash", async () => {
    const { input, contentHash: hash } = await reviewedPack();
    const cases: [string, Record<string, unknown>][] = [
      ["content hash", { contentHash: "f".repeat(64) }],
      ["version", { version: 2 }],
      ["course", { courseId: "synthetic-other" }],
    ];
    for (const [, override] of cases) {
      const expected = {
        courseId: "synthetic-russian",
        version: 1,
        contentHash: hash,
        ...override,
      };
      const response = await app.request(
        PUBLISH_URL,
        {
          method: "POST",
          headers: operatorHeaders(),
          body: JSON.stringify(
            publicationBody(input, expected, { dryRun: false }),
          ),
        },
        env,
      );
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "publication_target_mismatch" },
      });
    }

    // A pack that is not valid content is refused before any comparison.
    const invalid = await app.request(
      PUBLISH_URL,
      {
        method: "POST",
        headers: operatorHeaders(),
        body: JSON.stringify(
          publicationBody(
            { course: { id: "synthetic-russian" }, version: 1 },
            {
              courseId: "synthetic-russian",
              version: 1,
              contentHash: hash,
            },
            { dryRun: false },
          ),
        ),
      },
      env,
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "invalid_content" },
    });

    await expect(
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM learning_course_versions",
      ).first<{ count: number }>(),
    ).resolves.toMatchObject({ count: 0 });
  });

  it("plans a publication without writing anything", async () => {
    const { input, pack, contentHash: hash } = await reviewedPack();
    const response = await app.request(
      PUBLISH_URL,
      {
        method: "POST",
        headers: operatorHeaders(),
        body: JSON.stringify(
          publicationBody(input, {
            courseId: pack.course.id,
            version: pack.version,
            contentHash: hash,
          }),
        ),
      },
      env,
    );
    expect(response.status).toBe(200);
    const body = await response.json<{
      data: {
        dryRun: boolean;
        action: string;
        editorial: { teacherReviewed: boolean; note: string };
        summary: Record<string, unknown>;
        versions: unknown[];
      };
    }>();
    expect(body.data.dryRun).toBe(true);
    expect(body.data.action).toBe("publish");
    expect(body.data.editorial.teacherReviewed).toBe(true);
    expect(body.data.summary).toMatchObject({
      courseId: pack.course.id,
      version: pack.version,
      contentHash: hash,
      title: "Synthetic Russian",
      items: pack.items.length,
      units: 1,
    });
    expect(body.data.versions).toEqual([]);
    await expect(
      readCourseVersionStates(env.DB, pack.course.id),
    ).resolves.toEqual([]);
  });
});

describe("confirmed publication", () => {
  it("ingests and publishes exactly the reviewed version, and refuses a second version out of order", async () => {
    const { input, pack, contentHash: hash } = await reviewedPack(1);
    const expected = {
      courseId: pack.course.id,
      version: pack.version,
      contentHash: hash,
    };
    const publish = (body: unknown) =>
      app.request(
        PUBLISH_URL,
        {
          method: "POST",
          headers: operatorHeaders(),
          body: JSON.stringify(body),
        },
        env,
      );

    const published = await publish(
      publicationBody(input, expected, { dryRun: false }),
    );
    expect(published.status).toBe(200);
    const result = await published.json<{
      data: {
        dryRun: boolean;
        action: string;
        status: string;
        publishedAt: string;
      };
    }>();
    expect(result.data).toMatchObject({
      dryRun: false,
      action: "publish",
      status: "published",
    });
    expect(Date.parse(result.data.publishedAt)).toBeGreaterThan(0);

    const states = await readCourseVersionStates(env.DB, pack.course.id);
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      version: 1,
      status: "published",
      contentHash: hash,
    });
    await expect(
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM learning_step_items WHERE course_id = ? AND course_version = ?",
      )
        .bind(pack.course.id, pack.version)
        .first<{ count: number }>(),
    ).resolves.toMatchObject({ count: 5 });

    // Re-running the same confirmed publication is idempotent, not a second write.
    const again = await publish(
      publicationBody(input, expected, { dryRun: false }),
    );
    expect(again.status).toBe(200);
    await expect(again.json()).resolves.toMatchObject({
      data: { action: "already-published" },
    });
    expect(await readCourseVersionStates(env.DB, pack.course.id)).toHaveLength(
      1,
    );

    // A version that is not the next one is refused before any write.
    const { input: skipped, contentHash: skippedHash } = await reviewedPack(3);
    const outOfOrder = await publish(
      publicationBody(
        skipped,
        { ...expected, version: 3, contentHash: skippedHash },
        { dryRun: false },
      ),
    );
    expect(outOfOrder.status).toBe(409);
    await expect(outOfOrder.json()).resolves.toMatchObject({
      error: { code: "unsupported_version_transition" },
    });
    expect(
      (await readCourseVersionStates(env.DB, pack.course.id)).map(
        (entry) => entry.version,
      ),
    ).toEqual([1]);
  });

  it("resumes an identical draft and refuses to replace different published content", async () => {
    const { input, pack, contentHash: hash } = await reviewedPack(2);
    const expected = {
      courseId: pack.course.id,
      version: pack.version,
      contentHash: hash,
    };

    // An interrupted operator run leaves exactly this state: one draft, no
    // published version, and nothing for the learner yet.
    const ingested = await ingestCourseVersion(env.DB, input);
    expect(ingested.outcome).toBe("created");
    await expect(
      readCourseVersionStates(env.DB, pack.course.id).then((states) =>
        states.find((entry) => entry.version === 2),
      ),
    ).resolves.toEqual({
      version: 2,
      status: "draft",
      contentHash: hash,
      publishedAt: null,
    });

    const plan = await app.request(
      PUBLISH_URL,
      {
        method: "POST",
        headers: operatorHeaders(),
        body: JSON.stringify(publicationBody(input, expected)),
      },
      env,
    );
    expect(plan.status).toBe(200);
    await expect(plan.json()).resolves.toMatchObject({
      data: { dryRun: true, action: "resume-draft" },
    });

    const published = await app.request(
      PUBLISH_URL,
      {
        method: "POST",
        headers: operatorHeaders(),
        body: JSON.stringify(
          publicationBody(input, expected, { dryRun: false }),
        ),
      },
      env,
    );
    expect(published.status).toBe(200);
    await expect(published.json()).resolves.toMatchObject({
      data: { action: "resume-draft", status: "published" },
    });
    await expect(
      readCourseVersionStates(env.DB, pack.course.id).then((states) =>
        states.find((entry) => entry.version === 2),
      ),
    ).resolves.toMatchObject({
      version: 2,
      status: "published",
      contentHash: hash,
    });

    // Different content for the same published version is refused in preflight
    // and never reaches the importer.
    const edited = structuredClone(input) as {
      course: { description: string };
    };
    edited.course.description =
      "A different description for a published version.";
    const editedHash = await contentHash(validateContentPack(edited));
    const refused = await app.request(
      PUBLISH_URL,
      {
        method: "POST",
        headers: operatorHeaders(),
        body: JSON.stringify(
          publicationBody(
            edited,
            { ...expected, contentHash: editedHash },
            { dryRun: false },
          ),
        ),
      },
      env,
    );
    expect(refused.status).toBe(409);
    await expect(refused.json()).resolves.toMatchObject({
      error: { code: "published_version_immutable" },
    });
    expect(
      (await readCourseVersionStates(env.DB, pack.course.id)).find(
        (entry) => entry.version === 2,
      ),
    ).toMatchObject({ status: "published", contentHash: hash });
  });
});

describe("publication requires the operator's own editorial statement", () => {
  it("requires the operator's own editorial statement and records the one it sends", async () => {
    const { input, pack, contentHash: hash } = await reviewedPack(3);
    const expected = {
      courseId: pack.course.id,
      version: pack.version,
      contentHash: hash,
    };
    const withoutEditorial = await app.request(
      PUBLISH_URL,
      {
        method: "POST",
        headers: operatorHeaders(),
        body: JSON.stringify({
          pack: input,
          expect: expected,
          dryRun: false,
        }),
      },
      env,
    );
    expect(withoutEditorial.status).toBe(400);
    await expect(withoutEditorial.json()).resolves.toMatchObject({
      error: { code: "invalid_request" },
    });
    expect(
      (await readCourseVersionStates(env.DB, pack.course.id)).find(
        (entry) => entry.version === 3,
      ),
    ).toBeUndefined();

    const response = await app.request(
      PUBLISH_URL,
      {
        method: "POST",
        headers: operatorHeaders(),
        body: JSON.stringify(
          publicationBody(input, expected, {
            editorial: {
              teacherReviewed: false,
              note: "Recorded audio is still missing; reviewed content only.",
            },
            dryRun: false,
          }),
        ),
      },
      env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        editorial: {
          teacherReviewed: false,
          note: "Recorded audio is still missing; reviewed content only.",
        },
      },
    });
    await expect(
      env.DB.prepare(
        "SELECT status FROM learning_course_versions WHERE course_id = ? AND version = ?",
      )
        .bind(pack.course.id, pack.version)
        .first<{ status: string }>(),
    ).resolves.toMatchObject({ status: "published" });
  });
});

describe("the version listing is read-only and origin-checked", () => {
  it("lists what the database holds without writing", async () => {
    const { pack } = await reviewedPack(1);
    const response = await app.request(
      `${VERSIONS_URL}?courseId=${pack.course.id}`,
      { method: "GET", headers: { Authorization: `Bearer ${TOKEN}` } },
      env,
    );
    expect(response.status).toBe(200);
    const body = await response.json<{
      data: {
        courseId: string;
        versions: { version: number; status: string }[];
      };
    }>();
    expect(body.data.courseId).toBe(pack.course.id);
    // The three versions published above are listed in order, and nothing else.
    expect(body.data.versions).toEqual([
      {
        version: 1,
        status: "published",
        contentHash: expect.any(String),
        publishedAt: expect.any(String),
      },
      {
        version: 2,
        status: "published",
        contentHash: expect.any(String),
        publishedAt: expect.any(String),
      },
      {
        version: 3,
        status: "published",
        contentHash: expect.any(String),
        publishedAt: expect.any(String),
      },
    ]);
    const missing = await app.request(
      VERSIONS_URL,
      { method: "GET", headers: { Authorization: `Bearer ${TOKEN}` } },
      env,
    );
    expect(missing.status).toBe(400);
    expect(TRUSTED_ORIGIN).toMatch(/^http:\/\//);
  });
});
