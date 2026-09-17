import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  insertUser,
  jsonRequest,
  sessionCookie,
  TRUSTED_ORIGIN,
} from "./helpers.js";

const app = createApp();

beforeAll(async () => {
  await Promise.all([
    insertUser(env.DB, "user-a", "a@example.com"),
    insertUser(env.DB, "user-b", "b@example.com"),
    insertUser(env.DB, "user-expired", "expired@example.com"),
    insertUser(env.DB, "user-revoked", "revoked@example.com"),
    insertUser(env.DB, "user-spoof-target", "spoof-target@example.com"),
    insertUser(env.DB, "user-spoof-source", "spoof-source@example.com"),
    insertUser(env.DB, "user-unauthorized", "unauthorized@example.com"),
    insertUser(env.DB, "user-stable", "stable@example.com"),
  ]);
});

describe("service surface", () => {
  it("serves health without initializing authentication", async () => {
    const response = await app.request("http://service.test/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("returns consistent not-found errors without internal details", async () => {
    const response = await app.request("http://service.test/missing");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "not_found",
        message: "The requested resource was not found",
      },
    });
  });
});

describe("origin and CORS enforcement", () => {
  it("allows credentialed preflight only for a configured origin", async () => {
    const allowed = await app.request(
      "http://service.test/api/v1/profile",
      {
        method: "OPTIONS",
        headers: {
          Origin: TRUSTED_ORIGIN,
          "Access-Control-Request-Method": "GET",
        },
      },
      env,
    );
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
      TRUSTED_ORIGIN,
    );
    expect(allowed.headers.get("Access-Control-Allow-Credentials")).toBe(
      "true",
    );

    const denied = await app.request(
      "http://service.test/api/v1/profile",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://attacker.example",
          "Access-Control-Request-Method": "GET",
        },
      },
      env,
    );
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("rejects unsafe requests with missing or untrusted origins", async () => {
    const cookie = await sessionCookie(
      env.DB,
      "user-a",
      "origin-token",
      Date.now() + 60_000,
    );
    for (const origin of [undefined, "https://attacker.example"] as const) {
      const headers = new Headers({
        "Content-Type": "application/json",
        Cookie: cookie,
      });
      if (origin) headers.set("Origin", origin);
      const response = await app.request(
        "http://service.test/api/v1/onboarding",
        { method: "PUT", headers, body: "{}" },
        env,
      );
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "origin_forbidden" },
      });
    }
  });
});

describe("verified session identity", () => {
  it("ignores spoofed identity headers", async () => {
    const response = await app.request(
      "http://service.test/api/v1/profile",
      { headers: { "X-User-Id": "user-a" } },
      env,
    );
    expect(response.status).toBe(401);
  });

  it("rejects expired and revoked database sessions", async () => {
    const expiredCookie = await sessionCookie(
      env.DB,
      "user-expired",
      "expired-token",
      Date.now() - 1_000,
    );
    const expired = await app.request(
      "http://service.test/api/v1/profile",
      { headers: { Cookie: expiredCookie } },
      env,
    );
    expect(expired.status).toBe(401);

    const revokedCookie = await sessionCookie(
      env.DB,
      "user-revoked",
      "revoked-token",
      Date.now() + 60_000,
    );
    await env.DB.prepare('DELETE FROM "session" WHERE token = ?')
      .bind("revoked-token")
      .run();
    const revoked = await app.request(
      "http://service.test/api/v1/profile",
      { headers: { Cookie: revokedCookie } },
      env,
    );
    expect(revoked.status).toBe(401);
  });

  it("rejects a valid signed session row for a user without an invitation grant", async () => {
    const cookie = await sessionCookie(
      env.DB,
      "user-unauthorized",
      "unauthorized-user-token",
      Date.now() + 60_000,
      Date.now(),
      false,
    );
    const response = await app.request(
      "http://service.test/api/v1/profile",
      { headers: { Cookie: cookie } },
      env,
    );
    expect(response.status).toBe(401);
  });

  it("binds writes to the session even when a different user ID is supplied", async () => {
    const cookie = await sessionCookie(
      env.DB,
      "user-spoof-source",
      "spoof-write-token",
      Date.now() + 60_000,
    );
    const response = await app.request(
      "http://service.test/api/v1/onboarding",
      {
        ...jsonRequest("PUT", {
          languages: [{ tag: "es", kind: "maintain", level: "native" }],
          preferences: {
            explanationLanguage: "en",
            russianCourseAudio: false,
            translationSuggestions: true,
          },
        }),
        headers: {
          ...jsonRequest("PUT").headers,
          Cookie: cookie,
          "X-User-Id": "user-spoof-target",
        },
      },
      env,
    );
    expect(response.status).toBe(200);

    const rows = await env.DB.prepare(
      `SELECT user_id AS userId
       FROM user_profiles
       WHERE user_id IN (?, ?)
       ORDER BY user_id`,
    )
      .bind("user-spoof-source", "user-spoof-target")
      .all<{ userId: string }>();
    expect(rows.results).toEqual([{ userId: "user-spoof-source" }]);
  });
});

