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
const HASH = "6fc73576449e888aa99d519790bf112fca98b35254da649db5a228a42fe6a08b";
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
    editorial: { teacherReviewed: true, note: "Reviewed by the owner." },
  };
  const preflight = planPublicationRequests({ ...shared, confirm: false });
  assert.deepEqual(
    preflight.map((request) => [request.method, request.mutates]),
    [
      ["GET", false],
      ["POST", false],
    ],
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
    preflight.some((request) => request.path.includes("versions?courseId=")),
    "the preflight reads what the database already holds",
  );

  const confirmed = planPublicationRequests({ ...shared, confirm: true });
  assert.equal(confirmed.length, preflight.length + 1);
  const write = confirmed.at(-1);
  assert.equal(write.mutates, true);
  assert.equal(write.body.dryRun, false);
  assert.deepEqual(write.body.expect, shared.expect);
  assert.deepEqual(write.body.editorial, shared.editorial);
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
      "--note",
      "Owner-confirmed teacher review; recorded audio arrives separately.",
      "--teacher-reviewed",
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
    "--note",
    "Owner-confirmed teacher review; recorded audio arrives separately.",
    "--teacher-reviewed",
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
      "--note",
      "Owner-confirmed teacher review; recorded audio arrives separately.",
      "--teacher-reviewed",
      pack,
    ],
    { CONTENT_PUBLISH_TOKEN: TOKEN },
  );
  assert.equal(result.code, 1);
  assert.match(result.stderr, /refused \(target_mismatch\)/);
  assert.equal(result.stdout, "");
});

test("the command refuses a missing token, and states the review status explicitly", async () => {
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
    "--note",
    "Owner-confirmed teacher review; recorded audio arrives separately.",
    "--teacher-reviewed",
    pack,
  ]);
  assert.equal(withoutToken.code, 1);
  assert.match(withoutToken.stderr, /refused \(missing_token\)/);

  const withoutStatement = await publisherResult(
    [
      "--config",
      configPath,
      "--expect-course",
      "russian-foundations",
      "--expect-version",
      "1",
      "--expect-hash",
      HASH,
      "--note",
      "Owner-confirmed teacher review; recorded audio arrives separately.",
      pack,
    ],
    { CONTENT_PUBLISH_TOKEN: TOKEN },
  );
  assert.equal(withoutStatement.code, 1);
  assert.match(withoutStatement.stderr, /refused \(usage\)/);
});
