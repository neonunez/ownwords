import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import {
  appFor,
  createVerifiedEntry,
  jsonRequest,
  setup,
  verifiedEntryBody,
  type TestContext,
} from "./helpers.js";

const contexts: TestContext[] = [];
afterEach(() => {
  while (contexts.length) contexts.pop()!.rawDb.close();
});
async function context() {
  const ctx = await setup();
  contexts.push(ctx);
  return ctx;
}

function countedDb(db: D1Database, failAt = 0) {
  let operations = 0;
  const bindingSizes: number[] = [];
  const wrap = (raw: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(raw, {
      get(target, key) {
        if (key === "bind")
          return (...args: unknown[]) => {
            bindingSizes.push(args.length);
            if (args.length > 100)
              throw new Error("D1's 100 parameter limit exceeded");
            return wrap(target.bind(...args));
          };
        const value = Reflect.get(target, key);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          operations += 1;
          if (operations === failAt)
            return Promise.reject(new Error("synthetic read failure"));
          return value.apply(target, args);
        };
      },
    });
  const proxy = new Proxy(db, {
    get(target, key) {
      if (key === "prepare") return (sql: string) => wrap(target.prepare(sql));
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: proxy, count: () => operations, bindingSizes };
}

it("hydrates 30 multi-sense entry trees with four operations, preserving exact individual reads", async () => {
  const ctx = await context();
  const app = appFor(ctx, "user-a");
  const ids: string[] = [];
  for (let index = 0; index < 30; index += 1) {
    const response = await jsonRequest(
      app,
      "/api/v1/lexicon/entries",
      {
        method: "POST",
        json: verifiedEntryBody({
          note: `entry-${index}`,
          senses: [
            {
              gloss: "first",
              equivalents: [
                {
                  languageTag: "ru",
                  text: `слово-${index}`,
                  status: "confirmed",
                  fit: "exact",
                },
                {
                  languageTag: "en",
                  text: `word-${index}`,
                  status: "manual",
                  provenance: { index },
                },
              ],
            },
            {
              gloss: "second",
              equivalents: [
                {
                  languageTag: "es",
                  text: `palabra-${index}`,
                  status: "suggested",
                  fit: "context_only",
                },
                { languageTag: "de", status: "failed", text: null },
              ],
            },
          ],
        }),
      },
      ctx.db,
    );
    assert.equal(response.status, 201);
    ids.push(((await response.json()) as any).data.id);
    ctx.clock.advance(1);
  }
  ctx.rawDb.sqlite.exec(
    "UPDATE lexicon_practice_cards SET reps = 5, stability = 30 WHERE direction = 'recognize'",
  );
  const observed = countedDb(ctx.db);
  const response = await jsonRequest(
    app,
    "/api/v1/lexicon/entries?limit=30",
    {},
    observed.db,
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as any;
  assert.equal(observed.count(), 4);
  assert.deepEqual(
    body.data.map((entry: any) => entry.id),
    [...ids].reverse(),
  );
  assert.equal(body.page.nextCursor, null);
  for (const entry of body.data) {
    const individual = await jsonRequest(
      app,
      `/api/v1/lexicon/entries/${entry.id}`,
      {},
      ctx.db,
    );
    assert.deepEqual(entry, ((await individual.json()) as any).data);
  }
  const single = countedDb(ctx.db);
  await jsonRequest(app, "/api/v1/lexicon/entries?limit=1", {}, single.db);
  assert.equal(single.count(), 4);
});

it("chunks a full 100-entry page below D1's binding limit and keeps pagination/order", async () => {
  const ctx = await context();
  const app = appFor(ctx, "user-a");
  const ids: string[] = [];
  for (let index = 0; index < 101; index += 1) {
    ids.push((await createVerifiedEntry(ctx)).id);
    // Equal timestamps also exercise the id tiebreaker.
  }
  ids.sort().reverse();
  const observed = countedDb(ctx.db);
  const response = await jsonRequest(
    app,
    "/api/v1/lexicon/entries?limit=100",
    {},
    observed.db,
  );
  const body = (await response.json()) as any;
  assert.equal(response.status, 200);
  assert.equal(observed.count(), 7);
  assert.ok(Math.max(...observed.bindingSizes) <= 100);
  assert.deepEqual(
    body.data.map((entry: any) => entry.id),
    ids.slice(0, 100),
  );
  assert.ok(
    body.data.every((entry: any) => entry.senses[0].equivalents.length === 2),
  );
  const next = await jsonRequest(
    app,
    `/api/v1/lexicon/entries?limit=100&cursor=${encodeURIComponent(body.page.nextCursor)}`,
    {},
    ctx.db,
  );
  assert.deepEqual(
    ((await next.json()) as any).data.map((entry: any) => entry.id),
    ids.slice(100),
  );
});

it("isolates every descendant owner, ignores deleted descendants and preserves filtering", async () => {
  const ctx = await context();
  const alice = await createVerifiedEntry(ctx);
  const bob = await createVerifiedEntry(ctx, "user-b");
  // A damaged database must not turn bulk joins into an ownership bypass.
  ctx.rawDb.sqlite.exec("PRAGMA foreign_keys = OFF");
  ctx.rawDb.sqlite
    .prepare("UPDATE lexicon_senses SET entry_id = ? WHERE id = ?")
    .run(alice.id, bob.senses[0].id);
  ctx.rawDb.sqlite
    .prepare("UPDATE lexicon_equivalents SET sense_id = ? WHERE id = ?")
    .run(alice.senses[0].id, bob.senses[0].equivalents[0].id);
  const bobQ = bob.senses[0].equivalents[1].id;
  const aliceQ = alice.senses[0].equivalents[1].id;
  ctx.rawDb.sqlite
    .prepare(
      "UPDATE lexicon_practice_cards SET equivalent_id = ?, reps = 10, stability = 30 WHERE owner_id = 'user-b' AND equivalent_id = ?",
    )
    .run(aliceQ, bobQ);
  ctx.rawDb.sqlite.exec("PRAGMA foreign_keys = ON");
  const app = appFor(ctx, "user-a");
  const response = await jsonRequest(
    app,
    "/api/v1/lexicon/entries?language=ru&verification=verified&mastery=new",
    {},
    ctx.db,
  );
  const entries = ((await response.json()) as any).data;
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], alice);
  ctx.rawDb.sqlite
    .prepare("UPDATE lexicon_equivalents SET deleted_at = ? WHERE id = ?")
    .run(ctx.clock.now().toISOString(), aliceQ);
  const filtered = await jsonRequest(
    app,
    "/api/v1/lexicon/entries?language=ru",
    {},
    ctx.db,
  );
  assert.deepEqual(((await filtered.json()) as any).data, []);
  const list = await jsonRequest(app, "/api/v1/lexicon/entries", {}, ctx.db);
  assert.equal(
    ((await list.json()) as any).data[0].senses[0].equivalents.length,
    1,
  );
  ctx.rawDb.sqlite
    .prepare("UPDATE lexicon_senses SET deleted_at = ? WHERE id = ?")
    .run(ctx.clock.now().toISOString(), alice.senses[0].id);
  const noSenses = await jsonRequest(
    app,
    "/api/v1/lexicon/entries",
    {},
    ctx.db,
  );
  assert.deepEqual(((await noSenses.json()) as any).data[0].senses, []);
});

it("returns an empty page without hydration and fails a page honestly if a bulk read fails", async () => {
  const ctx = await context();
  const app = appFor(ctx, "user-a");
  const empty = countedDb(ctx.db);
  assert.equal(
    (await jsonRequest(app, "/api/v1/lexicon/entries", {}, empty.db)).status,
    200,
  );
  assert.equal(empty.count(), 1);
  await createVerifiedEntry(ctx);
  const failing = countedDb(ctx.db, 3);
  const response = await jsonRequest(
    app,
    "/api/v1/lexicon/entries",
    {},
    failing.db,
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: {
      code: "INTERNAL_ERROR",
      message: "The request could not be completed",
    },
  });
  assert.equal(
    (await jsonRequest(app, "/api/v1/lexicon/entries", {}, ctx.db)).status,
    200,
  );
});
