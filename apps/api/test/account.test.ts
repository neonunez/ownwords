import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  call,
  callJson,
  finishLesson,
  personalEntry,
  publishCourseVersions,
  signedInUser,
  type TestUser,
} from "./e2e.js";
import { COURSE_ID } from "./fixtures/course.js";

let alice: TestUser;
let bob: TestUser;
let aliceEntryId: string;
let bobEntryId: string;

beforeAll(async () => {
  await publishCourseVersions(1);
  alice = await signedInUser("export-alice");
  bob = await signedInUser("export-bob");
  await env.DB.prepare(
    `INSERT INTO passkey (id, name, publicKey, userId, credentialID, counter, deviceType, backedUp, createdAt)
     VALUES ('pk-alice', 'Alice phone', 'secret-public-key-material', ?, 'cred-alice', 0, 'multiDevice', 1, ?)`,
  )
    .bind(alice.id, Date.now())
    .run();
  await callJson(alice, "PUT", "/api/v1/onboarding", 200, {
    body: {
      languages: [
        { tag: "en", kind: "maintain", level: "native" },
        { tag: "ru", kind: "learn", level: "a0" },
      ],
      preferences: {
        explanationLanguage: "es",
        russianCourseAudio: true,
        translationSuggestions: false,
      },
    },
  });
  aliceEntryId = (
    await callJson(alice, "POST", "/api/v1/lexicon/entries", 201, {
      body: personalEntry,
    })
  ).data.id;
  bobEntryId = (
    await callJson(bob, "POST", "/api/v1/lexicon/entries", 201, {
      body: { ...personalEntry, note: "Bob's private note" },
    })
  ).data.id;
  const due = await callJson(
    alice,
    "GET",
    "/api/v1/lexicon/practice/due?language=ru&direction=recognize&format=flashcard&sessionId=export-session",
    200,
  );
  await callJson(alice, "POST", "/api/v1/lexicon/practice/reviews", 201, {
    body: {
      submissionId: "export-review",
      cardId: due.data[0].card.id,
      sessionId: "export-session",
      rating: 4,
    },
  });
  const done = await finishLesson(alice, COURSE_ID, 1, "greet", [
    "greet-hear",
    "greet-use",
  ]);
  expect(done.status).toBe(200);
});

describe("account export", () => {
  it("composes every package's data for the signed-in owner only", async () => {
    const response = await call(alice, "GET", "/api/v1/account/export");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="ownwords-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    const body = await response.json<any>();

    expect(body.format).toBe("ownwords-account-export/1");
    expect(body.account).toMatchObject({
      id: alice.id,
      email: `${alice.id}@example.com`,
      passkeys: [{ name: "Alice phone", deviceType: "multiDevice" }],
    });
    expect(body.profile.preferences.explanationLanguage).toBe("es");
    expect(body.profile.languages.map((l: { tag: string }) => l.tag)).toEqual([
      "en",
      "ru",
    ]);

    const entryIds = body.lexicon.entries.map((e: { id: string }) => e.id);
    expect(entryIds).toContain(aliceEntryId);
    expect(entryIds).not.toContain(bobEntryId);
    expect(body.lexicon.entries).toHaveLength(3);
    expect(body.lexicon.reviewEvents).toHaveLength(1);
    expect(body.lexicon.reviewEvents[0]).toMatchObject({
      submissionId: "export-review",
      rating: 4,
    });
    expect(
      body.lexicon.courseImports.map((row: { itemId: string }) => row.itemId),
    ).toEqual(["spasibo", "zdravstvuj"]);
    expect(
      body.lexicon.equivalents.find(
        (row: { text: string }) => row.text === "спасибо",
      ).provenance,
    ).toMatchObject({ license: { spdxId: "CC0-1.0" } });

    expect(body.learning.enrollments).toEqual([
      expect.objectContaining({ courseId: COURSE_ID, courseVersion: 1 }),
    ]);
    expect(body.learning.lessonProgress).toEqual([
      expect.objectContaining({ lessonId: "greet", status: "completed" }),
    ]);
    expect(
      body.learning.lexiconSync.every(
        (row: { status: string }) => row.status === "synced",
      ),
    ).toBe(true);

    const serialized = JSON.stringify(body);
    for (const secret of [
      bob.id,
      "Bob's private note",
      "secret-public-key-material",
      `${alice.id}-session-token`,
      "owner_id",
      "ownerId",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("returns an empty but complete export for a new account", async () => {
    const fresh = await signedInUser("export-fresh");
    const body = await callJson(fresh, "GET", "/api/v1/account/export", 200);
    expect(body.profile).toBeNull();
    expect(body.lexicon).toEqual({
      entries: [],
      senses: [],
      equivalents: [],
      clozeItems: [],
      practiceCards: [],
      reviewEvents: [],
      courseImports: [],
    });
    expect(body.learning).toEqual({
      enrollments: [],
      lessonProgress: [],
      lexiconSync: [],
    });
  });
});
