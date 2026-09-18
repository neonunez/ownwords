import { timingSafeEqual } from "node:crypto";
import { bodyLimit } from "hono/body-limit";
import { setCookie } from "hono/cookie";
import { Hono } from "hono";
import { z } from "zod";
import { errorResponse } from "./errors.js";
import type { AppEnv, Bindings } from "./types.js";

const SIGNUP_AUTHORIZATION_TTL_MS = 15 * 60 * 1000;
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 10;

const redeemSchema = z
  .object({
    code: z.string().min(20).max(200),
    email: z.string().trim().min(3).max(254).email(),
  })
  .strict();

interface InvitationRow {
  id: string;
  email: string;
  expiresAt: number;
}

export interface SignupAuthorization {
  id: string;
  invitationId: string;
  email: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function signupCookieName(env: Bindings): string {
  return env.ENVIRONMENT === "production"
    ? "__Host-ownwords-signup"
    : "ownwords-signup";
}

async function registerAttempt(
  db: D1Database,
  address: string,
  now: number,
): Promise<boolean> {
  const addressHash = await sha256(`invite-attempt:${address}`);
  const windowStartedAt =
    Math.floor(now / ATTEMPT_WINDOW_MS) * ATTEMPT_WINDOW_MS;
  const row = await db
    .prepare(
      `INSERT INTO invitation_attempts (address_hash, window_started_at, attempt_count)
       VALUES (?, ?, 1)
       ON CONFLICT(address_hash, window_started_at)
       DO UPDATE SET attempt_count = attempt_count + 1
       RETURNING attempt_count AS attemptCount`,
    )
    .bind(addressHash, windowStartedAt)
    .first<{ attemptCount: number }>();
  return Boolean(row && row.attemptCount <= MAX_ATTEMPTS_PER_WINDOW);
}

export async function redeemInvitation(
  db: D1Database,
  code: string,
  email: string,
  now: number,
): Promise<{ token: string; expiresAt: number } | null> {
  const codeHash = await sha256(code);
  const normalizedEmail = normalizeEmail(email);
  const invitation = await db
    .prepare(
      `SELECT id, email, expires_at AS expiresAt
       FROM invitations
       WHERE code_hash = ?
         AND email = ?
         AND expires_at > ?
         AND revoked_at IS NULL
         AND accepted_at IS NULL`,
    )
    .bind(codeHash, normalizedEmail, now)
    .first<InvitationRow>();

  if (!invitation) return null;

  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = Math.min(
    invitation.expiresAt,
    now + SIGNUP_AUTHORIZATION_TTL_MS,
  );
  await db
    .prepare(
      `INSERT INTO signup_authorizations
        (id, invitation_id, email, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      invitation.id,
      normalizedEmail,
      tokenHash,
      expiresAt,
      now,
    )
    .run();

  return { token, expiresAt };
}

export async function findSignupAuthorization(
  db: D1Database,
  token: string | null,
  email: string,
  now: number,
): Promise<SignupAuthorization | null> {
  if (!token || token.length > 200) return null;
  const tokenHash = await sha256(token);
  return db
    .prepare(
      `SELECT sa.id, sa.invitation_id AS invitationId, sa.email
       FROM signup_authorizations sa
       INNER JOIN invitations i ON i.id = sa.invitation_id
       WHERE sa.token_hash = ?
         AND sa.email = ?
         AND sa.expires_at > ?
         AND sa.used_at IS NULL
         AND i.email = sa.email
         AND i.expires_at > ?
         AND i.revoked_at IS NULL
         AND i.accepted_at IS NULL`,
    )
    .bind(tokenHash, normalizeEmail(email), now, now)
    .first<SignupAuthorization>();
}

export async function isAuthorizedUser(
  db: D1Database,
  userId: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS authorized FROM authorized_users WHERE user_id = ?")
    .bind(userId)
    .first<{ authorized: number }>();
  return row?.authorized === 1;
}

export async function consumeSignupAuthorization(
  db: D1Database,
  authorization: SignupAuthorization,
  userId: string,
  now: number,
): Promise<void> {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE signup_authorizations
         SET used_at = ?, used_by_user_id = ?
         WHERE id = ? AND used_at IS NULL`,
      )
      .bind(now, userId, authorization.id),
    db
      .prepare(
        `UPDATE invitations
         SET accepted_at = ?, accepted_by_user_id = ?
         WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
      )
      .bind(now, userId, authorization.invitationId),
    db
      .prepare(
        `INSERT INTO authorized_users (user_id, authorized_at)
         VALUES (?, ?)`,
      )
      .bind(userId, now),
  ]);

  if (results.some((result) => !result.success || result.meta.changes !== 1)) {
    throw new Error("Invitation authorization could not be consumed");
  }
}

const issueSchema = z
  .object({ email: z.string().trim().min(3).max(254).email() })
  .strict();

export function createInvitationAdminRoutes(
  now: () => number = Date.now,
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use("*", async (c, next) => {
    const configured = c.env.INVITATION_ADMIN_TOKEN;
    const authorization = c.req.header("Authorization");
    const supplied = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    if (
      !configured ||
      !/^[a-f0-9]{64}$/.test(configured) ||
      !/^[a-f0-9]{64}$/.test(supplied) ||
      !timingSafeEqual(
        new TextEncoder().encode(configured),
        new TextEncoder().encode(supplied),
      )
    ) {
      return errorResponse(
        403,
        "admin_forbidden",
        "Invitation administration is not authorized",
      );
    }
    await next();
  });
  routes.use(
    "*",
    bodyLimit({
      maxSize: 4096,
      onError: () =>
        errorResponse(
          413,
          "request_too_large",
          "The request body is too large",
        ),
    }),
  );
  routes.post("/", async (c) => {
    const parsed = issueSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(400, "invalid_request", "A valid email is required");
    }
    const id = crypto.randomUUID();
    const code = randomToken();
    const createdAt = now();
    const expiresAt = createdAt + INVITATION_LIFETIME_MS;
    const email = normalizeEmail(parsed.data.email);
    await c.env.DB.prepare(
      `INSERT INTO invitations (id, code_hash, email, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, await sha256(code), email, expiresAt, createdAt)
      .run();
    return c.json(
      {
        data: { id, code, email, expiresAt: new Date(expiresAt).toISOString() },
      },
      201,
    );
  });
  routes.delete("/:id", async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("id"));
    if (!id.success)
      return errorResponse(
        400,
        "invalid_request",
        "A valid invitation ID is required",
      );
    const result = await c.env.DB.prepare(
      `UPDATE invitations SET revoked_at = COALESCE(revoked_at, ?)
       WHERE id = ? AND accepted_at IS NULL`,
    )
      .bind(now(), id.data)
      .run();
    if (result.meta.changes !== 1) {
      return errorResponse(
        404,
        "invitation_unavailable",
        "The invitation is missing or already accepted",
      );
    }
    return c.json({ data: { revoked: true } });
  });
  return routes;
}

