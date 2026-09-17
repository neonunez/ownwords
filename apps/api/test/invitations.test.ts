import { env } from "cloudflare:workers";
import type {
  ValidateUserInfoMethod,
  ValidateUserInfoSource,
} from "better-auth";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { authorizeRegistration } from "../src/auth.js";
import {
  consumeSignupAuthorization,
  findSignupAuthorization,
  redeemInvitation,
  sha256,
} from "../src/invitations.js";
import { insertUser, jsonRequest, sessionCookie } from "./helpers.js";

const app = createApp();

async function insertInvitation(
  id: string,
  code: string,
  email: string,
  options: {
    expiresAt?: number;
    revokedAt?: number | null;
    acceptedAt?: number | null;
  } = {},
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO invitations
      (id, code_hash, email, expires_at, created_at, revoked_at, accepted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      await sha256(code),
      email,
      options.expiresAt ?? now + 60_000,
      now - 1_000,
      options.revokedAt ?? null,
      options.acceptedAt ?? null,
    )
    .run();
}

function cookieValue(setCookie: string | null): string {
  const match = setCookie?.match(/(?:^|,\s*)ownwords-signup=([^;]+)/);
  if (!match?.[1]) throw new Error("Signup cookie was not set");
  return match[1];
}

describe("invitation redemption", () => {
  it("authorizes only the invited email with a short-lived HTTP-only cookie", async () => {
    const code = "valid-invitation-code-000000000001";
    await insertInvitation("invite-valid", code, "invited@example.com");

    const response = await app.request(
      "http://service.test/api/v1/invitations/redeem",
      jsonRequest("POST", { code, email: "Invited@Example.com" }),
      env,
    );
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("Set-Cookie");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain("Secure");

    const token = cookieValue(setCookie);
    await expect(
      findSignupAuthorization(env.DB, token, "invited@example.com", Date.now()),
    ).resolves.toMatchObject({
      invitationId: "invite-valid",
      email: "invited@example.com",
    });
    await expect(
      findSignupAuthorization(
        env.DB,
        token,
        "attacker@example.com",
        Date.now(),
      ),
    ).resolves.toBeNull();
  });

  it("does not reveal whether an invite is wrong, expired, revoked, accepted, or email-mismatched", async () => {
    const now = Date.now();
    const cases = [
      {
        id: "expired",
        code: "expired-invitation-code-00000000001",
        expiresAt: now - 1,
      },
      {
        id: "revoked",
        code: "revoked-invitation-code-00000000001",
        revokedAt: now - 1,
      },
      {
        id: "accepted",
        code: "accepted-invitation-code-0000000001",
        acceptedAt: now - 1,
      },
    ];
    for (const entry of cases) {
      await insertInvitation(
        entry.id,
        entry.code,
        `${entry.id}@example.com`,
        entry,
      );
      const response = await app.request(
        "http://service.test/api/v1/invitations/redeem",
        jsonRequest("POST", {
          code: entry.code,
          email: `${entry.id}@example.com`,
        }),
        env,
      );
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "invitation_invalid",
          message: "The invitation is invalid or unavailable",
        },
      });
    }

    const wrongEmailCode = "wrong-email-invitation-code-000000001";
    await insertInvitation("wrong-email", wrongEmailCode, "right@example.com");
    const wrongEmail = await app.request(
      "http://service.test/api/v1/invitations/redeem",
      jsonRequest("POST", { code: wrongEmailCode, email: "wrong@example.com" }),
      env,
    );
    expect(wrongEmail.status).toBe(403);
  });

  it("rate-limits repeated attempts by client address", async () => {
    const request = () =>
      app.request(
        "http://service.test/api/v1/invitations/redeem",
        {
          ...jsonRequest("POST", {
            code: "invalid-invitation-code-00000000001",
            email: "nobody@example.com",
          }),
          headers: {
            ...jsonRequest("POST").headers,
            "CF-Connecting-IP": "192.0.2.50",
          },
        },
        env,
      );

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await request()).status).toBe(403);
    }
    const limited = await request();
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toEqual({
      error: { code: "rate_limited", message: "Too many invitation attempts" },
    });
  });
});

