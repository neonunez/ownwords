// The production hosting configuration, checked as configuration: the one
// origin the app and the API share, the routing that keeps the app shell's
// fallback away from `/api`, and the absence of anything that would publish a
// hostname, upload the demo build or carry a credential into Git. Nothing here
// deploys or reaches Cloudflare; the routes themselves are proved in
// `production-hosting-routes.test.mjs`.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  PRODUCTION_HOST,
  PRODUCTION_ORIGIN,
  apiDirectory,
  parseJsonc,
  readProductionTemplate,
  repositoryRoot,
} from "./production-hosting.mjs";

const run = promisify(execFile);

const template = await readProductionTemplate();

test("the production template serves the app and the API from the approved origin", async () => {
  const local = parseJsonc(
    await readFile(path.join(apiDirectory, "wrangler.jsonc"), "utf8"),
  );
  assert.equal(template.name, "ownwords-api");
  assert.equal(template.main, "src/index.ts");
  // The local configuration is the same Worker under `wrangler dev`; a
  // production deploy must not quietly change its runtime semantics.
  assert.deepEqual(
    {
      compatibility_date: template.compatibility_date,
      compatibility_flags: template.compatibility_flags,
    },
    {
      compatibility_date: local.compatibility_date,
      compatibility_flags: local.compatibility_flags,
    },
  );
  assert.deepEqual(template.vars, {
    ENVIRONMENT: "production",
    BETTER_AUTH_URL: PRODUCTION_ORIGIN,
    TRUSTED_ORIGINS: PRODUCTION_ORIGIN,
    PASSKEY_RP_ID: PRODUCTION_HOST,
    PASSKEY_RP_ORIGIN: PRODUCTION_ORIGIN,
  });
  assert.equal(template.d1_databases.length, 1);
  assert.equal(template.d1_databases[0].binding, "DB");
  assert.equal(template.d1_databases[0].database_name, "ownwords-production");
});

test("the app's build is the deployed asset, and the demo build never is", () => {
  assert.equal(template.assets.directory, "../web/dist");
  assert.ok(
    !String(template.assets.directory).includes("demo-dist"),
    "the demo build must never be deployed",
  );
  assert.equal(template.assets.not_found_handling, "single-page-application");
});

test("the API runs before the asset fallback, so the shell never answers for it", () => {
  const first = template.assets.run_worker_first;
  assert.ok(Array.isArray(first), "run_worker_first must be an explicit list");
  assert.ok(first.includes("/api"), "the bare /api path is an API request");
  assert.ok(first.includes("/api/*"), "every /api/ route is an API request");
  // Nothing may hand an API path back to the shell's fallback.
  assert.ok(!first.some((pattern) => pattern.startsWith("!")));
  // The health check answers JSON too, so it belongs to the Worker as well.
  assert.ok(first.includes("/health"));
});

test("deploying this template publishes no hostname of its own", () => {
  assert.equal(template.workers_dev, false);
  assert.equal(template.routes, undefined);
  assert.equal(template.triggers, undefined);
  assert.equal(
    JSON.stringify(template).includes("workers.dev"),
    false,
    "no workers.dev host may appear in the template",
  );
});

test("no credential and no real database is tracked", () => {
  const tracked = JSON.stringify(template);
  for (const secret of [
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "INVITATION_ADMIN_TOKEN",
  ]) {
    assert.ok(!tracked.includes(secret), `${secret} must not be tracked`);
  }
  assert.equal(template.secrets, undefined);
  assert.equal(template.vars.BETTER_AUTH_SECRET, undefined);
  assert.equal(
    template.d1_databases[0].database_id,
    "replace-with-the-production-d1-id",
    "the D1 ID is environment-specific and stays a placeholder",
  );
  assert.doesNotMatch(
    template.d1_databases[0].database_id,
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
  );
});

test("the copied production config and the built app stay untracked", async () => {
  const paths = [
    "apps/api/wrangler.production.jsonc",
    "apps/web/dist/index.html",
  ];
  const { stdout } = await run(
    "git",
    ["check-ignore", "--no-index", ...paths],
    { cwd: repositoryRoot },
  );
  assert.deepEqual(stdout.trim().split("\n"), paths);
});

test("the JSONC reader handles the dialect the template is written in", () => {
  assert.deepEqual(
    parseJsonc(`{
      // a line comment
      "host": "https://ownwords.neonunez.com", /* a block comment */
      "note": "not // a comment",
      "list": [1, 2,],
    }`),
    {
      host: PRODUCTION_ORIGIN,
      note: "not // a comment",
      list: [1, 2],
    },
  );
});
