import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createRequestAuth } from "../src/auth.js";
import { verifyBetterAuthSession } from "../src/session.js";
import { redeemInvitation, sha256 } from "../src/invitations.js";
import {
  insertUser,
  sessionCookie,
  TEST_SECRET,
  TRUSTED_ORIGIN,
} from "./helpers.js";

/** Counts binding operations, not SQL parameters or account payloads. */
function observedDb(db: D1Database, beforeBatch?: () => Promise<void>) {
  const calls: string[] = [];
  const originals = new WeakMap<object, D1PreparedStatement>();
  const sqlByStatement = new WeakMap<object, string>();
  let failRevision = false;
  let malformedSchema = false;
  const statement = (
    raw: D1PreparedStatement,
    sql: string,
  ): D1PreparedStatement => {
    const proxy = new Proxy(raw, {
      get(target, key) {
        if (key === "bind")
          return (...args: unknown[]) => statement(target.bind(...args), sql);
        const value = Reflect.get(target, key);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          calls.push(sql);
          if (
            failRevision &&
            sql.startsWith("SELECT type, name, tbl_name, sql")
          ) {
            return Promise.reject(new Error("synthetic D1 outage"));
          }
          if (
            malformedSchema &&
            sql.startsWith("SELECT type, name, tbl_name, sql")
          )
            return Promise.resolve({ success: true });
          return value.apply(target, args);
        };
      },
    });
    originals.set(proxy, raw);
    sqlByStatement.set(proxy, sql);
    return proxy;
  };
  const proxy = new Proxy(db, {
    get(target, key) {
      if (key === "prepare")
        return (sql: string) => statement(target.prepare(sql), sql);
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          calls.push(
            `batch:${statements.length}:${statements.map((item) => sqlByStatement.get(item) ?? "").join(";")}`,
          );
          await beforeBatch?.();
          return target.batch(
            statements.map((item) => originals.get(item) ?? item),
          );
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    db: proxy,
    calls,
    failRevision: (value: boolean) => {
      failRevision = value;
    },
    malformedSchema: (value: boolean) => {
      malformedSchema = value;
    },
  };
}

const schemaCalls = (calls: string[]) =>
  calls.filter(
    (sql) =>
      !sql.startsWith("SELECT type, name, tbl_name, sql") &&
      /sqlite_master|table_info/.test(sql),
  );

describe("request-owned authentication schema validation", () => {
  it("fully checks a cold binding, then uses a runtime DDL guard on warm unsigned probes", async () => {
    const observed = observedDb(env.DB);
    const bindings = { ...env, DB: observed.db };
    const app = createApp();
    const probe = () =>
      app.request(`${TRUSTED_ORIGIN}/api/auth/get-session`, {}, bindings);
    expect((await probe()).status).toBe(200);
    expect(schemaCalls(observed.calls).length).toBeGreaterThanOrEqual(2);
    expect(
      observed.calls.filter((sql) =>
        sql.startsWith("SELECT type, name, tbl_name, sql"),
      ),
    ).toHaveLength(2);
    observed.calls.length = 0;
    expect(await (await probe()).json()).toBeNull();
    expect(schemaCalls(observed.calls)).toEqual([]);
    expect(
      observed.calls.filter((sql) =>
        sql.startsWith("SELECT type, name, tbl_name, sql"),
      ),
    ).toHaveLength(1);
    // The public auth handler still enforces its database-backed rate limit.
    expect(
      observed.calls.filter((sql) => sql.includes('"rateLimit"')),
    ).toHaveLength(2);
    expect(observed.calls).toHaveLength(3);
  });

  it("never keeps failed schema I/O and refuses it even after a clean verdict", async () => {
    const observed = observedDb(env.DB);
    const bindings = { ...env, DB: observed.db };
    await createRequestAuth(bindings);
    observed.failRevision(true);
    await expect(createRequestAuth(bindings)).rejects.toThrow(
      "synthetic D1 outage",
    );
    observed.failRevision(false);
    await expect(createRequestAuth(bindings)).resolves.toBeDefined();
  });

  it("refuses malformed schema metadata cold and warm instead of treating an absent verdict as a match", async () => {
    const observed = observedDb(env.DB);
    const bindings = { ...env, DB: observed.db };
    observed.malformedSchema(true);
    await expect(createRequestAuth(bindings)).rejects.toThrow(
      "schema could not be checked",
    );
    observed.malformedSchema(false);
    await createRequestAuth(bindings);
    observed.malformedSchema(true);
    expect(
      (
        await createApp().request(
          `${TRUSTED_ORIGIN}/api/auth/get-session`,
          {},
          bindings,
        )
      ).status,
    ).toBe(500);
    observed.malformedSchema(false);
    await expect(createRequestAuth(bindings)).resolves.toBeDefined();
  });

  it("detects missing auth schema after DDL on a warmed binding, and can recover after repair", async () => {
    const observed = observedDb(env.DB);
    const bindings = { ...env, DB: observed.db };
    await createRequestAuth(bindings);
    await env.DB.prepare(
      'ALTER TABLE "passkey" RENAME TO "passkey_repair"',
    ).run();
    const app = createApp();
    expect(
      (
        await app.request(
          `${TRUSTED_ORIGIN}/api/auth/get-session`,
          {},
          bindings,
        )
      ).status,
    ).toBe(500);
    await expect(createRequestAuth(bindings)).rejects.toThrow();
    await env.DB.prepare(
      'ALTER TABLE "passkey_repair" RENAME TO "passkey"',
    ).run();
    await expect(createRequestAuth(bindings)).resolves.toBeDefined();
  });

  it("does not publish a verdict when DDL races a cold check, and retries on the next request", async () => {
    let raced = false;
    const observed = observedDb(env.DB, async () => {
      if (!raced) {
        raced = true;
        await env.DB.prepare(
          "CREATE TABLE auth_schema_race_test (id TEXT PRIMARY KEY)",
        ).run();
      }
    });
    const bindings = { ...env, DB: observed.db };
    await expect(createRequestAuth(bindings)).rejects.toThrow(
      "changed during validation",
    );
    observed.calls.length = 0;
    await expect(createRequestAuth(bindings)).resolves.toBeDefined();
    expect(schemaCalls(observed.calls).length).toBeGreaterThanOrEqual(2);
  });

  it("does not reuse auth instances, D1 I/O or clean verdicts across distinct bindings", async () => {
    const first = observedDb(env.DB);
    const second = observedDb(env.DB);
    const [a, b] = await Promise.all([
      createRequestAuth({ ...env, DB: first.db }),
      createRequestAuth({ ...env, DB: second.db }),
    ]);
    expect(a).not.toBe(b);
    expect(schemaCalls(first.calls).length).toBeGreaterThanOrEqual(2);
    expect(schemaCalls(second.calls).length).toBeGreaterThanOrEqual(2);
    const warm = await createRequestAuth({ ...env, DB: first.db });
    expect(warm).not.toBe(a);
    expect(warm.options.database).toBe(first.db);
    expect(b.options.database).toBe(second.db);
  });

  it("still rereads sessions and invitation grants on warm requests, and rejects secret rotation", async () => {
    await insertUser(env.DB, "auth-perf-a", "auth-perf-a@example.com");
    await insertUser(env.DB, "auth-perf-b", "auth-perf-b@example.com");
    const cookieA = await sessionCookie(
      env.DB,
      "auth-perf-a",
      "auth-perf-a-token",
      Date.now() + 30 * 86_400_000,
    );
    const cookieB = await sessionCookie(
      env.DB,
      "auth-perf-b",
      "auth-perf-b-token",
      Date.now() + 30 * 86_400_000,
    );
    const observed = observedDb(env.DB);
    const bindings = { ...env, DB: observed.db };
    const app = createApp();
    const profile = (cookie: string, extra = {}) =>
      app.request(
        `${TRUSTED_ORIGIN}/api/v1/profile`,
        { headers: { Cookie: cookie } },
        { ...bindings, ...extra },
      );
    expect((await profile(cookieA)).status).toBe(200);
    observed.calls.length = 0;
    expect((await profile(cookieB)).status).toBe(200);
    // DDL guard + session + user + invitation + absent profile: five operations.
    expect(observed.calls).toHaveLength(5);
    expect(schemaCalls(observed.calls)).toEqual([]);
    const futureApp = createApp({ now: () => Date.now() + 31 * 86_400_000 });
    expect(
      (
        await futureApp.request(
          `${TRUSTED_ORIGIN}/api/v1/profile`,
          { headers: { Cookie: cookieB } },
          bindings,
        )
      ).status,
    ).toBe(401);
    expect(
      (await profile(cookieA, { BETTER_AUTH_SECRET: `${TEST_SECRET}-rotated` }))
        .status,
    ).toBe(401);
    expect((await profile(cookieA, { BETTER_AUTH_SECRET: "bad" })).status).toBe(
      500,
    );
    await env.DB.prepare("DELETE FROM authorized_users WHERE user_id = ?")
      .bind("auth-perf-a")
      .run();
    expect((await profile(cookieA)).status).toBe(401);
    await env.DB.prepare('DELETE FROM "session" WHERE token = ?')
      .bind("auth-perf-b-token")
      .run();
    expect((await profile(cookieB)).status).toBe(401);
  });

  it("bounds cold and warm 30-entry connected list work independently of page size", async () => {
    const id = "auth-perf-list";
    await insertUser(env.DB, id, "auth-perf-list@example.com");
    const cookie = await sessionCookie(
      env.DB,
      id,
      "auth-perf-list-token",
      Date.now() + 60_000,
    );
    const app = createApp();
    for (let index = 0; index < 30; index += 1) {
      const response = await app.request(
        `${TRUSTED_ORIGIN}/api/v1/lexicon/entries`,
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            Origin: TRUSTED_ORIGIN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            kind: "word",
            senses: [
              {
                equivalents: [
                  {
                    languageTag: "en",
                    text: `performance-${index}`,
                    status: "manual",
                  },
                ],
              },
            ],
          }),
        },
        env,
      );
      expect(response.status).toBe(201);
    }
    const observed = observedDb(env.DB);
    const list = async (limit: number) => {
      observed.calls.length = 0;
      const response = await app.request(
        `${TRUSTED_ORIGIN}/api/v1/lexicon/entries?limit=${limit}`,
        { headers: { Cookie: cookie } },
        { ...env, DB: observed.db },
      );
      expect(response.status).toBe(200);
      const data = await response.json<{ data: unknown[] }>();
      expect(data.data).toHaveLength(limit);
      return observed.calls.length;
    };
    const cold = await list(30);
    expect(schemaCalls(observed.calls).length).toBeGreaterThanOrEqual(2);
    const warm = await list(30);
    expect(schemaCalls(observed.calls)).toEqual([]);
    expect(warm).toBeLessThanOrEqual(8);
    expect(cold).toBeLessThanOrEqual(11);
    expect(await list(1)).toBe(warm);
  });

  it("keeps injected registration clocks and current relying-party configuration request-local", async () => {
    const observed = observedDb(env.DB);
    const bindings = { ...env, DB: observed.db };
    const firstClock = () => 100;
    const secondClock = () => 200;
    const first = await createRequestAuth(bindings, firstClock);
    const second = await createRequestAuth(
      {
        ...bindings,
        PASSKEY_RP_ID: "127.0.0.1",
        PASSKEY_RP_ORIGIN: "http://127.0.0.1:8787",
        TRUSTED_ORIGINS: `${TRUSTED_ORIGIN},http://127.0.0.1:8787`,
      },
      secondClock,
    );
    expect(first.options.plugins?.[0]?.options?.rpID).toBe("localhost");
    expect(second.options.plugins?.[0]?.options?.rpID).toBe("127.0.0.1");
    const code = "auth-clock-invitation-code-0000000001";
    const email = "auth-clock@example.com";
    await env.DB.prepare(
      "INSERT INTO invitations (id, code_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind("auth-clock-invite", await sha256(code), email, 150, 0)
      .run();
    const authorization = await redeemInvitation(env.DB, code, email, 100);
    expect(authorization).not.toBeNull();
    const input = {
      user: { email },
      source: {
        action: "create-user" as const,
        method: "oauth",
        oauth: { providerId: "google" },
      },
    };
    const context = { getCookie: () => authorization!.token };
    await expect(
      first.options.user?.validateUserInfo?.(input, context as never),
    ).resolves.toBeUndefined();
    await expect(
      second.options.user?.validateUserInfo?.(input, context as never),
    ).resolves.toMatchObject({ error: "invitation_required" });
    await expect(
      verifyBetterAuthSession(new Headers(), bindings, secondClock),
    ).resolves.toBeNull();
  });
});
