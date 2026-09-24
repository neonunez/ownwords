import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  call,
  callJson,
  personalEntry,
  signedInUser,
  type TestUser,
} from "./e2e.js";
import { insertUser, sessionCookie, TEST_SECRET } from "./helpers.js";
import { makeSignature } from "better-auth/crypto";

let alice: TestUser;
let bob: TestUser;

interface AliceData {
  entryId: string;
  entryVersion: number;
  senseId: string;
  senseVersion: number;
  equivalentId: string;
  equivalentVersion: number;
  clozeId: string;
  cardId: string;
}
let owned: AliceData;

async function reviewCount(userId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM lexicon_review_events WHERE owner_id = ?",
  )
    .bind(userId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

beforeAll(async () => {
  alice = await signedInUser("iso-alice");
  bob = await signedInUser("iso-bob");

  const created = await callJson(
    alice,
    "POST",
    "/api/v1/lexicon/entries",
    201,
    { body: personalEntry },
  );
  const sense = created.data.senses[0];
  const russian = sense.equivalents.find(
    (item: { languageTag: string }) => item.languageTag === "ru",
  );
  const cloze = await callJson(
    alice,
    "POST",
    `/api/v1/lexicon/entries/${created.data.id}/senses/${sense.id}/equivalents/${russian.id}/cloze`,
    201,
    { body: { template: "Ну, {{blank}}!", answer: "пока" } },
  );
  const due = await callJson(
    alice,
    "GET",
    "/api/v1/lexicon/practice/due?language=ru&direction=produce&format=flashcard&sessionId=alice-session",
    200,
  );
  const cardId = due.data[0].card.id;
  await callJson(alice, "POST", "/api/v1/lexicon/practice/reviews", 201, {
    body: {
      submissionId: "alice-review-1",
      cardId,
      sessionId: "alice-session",
      rating: 3,
    },
  });
  owned = {
    entryId: created.data.id,
    entryVersion: created.data.version,
    senseId: sense.id,
    senseVersion: sense.version,
    equivalentId: russian.id,
    equivalentVersion: russian.version,
    clozeId: cloze.data.id,
    cardId,
  };
});

describe("identity at the domain boundary", () => {
  const protectedRoutes: Array<[string, string]> = [
    ["GET", "/api/v1/lexicon/entries"],
    ["POST", "/api/v1/lexicon/entries"],
    ["GET", "/api/v1/lexicon/progress?language=ru"],
    ["GET", "/api/v1/learning/courses"],
    ["GET", "/api/v1/account/export"],
  ];

  it("refuses requests without a session before any domain code runs", async () => {
    for (const [method, path] of protectedRoutes) {
      const response = await call(null, method, path, {
        body: method === "POST" ? personalEntry : undefined,
      });
      expect(response.status, `${method} ${path}`).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "unauthorized",
          message: "A valid session is required",
        },
      });
    }
  });

  it("refuses forged, unauthorized, and expired session identities", async () => {
    const now = Date.now();
    const forgedSignature = await makeSignature(
      `${alice.id}-session-token`,
      "a-different-secret-with-at-least-32-chars",
    );
    await insertUser(env.DB, "iso-uninvited", "uninvited@example.com", now);
    const uninvited = await sessionCookie(
      env.DB,
      "iso-uninvited",
      "iso-uninvited-token",
      now + 60_000,
      now,
      false,
    );
    await insertUser(env.DB, "iso-expired", "expired-iso@example.com", now);
    const expired = await sessionCookie(
      env.DB,
      "iso-expired",
      "iso-expired-token",
      now - 1_000,
      now - 120_000,
    );
    const unknownToken = `unknown-token.${await makeSignature("unknown-token", TEST_SECRET)}`;
    const cookies = [
      `ownwords.session_token=${alice.id}-session-token.${forgedSignature}`,
      `ownwords.session_token=${unknownToken}`,
      uninvited,
      expired,
    ];
    for (const cookie of cookies) {
      for (const [method, path] of protectedRoutes) {
        const response = await call({ id: "forged", cookie }, method, path, {
          body: method === "POST" ? personalEntry : undefined,
        });
        expect(response.status, `${cookie} ${method} ${path}`).toBe(401);
      }
    }
  });

  it("never lets a request body, query, or header select the owner", async () => {
    const spoof = {
      "X-User-Id": alice.id,
      "X-Owner-Id": alice.id,
    };
    const list = await callJson(
      bob,
      "GET",
      `/api/v1/lexicon/entries?userId=${alice.id}&ownerId=${alice.id}`,
      200,
      { headers: spoof },
    );
    expect(list.data).toEqual([]);

    const created = await callJson(
      bob,
      "POST",
      "/api/v1/lexicon/entries",
      201,
      {
        body: { ...personalEntry, ownerId: alice.id, userId: alice.id },
        headers: spoof,
      },
    );
    const row = await env.DB.prepare(
      "SELECT owner_id AS ownerId FROM lexicon_entries WHERE id = ?",
    )
      .bind(created.data.id)
      .first<{ ownerId: string }>();
    expect(row?.ownerId).toBe(bob.id);
    const removed = await call(
      bob,
      "DELETE",
      `/api/v1/lexicon/entries/${created.data.id}`,
      { headers: { "If-Match": `"${created.data.version}"` } },
    );
    expect(removed.status).toBe(204);
  });

  it("requires a trusted Origin and bounded bodies for domain writes", async () => {
    const untrusted = await call(bob, "POST", "/api/v1/lexicon/entries", {
      body: personalEntry,
      headers: { Origin: "https://attacker.example" },
    });
    expect(untrusted.status).toBe(403);

    const oversized = await call(bob, "POST", "/api/v1/lexicon/entries", {
      body: { ...personalEntry, note: "x".repeat(300 * 1024) },
    });
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({
      error: { code: "request_too_large" },
    });
  });
});