export function createInvitationRoutes(
  now: () => number = Date.now,
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.post("/redeem", async (c) => {
    const address = c.req.header("CF-Connecting-IP") ?? "local-or-unknown";
    const timestamp = now();
    if (!(await registerAttempt(c.env.DB, address, timestamp))) {
      return errorResponse(429, "rate_limited", "Too many invitation attempts");
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(
        400,
        "invalid_request",
        "A JSON request body is required",
      );
    }
    const parsed = redeemSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        400,
        "invalid_request",
        "Invitation code and email are required",
      );
    }

    const authorization = await redeemInvitation(
      c.env.DB,
      parsed.data.code,
      parsed.data.email,
      timestamp,
    );
    if (!authorization) {
      return errorResponse(
        403,
        "invitation_invalid",
        "The invitation is invalid or unavailable",
      );
    }

    setCookie(c, signupCookieName(c.env), authorization.token, {
      httpOnly: true,
      secure: c.env.ENVIRONMENT === "production",
      sameSite: "Lax",
      path: "/",
      maxAge: Math.max(
        1,
        Math.floor((authorization.expiresAt - timestamp) / 1000),
      ),
    });
    return c.json(
      {
        data: {
          authorized: true,
          expiresAt: new Date(authorization.expiresAt).toISOString(),
        },
      },
      200,
    );
  });

  return routes;
}
