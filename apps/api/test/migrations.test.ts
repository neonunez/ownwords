import { env } from "cloudflare:workers";
import { getMigrations } from "better-auth/db/migration";
import { describe, expect, it } from "vitest";
import { createAuth } from "../src/auth.js";

describe("composed D1 schema", () => {
  it("contains the core auth, invite, and onboarding tables", async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    expect(tables.results.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "account",
        "authorized_users",
        "invitation_attempts",
        "invitations",
        "language_profiles",
        "passkey",
        "rateLimit",
        "session",
        "signup_authorizations",
        "user",
        "user_profiles",
        "verification",
      ]),
    );
  });

  it("matches the schema required by the pinned Better Auth and passkey versions", async () => {
    const plan = await getMigrations(createAuth(env).options, {
      throwOnUnsafe: false,
    });
    expect(plan.toBeCreated).toEqual([]);
    expect(plan.toBeAdded).toEqual([]);
    expect(plan.toBeAddedIndexes).toEqual([]);
    expect(plan.unsafeChanges).toEqual([]);
    expect(plan.schemaProblems).toEqual([]);
  });
});
