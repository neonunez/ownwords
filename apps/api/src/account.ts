import { exportLearnerData } from "@ownwords/learning";
import { exportLexiconOwnerData } from "@ownwords/lexicon";
import { Hono } from "hono";
import { errorResponse } from "./errors.js";
import { readProfile } from "./onboarding.js";
import type { AppEnv } from "./types.js";

export const ACCOUNT_EXPORT_FORMAT = "ownwords-account-export/1";

interface AccountRow {
  id: string;
  name: string;
  email: string;
  createdAt: number;
}

async function readAccount(db: D1Database, userId: string) {
  const [account, signIns, passkeys] = await Promise.all([
    db
      .prepare(`SELECT id, name, email, createdAt FROM "user" WHERE id = ?`)
      .bind(userId)
      .first<AccountRow>(),
    db
      .prepare(
        `SELECT providerId AS provider, createdAt FROM "account"
         WHERE userId = ? ORDER BY createdAt, id`,
      )
      .bind(userId)
      .all<{ provider: string; createdAt: number }>(),
    db
      .prepare(
        `SELECT name, deviceType, createdAt FROM "passkey"
         WHERE userId = ? ORDER BY createdAt, id`,
      )
      .bind(userId)
      .all<{
        name: string | null;
        deviceType: string;
        createdAt: number | null;
      }>(),
  ]);
  if (!account) return null;
  const date = (value: number | null) =>
    value === null ? null : new Date(value).toISOString();
  // Credentials, tokens, and passkey public keys are deliberately not exported.
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    createdAt: date(account.createdAt),
    signInMethods: signIns.results.map((row) => ({
      provider: row.provider,
      linkedAt: date(row.createdAt),
    })),
    passkeys: passkeys.results.map((row) => ({
      name: row.name,
      deviceType: row.deviceType,
      createdAt: date(row.createdAt),
    })),
  };
}

/**
 * Composes every package's ownership-aware export into one authenticated read.
 * Each package reads only its own tables; the verified session supplies the owner.
 */
export function createAccountRoutes(
  now: () => number = Date.now,
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/export", async (c) => {
    const userId = c.get("userId");
    const [account, profile, lexicon, learning] = await Promise.all([
      readAccount(c.env.DB, userId),
      readProfile(c.env.DB, userId),
      exportLexiconOwnerData(c.env.DB, userId),
      exportLearnerData(c.env.DB, userId),
    ]);
    if (!account) {
      return errorResponse(401, "unauthorized", "A valid session is required");
    }
    const exportedAt = new Date(now()).toISOString();
    c.header(
      "Content-Disposition",
      `attachment; filename="ownwords-export-${exportedAt.slice(0, 10)}.json"`,
    );
    return c.json({
      format: ACCOUNT_EXPORT_FORMAT,
      exportedAt,
      account,
      profile,
      lexicon,
      learning,
    });
  });

  return routes;
}
