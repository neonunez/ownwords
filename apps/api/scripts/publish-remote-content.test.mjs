// The remote publisher's refusals and its request plan, proved without a
// network, a credential, a Cloudflare account or a remote database. The
// publisher must refuse every configuration that is not the deployed
// production API on the real production database, refuse a pack that is not
// the reviewed artifact, and never plan a write that the operator has not
// confirmed.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  assertExpectation,
  planPublicationRequests,
  PRODUCTION_DATABASE_NAME,
  PublicationRefusal,
  readPublicationTarget,
  readPublishToken,
  verifyDeployedDatabaseBinding,
} from "./remote-publication.mjs";
import {
  apiDirectory,
  PRODUCTION_ORIGIN,
  repositoryRoot,
} from "./production-hosting.mjs";

const run = promisify(execFile);
const publisher = path.join(
  apiDirectory,
  "scripts",
  "publish-remote-content.ts",
);
const tsx = path.join(repositoryRoot, "node_modules", ".bin", "tsx");
const pack = path.join(
  repositoryRoot,
  "packages",
  "learning",
  "content",
  "russian-foundations-v1.json",
);
/** The reviewed pack's content hash; `npm run content:validate` prints it. */
const HASH = "684033be47b582f4d4fc87b95c0dd7c62f9a1015a45523af52cdb817c59ad708";
const TOKEN = "cd".repeat(32);

const template = JSON.parse(
  (
    await readFile(
      path.join(apiDirectory, "wrangler.production.jsonc.example"),
      "utf8",
    )
  ).replace(/^\s*\/\/.*$/gm, ""),
);

/** A config that is production in every respect the publisher checks. */
function productionConfig(overrides = {}) {
  const config = structuredClone(template);
  config.d1_databases[0].database_id = "1f2e3d4c-5b6a-7988-9a0b-1c2d3e4f5061";
  return { ...config, ...overrides };
}