describe("invitation administration", () => {
  const adminHeaders = () => ({
    ...jsonRequest("POST").headers,
    Authorization: `Bearer ${"ab".repeat(32)}`,
  });

  it("issues an invitation with a hashed code and returns it once", async () => {
    const response = await app.request(
      "http://service.test/api/v1/admin/invitations",
      {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ email: "Family@Example.com" }),
      },
      env,
    );
    expect(response.status).toBe(201);
    const body = await response.json<{
      data: { id: string; code: string; email: string; expiresAt: string };
    }>();
    expect(body.data.email).toBe("family@example.com");
    expect(body.data.code.length).toBeGreaterThanOrEqual(20);
    await expect(
      env.DB.prepare("SELECT code_hash FROM invitations WHERE id = ?")
        .bind(body.data.id)
        .first<{ code_hash: string }>(),
    ).resolves.toMatchObject({ code_hash: await sha256(body.data.code) });

    const redeemed = await app.request(
      "http://service.test/api/v1/invitations/redeem",
      jsonRequest("POST", {
        code: body.data.code,
        email: "family@example.com",
      }),
      env,
    );
    expect(redeemed.status).toBe(200);
  });

  it("rejects anonymous, non-admin users, and malformed tokens", async () => {
    const anonymous = await app.request(
      "http://service.test/api/v1/admin/invitations",
      {
        method: "POST",
        headers: jsonRequest("POST").headers,
        body: JSON.stringify({ email: "anon@example.com" }),
      },
      env,
    );
    expect(anonymous.status).toBe(403);

    for (const token of [
      "not-a-hex-admin-token-at-all",
      `${"cd".repeat(31)}0`,
      `${"ab".repeat(31)}0`,
    ]) {
      const response = await app.request(
        "http://service.test/api/v1/admin/invitations",
        {
          method: "POST",
          headers: {
            ...jsonRequest("POST").headers,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ email: "x@example.com" }),
        },
        env,
      );
      expect(response.status).toBe(403);
    }
  });

  it("does not promote the first signup or trust client-supplied roles", async () => {
    const now = Date.now();
    await insertUser(env.DB, "regular-user", "regular@example.com", now);
    const cookie = await sessionCookie(
      env.DB,
      "regular-user",
      "regular-session-token",
      now + 60_000,
      now,
    );
    const before = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM invitations",
    ).first();
    const response = await app.request(
      "http://service.test/api/v1/admin/invitations",
      {
        method: "POST",
        headers: {
          ...jsonRequest("POST").headers,
          Cookie: cookie,
          "X-Role": "admin",
        },
        body: JSON.stringify({ email: "still@example.com", role: "admin" }),
      },
      env,
    );
    expect(response.status).toBe(403);
    await expect(
      env.DB.prepare("SELECT COUNT(*) AS count FROM invitations").first(),
    ).resolves.toEqual(before);
  });

  it("honors trusted-origin enforcement and revocation of unaccepted invitations", async () => {
    const issueResponse = await app.request(
      "http://service.test/api/v1/admin/invitations",
      {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ email: "revoke@example.com" }),
      },
      env,
    );
    expect(issueResponse.status).toBe(201);
    const { data } = await issueResponse.json<{
      data: { id: string; code: string };
    }>();

    const crossOrigin = await app.request(
      "http://service.test/api/v1/admin/invitations",
      {
        method: "POST",
        headers: { ...adminHeaders(), Origin: "https://evil.example" },
        body: JSON.stringify({ email: "evil@example.com" }),
      },
      env,
    );
    expect(crossOrigin.status).toBe(403);

    const revoke = await app.request(
      "http://service.test/api/v1/admin/invitations/" + data.id,
      {
        method: "DELETE",
        headers: {
          ...jsonRequest("DELETE").headers,
          Authorization: `Bearer ${"ab".repeat(32)}`,
        },
      },
      env,
    );
    expect(revoke.status).toBe(200);

    const redeem = await app.request(
      "http://service.test/api/v1/invitations/redeem",
      jsonRequest("POST", { code: data.code, email: "revoke@example.com" }),
      env,
    );
    expect(redeem.status).toBe(403);

    const again = await app.request(
      "http://service.test/api/v1/admin/invitations/" + data.id,
      {
        method: "DELETE",
        headers: {
          ...jsonRequest("DELETE").headers,
          Authorization: `Bearer ${"ab".repeat(32)}`,
        },
      },
      env,
    );
    expect(again.status).toBe(200);
  });

  it("requires an exactly configured 64-hex token and rejects expiry past 30 days", async () => {
    const tooLong = await app.request(
      "http://service.test/api/v1/admin/invitations",
      {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          email: "long@example.com",
          expiresInSeconds: 40 * 24 * 3600,
        }),
      },
      env,
    );
    expect(tooLong.status).toBe(400);
  });

  it("fails closed without a valid configured secret and after rotation", async () => {
    for (const configured of [
      undefined,
      "",
      "replace-me",
      "zz".repeat(32),
      "cd".repeat(32),
    ]) {
      const response = await app.request(
        "http://service.test/api/v1/admin/invitations",
        {
          method: "POST",
          headers: adminHeaders(),
          body: JSON.stringify({ email: "disabled@example.com" }),
        },
        { ...env, INVITATION_ADMIN_TOKEN: configured },
      );
      expect(response.status).toBe(403);
    }
  });

  it("bounds input and requires Origin even with the correct token", async () => {
    for (const body of [
      "{",
      JSON.stringify({ email: "bad" }),
      JSON.stringify({ email: "ok@example.com", role: "admin" }),
    ]) {
      const response = await app.request(
        "http://service.test/api/v1/admin/invitations",
        { method: "POST", headers: adminHeaders(), body },
        env,
      );
      expect(response.status).toBe(400);
    }
    const oversized = await app.request(
      "http://service.test/api/v1/admin/invitations",
      { method: "POST", headers: adminHeaders(), body: "a".repeat(4097) },
      env,
    );
    expect(oversized.status).toBe(413);
    const missingOrigin = await app.request(
      "http://service.test/api/v1/admin/invitations",
      {
        method: "POST",
        headers: { Authorization: adminHeaders().Authorization },
        body: "{}",
      },
      env,
    );
    expect(missingOrigin.status).toBe(403);
    const preflight = await app.request(
      "http://service.test/api/v1/admin/invitations",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example",
          "Access-Control-Request-Headers": "Authorization",
        },
      },
      env,
    );
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(preflight.headers.get("Access-Control-Allow-Headers")).not.toContain(
      "Authorization",
    );
  });

  it("expires issued invitations and invalidates redeemed authorizations on revocation", async () => {
    let now = Date.now();
    const timedApp = createApp({ now: () => now });
    const issue = await timedApp.request(
      "http://service.test/api/v1/admin/invitations",
      {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          email: "timed@example.com",
          expiresInSeconds: 3600,
        }),
      },
      env,
    );
    expect(issue.status).toBe(201);
    expect(issue.headers.get("Cache-Control")).toBe("no-store");
    const { data } = await issue.json<{
      data: { id: string; code: string; expiresAt: string };
    }>();
    expect(Date.parse(data.expiresAt)).toBe(now + 3600000);
    const authorization = await redeemInvitation(
      env.DB,
      data.code,
      "timed@example.com",
      now,
    );
    expect(authorization).not.toBeNull();
    const revoke = await timedApp.request(
      `http://service.test/api/v1/admin/invitations/${data.id}`,
      { method: "DELETE", headers: adminHeaders() },
      env,
    );
    expect(revoke.status).toBe(200);
    await expect(
      findSignupAuthorization(
        env.DB,
        authorization!.token,
        "timed@example.com",
        now,
      ),
    ).resolves.toBeNull();
    const second = await timedApp.request(
      "http://service.test/api/v1/admin/invitations",
      {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          email: "expired@example.com",
          expiresInSeconds: 3600,
        }),
      },
      env,
    );
    const expired = await second.json<{ data: { code: string } }>();
    now += 3600000;
    await expect(
      redeemInvitation(env.DB, expired.data.code, "expired@example.com", now),
    ).resolves.toBeNull();
  });
});