describe("Better Auth protocols", () => {
  it("requires a verified session before generating passkey registration options", async () => {
    const unauthenticated = await app.request(
      "http://service.test/api/auth/passkey/generate-register-options",
      { headers: { "CF-Connecting-IP": "192.0.2.10", Origin: TRUSTED_ORIGIN } },
      env,
    );
    expect(unauthenticated.status).toBe(401);

    const cookie = await sessionCookie(
      env.DB,
      "user-a",
      "passkey-options-token",
      Date.now() + 60_000,
    );
    const authenticated = await app.request(
      "http://service.test/api/auth/passkey/generate-register-options",
      {
        headers: {
          "CF-Connecting-IP": "192.0.2.10",
          Cookie: cookie,
          Origin: TRUSTED_ORIGIN,
        },
      },
      env,
    );
    expect(authenticated.status).toBe(200);
    await expect(authenticated.json()).resolves.toMatchObject({
      rp: { id: "localhost", name: "Ownwords" },
      user: { name: "a@example.com" },
    });
  });

  it("starts the Google OAuth protocol without contacting Google", async () => {
    const googleEnv = {
      ...env,
      GOOGLE_CLIENT_ID: "local-test-client.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "local-test-client-secret",
    };
    const request = jsonRequest("POST", {
      provider: "google",
      callbackURL: `${TRUSTED_ORIGIN}/`,
    });
    const response = await app.request(
      "http://service.test/api/auth/sign-in/social",
      {
        ...request,
        headers: { ...request.headers, "CF-Connecting-IP": "192.0.2.11" },
      },
      googleEnv,
    );
    expect(response.status).toBe(200);
    const payload = await response.json<{ url: string; redirect: boolean }>();
    const authorizationUrl = new URL(payload.url);
    expect(payload.redirect).toBe(true);
    expect(authorizationUrl.origin).toBe("https://accounts.google.com");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      `${TRUSTED_ORIGIN}/api/auth/callback/google`,
    );
    expect(response.headers.get("Set-Cookie")).not.toContain(
      "local-test-client-secret",
    );
  });

  it("rejects an untrusted origin before starting an authentication protocol", async () => {
    const response = await app.request(
      "http://service.test/api/auth/sign-in/social",
      jsonRequest("POST", { provider: "google" }, "https://attacker.example"),
      env,
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "origin_forbidden",
        message: "The request origin is not allowed",
      },
    });
  });
});