async function writeConfig(config) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ownwords-publish-"));
  const configPath = path.join(directory, "wrangler.production.jsonc");
  await writeFile(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

async function publisherResult(args, env = {}) {
  const environment = { ...process.env, ...env };
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete environment[key];
  }
  try {
    const { stdout, stderr } = await run(tsx, [publisher, ...args], {
      cwd: repositoryRoot,
      env: environment,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout,
      stderr: error.stderr,
    };
  }
}

test("the only acceptable target is the deployed production API and database", async () => {
  const target = readPublicationTarget(await writeConfig(productionConfig()));
  assert.equal(target.origin, PRODUCTION_ORIGIN);
  assert.equal(target.workerName, "ownwords-api");
  assert.equal(target.databaseName, PRODUCTION_DATABASE_NAME);
  assert.equal(target.databaseId, "1f2e3d4c-5b6a-7988-9a0b-1c2d3e4f5061");
});

test("local, template, placeholder and non-production targets are refused", () => {
  const cases = [
    [
      "local_config",
      path.join(apiDirectory, "wrangler.jsonc"),
      productionConfig(),
    ],
    [
      "template_config",
      "wrangler.production.jsonc.example",
      productionConfig(),
    ],
    [
      "not_production",
      "wrangler.production.jsonc",
      productionConfig({ vars: { ...template.vars, ENVIRONMENT: "local" } }),
    ],
    [
      "wrong_worker",
      "wrangler.production.jsonc",
      productionConfig({ name: "ownwords" }),
    ],
    [
      "wrong_origin",
      "wrangler.production.jsonc",
      productionConfig({
        vars: {
          ...template.vars,
          BETTER_AUTH_URL: "http://ownwords.neonunez.com",
          TRUSTED_ORIGINS: "http://ownwords.neonunez.com",
        },
      }),
    ],
    [
      "wrong_origin",
      "wrangler.production.jsonc",
      productionConfig({
        vars: {
          ...template.vars,
          BETTER_AUTH_URL: "https://ownwords.example.com",
          TRUSTED_ORIGINS: "https://ownwords.example.com",
        },
      }),
    ],
    [
      "wrong_binding",
      "wrangler.production.jsonc",
      productionConfig({
        d1_databases: [
          { ...template.d1_databases[0], database_name: "ownwords-local" },
        ],
      }),
    ],
    [
      "placeholder_database",
      "wrangler.production.jsonc",
      structuredClone(template), // the tracked placeholder ID, unchanged
    ],
    [
      "placeholder_database",
      "wrangler.production.jsonc",
      productionConfig({
        d1_databases: [
          {
            ...template.d1_databases[0],
            database_id: "00000000-0000-0000-0000-000000000000",
          },
        ],
      }),
    ],
    [
      "unreadable_config",
      path.join(
        os.tmpdir(),
        "ownwords-publish-absent",
        "wrangler.production.jsonc",
      ),
      undefined, // no such file
    ],
  ];
  return Promise.all(
    cases.map(async ([reason, name, config], index) => {
      const configPath =
        name.endsWith("wrangler.production.jsonc") && config !== undefined
          ? await writeConfig(config)
          : name;
      assert.throws(
        () => readPublicationTarget(configPath),
        (error) => {
          assert.ok(error instanceof PublicationRefusal);
          assert.equal(error.reason, reason, `case ${index}: ${name}`);
          return true;
        },
      );
    }),
  );
});

test("the reviewed hash the publisher is given is this pack's own hash", async () => {
  const { stdout } = await run(
    tsx,
    [
      "-e",
      `import { readFile } from "node:fs/promises";
       import { contentHash, validateContentPack } from "@ownwords/learning/content";
       void (async () => {
         const pack = validateContentPack(
           JSON.parse(await readFile(${JSON.stringify(pack)}, "utf8")),
         );
         process.stdout.write(await contentHash(pack));
       })();`,
    ],
    { cwd: repositoryRoot },
  );
  assert.equal(stdout.trim(), HASH);
});

test("a pack that is not the reviewed artifact is refused", () => {
  const reviewed = {
    courseId: "russian-foundations",
    version: 1,
    contentHash: HASH,
  };
  assert.doesNotThrow(() => assertExpectation(reviewed, { ...reviewed }));
  for (const observed of [
    { ...reviewed, contentHash: "f".repeat(64) },
    { ...reviewed, version: 2 },
    { ...reviewed, courseId: "russian-foundations-v2" },
  ]) {
    assert.throws(
      () => assertExpectation(observed, reviewed),
      (error) =>
        error instanceof PublicationRefusal &&
        error.reason === "target_mismatch",
    );
  }
});

test("the publication token must be the operator's 64-hex secret", () => {
  assert.equal(readPublishToken({ CONTENT_PUBLISH_TOKEN: TOKEN }), TOKEN);
  for (const value of [
    undefined,
    "",
    "not-hex",
    "ab".repeat(31),
    "AB".repeat(32),
  ]) {
    assert.throws(
      () => readPublishToken({ CONTENT_PUBLISH_TOKEN: value }),
      (error) =>
        error instanceof PublicationRefusal && error.reason === "missing_token",
    );
  }
});

test("a preflight plans only reads, and only a confirmed run plans the write", () => {
  const target = {
    origin: PRODUCTION_ORIGIN,
    workerName: "ownwords-api",
    databaseName: PRODUCTION_DATABASE_NAME,
    databaseId: "1f2e3d4c-5b6a-7988-9a0b-1c2d3e4f5061",
  };
  const shared = {
    target,
    token: TOKEN,
    pack: { course: { id: "russian-foundations" } },
    expect: {
      courseId: "russian-foundations",
      version: 1,
      contentHash: HASH,
    },
  };
  const preflight = planPublicationRequests({ ...shared, confirm: false });
  assert.deepEqual(
    preflight.map((request) => [request.method, request.mutates]),
    [["POST", false]],
  );
  assert.ok(
    preflight.every((request) => request.body?.dryRun !== false),
    "a preflight request must never ask for the write",
  );
  assert.ok(
    preflight.every((request) => request.headers.Origin === PRODUCTION_ORIGIN),
  );
  assert.ok(
    preflight.every((request) => request.url.startsWith(PRODUCTION_ORIGIN)),
  );
  assert.ok(
    preflight.every(
      (request) => request.path === "/api/v1/admin/content/publish",
    ),
    "the dry run is the only request: it also reports the versions already held",
  );

  const confirmed = planPublicationRequests({ ...shared, confirm: true });
  assert.equal(confirmed.length, preflight.length + 1);
  const write = confirmed.at(-1);
  assert.equal(write.mutates, true);
  assert.equal(write.body.dryRun, false);
  assert.deepEqual(write.body.expect, shared.expect);
  assert.deepEqual(
    Object.keys(write.body).sort(),
    ["dryRun", "expect", "pack"],
    "the publication request carries nothing but the pack, its expectation and the write flag",
  );
  assert.ok(
    confirmed.slice(0, -1).every((request) => request.body?.dryRun !== false),
    "the confirmed run still preflights before it writes",
  );
});

test("the command refuses a local config without sending anything", async () => {
  const result = await publisherResult(
    [
      "--config",
      "apps/api/wrangler.jsonc",
      "--expect-course",
      "russian-foundations",
      "--expect-version",
      "1",
      "--expect-hash",
      HASH,
      pack,
    ],
    { CONTENT_PUBLISH_TOKEN: TOKEN },
  );
  assert.equal(result.code, 1);
  assert.match(result.stderr, /refused \(local_config\)/);
  assert.equal(result.stdout, "");
});

test("the command refuses the tracked template and its placeholder D1 ID", async () => {
  const result = await publisherResult([
    "--config",
    "apps/api/wrangler.production.jsonc.example",
    "--expect-course",
    "russian-foundations",
    "--expect-version",
    "1",
    "--expect-hash",
    HASH,
    pack,
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /refused \(template_config\)/);
  assert.equal(result.stdout, "");
});

test("the command refuses a pack whose content is not the reviewed hash", async () => {
  const result = await publisherResult(
    [
      "--config",
      await writeConfig(productionConfig()),
      "--expect-course",
      "russian-foundations",
      "--expect-version",
      "1",
      "--expect-hash",
      "f".repeat(64),
      pack,
    ],
    { CONTENT_PUBLISH_TOKEN: TOKEN },
  );
  assert.equal(result.code, 1);
  assert.match(result.stderr, /refused \(target_mismatch\)/);
  assert.equal(result.stdout, "");
});

test("the command refuses a missing token", async () => {
  const configPath = await writeConfig(productionConfig());
  const withoutToken = await publisherResult([
    "--config",
    configPath,
    "--expect-course",
    "russian-foundations",
    "--expect-version",
    "1",
    "--expect-hash",
    HASH,
    pack,
  ]);
  assert.equal(withoutToken.code, 1);
  assert.match(withoutToken.stderr, /refused \(missing_token\)/);
  assert.equal(withoutToken.stdout, "");
});

const DEPLOYED_ID = "1f2e3d4c-5b6a-7988-9a0b-1c2d3e4f5061";
const OTHER_ID = "9a8b7c6d-5e4f-3021-a1b2-c3d4e5f60718";

/**
 * A stand-in for read-only Wrangler, answering in the JSON shapes Wrangler 4
 * prints: deployments oldest first with `{ version_id, percentage }` traffic,
 * raw API versions with `resources.bindings`, and the D1 API record.
 */
function wranglerStub({
  versionBindings,
  database,
  live = [{ version_id: "v-live", percentage: 100 }],
  fail,
}) {
  const calls = [];
  const exec = async (args) => {
    calls.push(args.join(" "));
    if (fail) throw new Error("not authenticated");
    if (args[0] === "deployments")
      return JSON.stringify([
        {
          created_on: "2026-01-01T00:00:00Z",
          versions: [{ version_id: "v-old", percentage: 100 }],
        },
        { created_on: "2026-02-01T00:00:00Z", versions: live },
      ]);
    if (args[0] === "versions") {
      const bindings =
        args[2] === "v-old"
          ? [{ name: "DB", type: "d1", id: OTHER_ID }]
          : typeof versionBindings === "function"
            ? versionBindings(args[2])
            : versionBindings;
      return JSON.stringify({ id: args[2], resources: { bindings } });
    }
    if (args[0] === "d1") return JSON.stringify(database);
    throw new Error(`unexpected wrangler call: ${args.join(" ")}`);
  };
  return { exec, calls };
}

test("the deployed Worker's own D1 binding is proved before any request exists", async () => {
  const target = {
    configPath: "/tmp/ownwords-production/wrangler.production.jsonc",
    origin: PRODUCTION_ORIGIN,
    workerName: "ownwords-api",
    databaseName: PRODUCTION_DATABASE_NAME,
    databaseId: DEPLOYED_ID,
  };
  const binding = { name: "DB", type: "d1", id: DEPLOYED_ID };
  const production = { uuid: DEPLOYED_ID, name: PRODUCTION_DATABASE_NAME };
  const gradual = [
    { version_id: "v-a", percentage: 90 },
    { version_id: "v-b", percentage: 10 },
  ];

  const verified = wranglerStub({
    versionBindings: [binding],
    database: production,
    live: gradual,
  });
  assert.deepEqual(
    await verifyDeployedDatabaseBinding({ target, exec: verified.exec }),
    { versionIds: ["v-a", "v-b"], databaseId: DEPLOYED_ID },
  );
  assert.deepEqual(
    verified.calls.map((call) => call.split(" ").slice(0, 3).join(" ")),
    [
      "deployments list --name",
      "versions view v-a",
      "versions view v-b",
      "d1 info " + PRODUCTION_DATABASE_NAME,
    ],
    "only the live deployment's versions are read, never the oldest",
  );
  assert.ok(
    verified.calls.every(
      (call) => call.includes("--config") && call.includes("--json"),
    ),
    "every lookup is read-only, config-scoped JSON",
  );

  // A Worker deployed from another config would otherwise publish anyway.
  for (const [versionBindings, database, reason, live] of [
    [
      [{ name: "DB", type: "d1", id: OTHER_ID }],
      { uuid: OTHER_ID, name: PRODUCTION_DATABASE_NAME },
      "deployed_binding_mismatch",
    ],
    [
      [{ name: "DB", type: "d1", id: OTHER_ID }],
      production,
      "deployed_binding_mismatch",
    ],
    [
      (versionId) =>
        versionId === "v-b"
          ? [{ name: "DB", type: "d1", id: OTHER_ID }]
          : [binding],
      production,
      "deployed_binding_mismatch",
      gradual,
    ],
    [
      [{ name: "OTHER", type: "d1", id: DEPLOYED_ID }],
      production,
      "unverified_binding",
    ],
    [[binding], production, "unverified_binding", []],
    [
      [binding],
      { uuid: DEPLOYED_ID, name: "ownwords-scratch" },
      "deployed_binding_mismatch",
    ],
  ]) {
    const stub = wranglerStub({ versionBindings, database, live });
    await assert.rejects(
      () => verifyDeployedDatabaseBinding({ target, exec: stub.exec }),
      (error) => {
        assert.ok(error instanceof PublicationRefusal);
        assert.equal(error.reason, reason);
        return true;
      },
    );
  }

  // An unreachable or unauthenticated Cloudflare fails closed, never open.
  const failing = wranglerStub({
    versionBindings: [binding],
    database: production,
    fail: true,
  });
  await assert.rejects(
    () => verifyDeployedDatabaseBinding({ target, exec: failing.exec }),
    (error) =>
      error instanceof PublicationRefusal &&
      error.reason === "unverified_binding",
  );
});