describe("cross-user Lexicon isolation", () => {
  it("hides another owner's entry tree from reads", async () => {
    const { entryId, senseId, equivalentId } = owned;
    for (const path of [
      `/api/v1/lexicon/entries/${entryId}`,
      `/api/v1/lexicon/entries/${entryId}/senses/${senseId}/equivalents/${equivalentId}/cloze`,
    ]) {
      const response = await call(bob, "GET", path);
      expect(response.status, path).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "NOT_FOUND" },
      });
    }
    const search = await callJson(
      bob,
      "GET",
      "/api/v1/lexicon/entries?query=hasta",
      200,
    );
    expect(search.data).toEqual([]);
    const aliceSearch = await callJson(
      alice,
      "GET",
      "/api/v1/lexicon/entries?query=hasta",
      200,
    );
    expect(aliceSearch.data.map((entry: { id: string }) => entry.id)).toEqual([
      entryId,
    ]);
  });

  it("refuses writes to another owner's entries, senses, equivalents, and cloze items", async () => {
    const { entryId, senseId, equivalentId, clozeId } = owned;
    const base = `/api/v1/lexicon/entries/${entryId}`;
    const attempts: Array<[string, string, unknown, Record<string, string>?]> =
      [
        ["PATCH", base, { version: owned.entryVersion, note: "hijacked" }],
        ["DELETE", base, undefined, { "If-Match": `"${owned.entryVersion}"` }],
        [
          "POST",
          `${base}/senses`,
          {
            gloss: "injected",
            equivalents: [
              { languageTag: "en", text: "injected", status: "manual" },
            ],
          },
        ],
        [
          "PATCH",
          `${base}/senses/${senseId}`,
          { version: owned.senseVersion, gloss: "hijacked" },
        ],
        [
          "DELETE",
          `${base}/senses/${senseId}`,
          undefined,
          { "If-Match": `"${owned.senseVersion}"` },
        ],
        [
          "POST",
          `${base}/senses/${senseId}/equivalents`,
          { languageTag: "de", text: "tschüss", status: "manual" },
        ],
        [
          "PATCH",
          `${base}/senses/${senseId}/equivalents/${equivalentId}`,
          { version: owned.equivalentVersion, text: "hijacked" },
        ],
        [
          "DELETE",
          `${base}/senses/${senseId}/equivalents/${equivalentId}`,
          undefined,
          { "If-Match": `"${owned.equivalentVersion}"` },
        ],
        [
          "POST",
          `${base}/senses/${senseId}/equivalents/${equivalentId}/cloze`,
          { template: "{{blank}}", answer: "x" },
        ],
        ["POST", `/api/v1/lexicon/cloze/${clozeId}/check`, { answer: "пока" }],
      ];
    for (const [method, path, body, headers] of attempts) {
      const response = await call(bob, method, path, {
        body,
        ...(headers ? { headers } : {}),
      });
      expect(response.status, `${method} ${path}`).toBe(404);
    }

    const intact = await callJson(alice, "GET", base, 200);
    expect(intact.data.version).toBe(owned.entryVersion);
    expect(intact.data.note).toBe(personalEntry.note);
    expect(intact.data.senses).toHaveLength(1);
    expect(intact.data.senses[0].gloss).toBe("leaving politely");
    expect(
      intact.data.senses[0].equivalents.map(
        (item: { text: string }) => item.text,
      ),
    ).toEqual(expect.arrayContaining(["пока́", "hasta luego"]));
  });

  it("keeps practice queues, review history, and progress per owner", async () => {
    const before = await reviewCount(alice.id);
    expect(before).toBe(1);

    const forged = await call(bob, "POST", "/api/v1/lexicon/practice/reviews", {
      body: {
        submissionId: "bob-forged-review",
        cardId: owned.cardId,
        sessionId: "bob-session",
        rating: 1,
      },
    });
    expect(forged.status).toBe(404);
    // Replaying Alice's submission ID from Bob's session is also just "not found".
    const replay = await call(bob, "POST", "/api/v1/lexicon/practice/reviews", {
      body: {
        submissionId: "alice-review-1",
        cardId: owned.cardId,
        sessionId: "alice-session",
        rating: 3,
      },
    });
    expect(replay.status).toBe(404);
    expect(await reviewCount(alice.id)).toBe(before);
    expect(await reviewCount(bob.id)).toBe(0);

    const bobDue = await callJson(
      bob,
      "GET",
      "/api/v1/lexicon/practice/due?language=ru&direction=recognize&format=flashcard&sessionId=bob-session",
      200,
    );
    expect(
      bobDue.data.map((item: { card: { id: string } }) => item.card.id),
    ).not.toContain(owned.cardId);

    const aliceProgress = await callJson(
      alice,
      "GET",
      "/api/v1/lexicon/progress?language=ru",
      200,
    );
    const bobProgress = await callJson(
      bob,
      "GET",
      "/api/v1/lexicon/progress?language=ru",
      200,
    );
    expect(
      aliceProgress.data.find(
        (row: { direction: string }) => row.direction === "produce",
      ).retention,
    ).not.toBeNull();
    for (const row of bobProgress.data) {
      expect(row.retention).toBeNull();
    }
  });
});