describe("onboarding profiles", () => {
  it("stores exactly the three approved preferences and canonical language tags", async () => {
    const cookie = await sessionCookie(
      env.DB,
      "user-a",
      "profile-token-a",
      Date.now() + 60_000,
    );
    const response = await app.request(
      "http://service.test/api/v1/onboarding",
      {
        ...jsonRequest("PUT", {
          languages: [
            { tag: "pt-br", kind: "maintain", level: "b2" },
            { tag: "ru", kind: "learn", level: "a0" },
          ],
          preferences: {
            explanationLanguage: "es",
            russianCourseAudio: true,
            translationSuggestions: false,
          },
        }),
        headers: {
          ...jsonRequest("PUT").headers,
          Cookie: cookie,
        },
      },
      env,
    );
    expect(response.status).toBe(200);
    const payload = await response.json<{
      data: {
        profile: {
          languages: { tag: string }[];
          preferences: Record<string, unknown>;
        };
      };
    }>();
    expect(payload.data.profile.languages.map(({ tag }) => tag)).toEqual([
      "pt-BR",
      "ru",
    ]);
    expect(payload.data.profile.preferences).toEqual({
      explanationLanguage: "es",
      russianCourseAudio: true,
      translationSuggestions: false,
    });
  });

  it("keeps language-profile identity stable across re-saves and drops removed languages", async () => {
    const cookie = await sessionCookie(
      env.DB,
      "user-stable",
      "stable-profile-token",
      Date.now() + 60_000,
    );
    type Language = { id: string; tag: string; kind: string; level: string };
    const save = async (languages: unknown[]): Promise<Language[]> => {
      const response = await app.request(
        "http://service.test/api/v1/onboarding",
        {
          ...jsonRequest("PUT", {
            languages,
            preferences: {
              explanationLanguage: "en",
              russianCourseAudio: true,
              translationSuggestions: true,
            },
          }),
          headers: { ...jsonRequest("PUT").headers, Cookie: cookie },
        },
        env,
      );
      expect(response.status).toBe(200);
      const payload = await response.json<{
        data: { profile: { languages: Language[] } };
      }>();
      return payload.data.profile.languages;
    };

    const created = await save([
      { tag: "pt-br", kind: "maintain", level: "b2" },
      { tag: "ru", kind: "learn", level: "a0" },
    ]);
    expect(created.map(({ tag }) => tag)).toEqual(["pt-BR", "ru"]);
    const createdAt = await env.DB.prepare(
      `SELECT language_tag AS tag, created_at AS createdAt
       FROM language_profiles WHERE user_id = ? ORDER BY order_index`,
    )
      .bind("user-stable")
      .all<{ tag: string; createdAt: number }>();

    const unchanged = await save([
      { tag: "pt-BR", kind: "maintain", level: "b2" },
      { tag: "ru", kind: "learn", level: "a0" },
    ]);
    expect(unchanged).toEqual(created);

    const updated = await save([
      { tag: "ru", kind: "learn", level: "a2" },
      { tag: "pt-BR", kind: "maintain", level: "c1" },
    ]);
    expect(updated).toEqual([
      { ...created[1], level: "a2" },
      { ...created[0], level: "c1" },
    ]);
    await expect(
      env.DB.prepare(
        `SELECT language_tag AS tag, created_at AS createdAt
         FROM language_profiles WHERE user_id = ? ORDER BY language_tag`,
      )
        .bind("user-stable")
        .all<{ tag: string; createdAt: number }>()
        .then(({ results }) => results),
    ).resolves.toEqual(
      [...createdAt.results].sort((a, b) => a.tag.localeCompare(b.tag)),
    );

    const reduced = await save([
      { tag: "pt-BR", kind: "maintain", level: "c1" },
    ]);
    expect(reduced).toEqual([{ ...created[0], level: "c1" }]);
  });

  it("scopes profiles to the verified session user", async () => {
    const cookie = await sessionCookie(
      env.DB,
      "user-b",
      "profile-token-b",
      Date.now() + 60_000,
    );
    const response = await app.request(
      "http://service.test/api/v1/profile",
      { headers: { Cookie: cookie } },
      env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { profile: null } });
  });

  it("rejects extra preferences, duplicate languages, and oversized profiles", async () => {
    const cookie = await sessionCookie(
      env.DB,
      "user-a",
      "invalid-profile-token",
      Date.now() + 60_000,
    );
    const invalidBodies = [
      {
        languages: [{ tag: "en", kind: "maintain", level: "native" }],
        preferences: {
          explanationLanguage: "en",
          russianCourseAudio: true,
          translationSuggestions: true,
          dailyBudget: 10,
        },
      },
      {
        languages: [
          { tag: "pt-BR", kind: "maintain", level: "b2" },
          { tag: "pt-br", kind: "learn", level: "a0" },
        ],
        preferences: {
          explanationLanguage: "en",
          russianCourseAudio: true,
          translationSuggestions: true,
        },
      },
    ];

    for (const body of invalidBodies) {
      const response = await app.request(
        "http://service.test/api/v1/onboarding",
        {
          ...jsonRequest("PUT", body),
          headers: { ...jsonRequest("PUT").headers, Cookie: cookie },
        },
        env,
      );
      expect(response.status).toBe(400);
    }
  });
});