describe("registration gate", () => {
  it("requires an unexpired authorization for every user-creation path but not existing-user login", async () => {
    const code = "all-paths-invitation-code-00000000001";
    const email = "paths@example.com";
    await insertInvitation("invite-paths", code, email);
    const authorization = await redeemInvitation(
      env.DB,
      code,
      email,
      Date.now(),
    );
    if (!authorization) throw new Error("Expected invitation redemption");

    const methods: ValidateUserInfoMethod[] = [
      "oauth",
      "email-password",
      "magic-link",
      "email-otp",
      "anonymous",
      "phone-number",
      "admin",
      "future-plugin",
    ];
    for (const method of methods) {
      // Better Auth reports the same create-user action for every method. The gate
      // intentionally does not maintain a bypass-prone method allowlist.
      const source = {
        action: "create-user",
        method,
        ...(method === "oauth" ? { oauth: { providerId: "google" } } : {}),
      } satisfies ValidateUserInfoSource;
      await expect(
        authorizeRegistration(env, source, email, null),
        `missing cookie for ${method}`,
      ).resolves.toBeNull();
      await expect(
        authorizeRegistration(env, source, email, authorization.token),
        `valid cookie for ${method}`,
      ).resolves.toMatchObject({ invitationId: "invite-paths" });
    }

    await expect(
      authorizeRegistration(
        env,
        { action: "sign-in", method: "oauth", oauth: { providerId: "google" } },
        email,
        null,
      ),
    ).resolves.toBeUndefined();
    await expect(
      authorizeRegistration(
        env,
        {
          action: "link-account",
          method: "oauth",
          oauth: { providerId: "google" },
        },
        email,
        null,
      ),
    ).resolves.toBeUndefined();
  });

  it("invalidates all authorizations when the invitation is consumed", async () => {
    const code = "consume-invitation-code-0000000000001";
    const email = "consume@example.com";
    await insertInvitation("invite-consume", code, email);
    const first = await redeemInvitation(env.DB, code, email, Date.now());
    const second = await redeemInvitation(env.DB, code, email, Date.now());
    if (!first || !second) throw new Error("Expected invitation redemption");

    const record = await findSignupAuthorization(
      env.DB,
      first.token,
      email,
      Date.now(),
    );
    if (!record) throw new Error("Expected signup authorization");

    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
      .bind("invite-user", "Invite User", email, now, now)
      .run();
    await consumeSignupAuthorization(env.DB, record, "invite-user", now);

    await expect(
      env.DB.prepare(
        "SELECT authorized_at AS authorizedAt FROM authorized_users WHERE user_id = ?",
      )
        .bind("invite-user")
        .first<{ authorizedAt: number }>(),
    ).resolves.toEqual({ authorizedAt: now });

    await expect(
      findSignupAuthorization(env.DB, first.token, email, now + 1),
    ).resolves.toBeNull();
    await expect(
      findSignupAuthorization(env.DB, second.token, email, now + 1),
    ).resolves.toBeNull();
  });

  it("rejects expired or subsequently revoked signup authorizations", async () => {
    const now = Date.now();
    const expiredCode = "short-lived-invitation-code-000000001";
    const expiredEmail = "short-lived@example.com";
    await insertInvitation("invite-short-lived", expiredCode, expiredEmail, {
      expiresAt: now + 1_000,
    });
    const expiredAuthorization = await redeemInvitation(
      env.DB,
      expiredCode,
      expiredEmail,
      now,
    );
    if (!expiredAuthorization)
      throw new Error("Expected short-lived authorization");
    await expect(
      authorizeRegistration(
        env,
        {
          action: "create-user",
          method: "oauth",
          oauth: { providerId: "google" },
        },
        expiredEmail,
        expiredAuthorization.token,
        now + 1_001,
      ),
    ).resolves.toBeNull();

    const revokedCode = "subsequently-revoked-code-00000000001";
    const revokedEmail = "subsequently-revoked@example.com";
    await insertInvitation(
      "invite-subsequently-revoked",
      revokedCode,
      revokedEmail,
    );
    const revokedAuthorization = await redeemInvitation(
      env.DB,
      revokedCode,
      revokedEmail,
      now,
    );
    if (!revokedAuthorization)
      throw new Error("Expected revocable authorization");
    await env.DB.prepare("UPDATE invitations SET revoked_at = ? WHERE id = ?")
      .bind(now + 1, "invite-subsequently-revoked")
      .run();
    await expect(
      authorizeRegistration(
        env,
        {
          action: "create-user",
          method: "oauth",
          oauth: { providerId: "google" },
        },
        revokedEmail,
        revokedAuthorization.token,
        now + 2,
      ),
    ).resolves.toBeNull();
  });
});
