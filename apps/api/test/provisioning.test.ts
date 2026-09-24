import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { TRUSTED_ORIGIN } from "./helpers.js";

/**
 * Drives the real Better Auth Google flow with placeholder client values and a
 * stubbed Google token endpoint. No Google credentials or network are used.
 */
const googleEnv = {
  ...env,
  GOOGLE_CLIENT_ID: "local-test-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "local-test-placeholder",
};
const ADMIN_TOKEN = "ab".repeat(32);
const app = createApp();
const realFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
});

function base64url(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function stubGoogle(email: string, subject: string): void {
  const idToken = [
    base64url({ alg: "RS256", typ: "JWT" }),
    base64url({
      iss: "https://accounts.google.com",
      aud: googleEnv.GOOGLE_CLIENT_ID,
      sub: subject,
      email,
      email_verified: true,
      name: "Synthetic Owner",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    "unsigned-test-signature",
  ].join(".");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new Request(input).url;
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({
        access_token: "local-access-token",
        id_token: idToken,
        expires_in: 3600,
        token_type: "Bearer",
        scope: "openid email profile",
      });
    }
    if (url.startsWith("https://")) {
      throw new Error(`Unexpected outbound request to ${url}`);
    }
    return realFetch(input, init);
  });
}

class CookieJar {
  private readonly values = new Map<string, string>();

  absorb(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const index = pair!.indexOf("=");
      const name = pair!.slice(0, index);
      const value = pair!.slice(index + 1);
      if (value === "" || /max-age=0/i.test(header)) this.values.delete(name);
      else this.values.set(name, value);
    }
  }

  header(): string {
    return [...this.values]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  has(name: string): boolean {
    return this.values.has(name);
  }
}

async function send(
  jar: CookieJar,
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const response = await app.request(
    `${TRUSTED_ORIGIN}${path}`,
    {
      method,
      redirect: "manual",
      headers: {
        Origin: TRUSTED_ORIGIN,
        ...(jar.header() ? { Cookie: jar.header() } : {}),
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...options.headers,
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    googleEnv,
  );
  jar.absorb(response);
  return response;
}

async function signInWithGoogle(
  jar: CookieJar,
  email: string,
  subject: string,
) {
  stubGoogle(email, subject);
  const start = await send(jar, "POST", "/api/auth/sign-in/social", {
    body: { provider: "google", callbackURL: "/" },
  });
  expect(start.status).toBe(200);
  const { url } = await start.json<{ url: string }>();
  const authorization = new URL(url);
  expect(authorization.origin).toBe("https://accounts.google.com");
  const state = authorization.searchParams.get("state");
  expect(state).toBeTruthy();
  return send(
    jar,
    "GET",
    `/api/auth/callback/google?code=local-code&state=${encodeURIComponent(state!)}`,
  );
}

async function userIdFor(email: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT id FROM "user" WHERE email = ?`)
    .bind(email)
    .first<{ id: string }>();
  return row?.id ?? null;
}

describe("secure initial provisioning", () => {
  it("lets the owner provision their own first account through the admin API and Google", async () => {
    const users = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM "user"`,
    ).first<{
      count: number;
    }>();
    expect(users?.count).toBe(0);

    const admin = new CookieJar();
    const issued = await send(admin, "POST", "/api/v1/admin/invitations", {
      body: { email: "owner@example.com" },
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(issued.status).toBe(201);
    const { data: invitation } = await issued.json<{
      data: { code: string };
    }>();

    const owner = new CookieJar();
    const redeemed = await send(owner, "POST", "/api/v1/invitations/redeem", {
      body: { code: invitation.code, email: "owner@example.com" },
    });
    expect(redeemed.status).toBe(200);
    expect(owner.has("ownwords-signup")).toBe(true);

    const callback = await signInWithGoogle(
      owner,
      "owner@example.com",
      "google-owner",
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toBe("/");
    expect(owner.has("ownwords.session_token")).toBe(true);
    expect(owner.has("ownwords-signup")).toBe(false);

    const ownerId = await userIdFor("owner@example.com");
    expect(ownerId).not.toBeNull();
    await expect(
      env.DB.prepare(
        "SELECT accepted_by_user_id AS acceptedBy FROM invitations WHERE email = ?",
      )
        .bind("owner@example.com")
        .first(),
    ).resolves.toEqual({ acceptedBy: ownerId });

    const created = await send(owner, "POST", "/api/v1/lexicon/entries", {
      body: {
        kind: "word",
        senses: [
          {
            gloss: "first word",
            equivalents: [
              { languageTag: "en", text: "hello", status: "manual" },
            ],
          },
        ],
      },
    });
    expect(created.status).toBe(201);

    // The first account gains no administrative authority from being first.
    const escalation = await send(owner, "POST", "/api/v1/admin/invitations", {
      body: { email: "friend@example.com" },
    });
    expect(escalation.status).toBe(403);
    await expect(escalation.json()).resolves.toMatchObject({
      error: { code: "admin_forbidden" },
    });
    const invitations = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM invitations WHERE email = ?",
    )
      .bind("friend@example.com")
      .first<{ count: number }>();
    expect(invitations?.count).toBe(0);
  });

  it("refuses an uninvited Google account without creating a user or session", async () => {
    const stranger = new CookieJar();
    const callback = await signInWithGoogle(
      stranger,
      "stranger@example.com",
      "google-stranger",
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toMatch(
      /\/api\/auth\/error\?error=invitation_required/,
    );
    expect(stranger.has("ownwords.session_token")).toBe(false);
    expect(await userIdFor("stranger@example.com")).toBeNull();
    const denied = await send(stranger, "GET", "/api/v1/lexicon/entries");
    expect(denied.status).toBe(401);
  });

  it("refuses a redeemed invitation presented for a different Google email", async () => {
    const admin = new CookieJar();
    const issued = await send(admin, "POST", "/api/v1/admin/invitations", {
      body: { email: "invited@example.com" },
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const { data: invitation } = await issued.json<{
      data: { code: string };
    }>();
    const holder = new CookieJar();
    expect(
      (
        await send(holder, "POST", "/api/v1/invitations/redeem", {
          body: { code: invitation.code, email: "invited@example.com" },
        })
      ).status,
    ).toBe(200);
    const callback = await signInWithGoogle(
      holder,
      "someone-else@example.com",
      "google-else",
    );
    expect(callback.headers.get("Location")).toMatch(
      /\/api\/auth\/error\?error=invitation_required/,
    );
    expect(await userIdFor("someone-else@example.com")).toBeNull();
    expect(holder.has("ownwords.session_token")).toBe(false);
  });
});
