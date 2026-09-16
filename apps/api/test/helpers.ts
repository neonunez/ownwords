import { makeSignature } from "better-auth/crypto";

export const TRUSTED_ORIGIN = "http://localhost:8787";
export const TEST_SECRET = "test-only-secret-with-at-least-32-characters";

export async function insertUser(
  db: D1Database,
  id: string,
  email: string,
  now = Date.now(),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, id, email, now, now)
    .run();
}

export async function sessionCookie(
  db: D1Database,
  userId: string,
  token: string,
  expiresAt: number,
  now = Date.now(),
  authorized = true,
): Promise<string> {
  if (authorized) {
    await db
      .prepare(
        `INSERT INTO authorized_users (user_id, authorized_at)
         VALUES (?, ?)
         ON CONFLICT(user_id) DO NOTHING`,
      )
      .bind(userId, now)
      .run();
  }
  await db
    .prepare(
      `INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, userId)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(`session-${token}`, expiresAt, token, now, now, userId)
    .run();
  const signature = await makeSignature(token, TEST_SECRET);
  return `ownwords.session_token=${token}.${signature}`;
}

export function jsonRequest(
  method: string,
  body?: unknown,
  origin = TRUSTED_ORIGIN,
): RequestInit {
  return {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
