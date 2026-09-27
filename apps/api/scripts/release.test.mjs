// The automatic release path, proved without Cloudflare, without a credential
// and without a deployment: the config it generates, the route it must keep, the
// migrations it may apply by itself, the course versions it may publish, and
// the publisher guards that still refuse everything else.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";
import {
  apiDirectory,
  PRODUCTION_HOST,
  PRODUCTION_ORIGIN,
  readProductionTemplate,
  repositoryRoot,
} from "./production-hosting.mjs";
import {
  assertReleaseTemplate,
  buildReleaseConfig,
  prepareReleaseConfig,
  readReleaseEnvironment,
  ReleaseRefusal,
  serialiseReleaseConfig,
} from "./release-config.mjs";
import {
  classifyMigration,
  classifyStatement,
  CONTENT_RELEASES_PATH,
  DATABASE_AUTHORIZATIONS_PATH,
  pendingMigrations,
  planMigrations,
  probeProduction,
  readContentReleases,
  readDatabaseAuthorizations,
  splitStatements,
} from "./release-plan.mjs";
import {
  planPublicationRequests,
  PublicationRefusal,
  readPublicationTarget,
  readPublishToken,
} from "./remote-publication.mjs";
import { composeMigrations } from "./compose-migrations.mjs";

const DATABASE_ID = "1e2e3d4c-5b6a-4788-9a0b-1c2d3e4f5061";
const ACCOUNT_ID = "adfc42cacc4688c714851c98876fba88";
const TOKEN = "cd".repeat(32);
const template = await readProductionTemplate();
const environment = {
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN: "a-token-a-release-never-prints",
  OWNWORDS_D1_DATABASE_ID: DATABASE_ID,
};

const run = promisify(execFile);
const read = (file) => readFile(path.join(repositoryRoot, file), "utf8");

async function writeConfig(config, name = "wrangler.production.jsonc") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ownwords-release-"));
  const configPath = path.join(directory, name);
  await writeFile(configPath, serialiseReleaseConfig(config));
  return configPath;
}

// The generated configuration.

test("a release config is the tracked template plus the real database and the live domain", () => {
  const config = buildReleaseConfig({ template, databaseId: DATABASE_ID });
  assert.equal(config.name, "ownwords-api");
  assert.equal(config.workers_dev, false);
  assert.equal(config.main, "src/index.ts");
  assert.equal(config.assets.directory, "../web/dist");
  assert.deepEqual(config.assets.run_worker_first, [
    "/api",
    "/api/*",
    "/health",
  ]);
  assert.equal(config.d1_databases.length, 1);
  assert.equal(config.d1_databases[0].binding, "DB");
  assert.equal(config.d1_databases[0].database_name, "ownwords-production");
  assert.equal(config.d1_databases[0].database_id, DATABASE_ID);
  assert.equal(
    config.d1_databases[0].migrations_dir,
    "../../.wrangler/migrations",
  );
  assert.deepEqual(config.vars, {
    ENVIRONMENT: "production",
    BETTER_AUTH_URL: PRODUCTION_ORIGIN,
    TRUSTED_ORIGINS: PRODUCTION_ORIGIN,
    PASSKEY_RP_ID: PRODUCTION_HOST,
    PASSKEY_RP_ORIGIN: PRODUCTION_ORIGIN,
  });
});

test("a release keeps the Custom Domain and never publishes workers.dev", () => {
  const config = buildReleaseConfig({ template, databaseId: DATABASE_ID });
  assert.deepEqual(config.routes, [
    { pattern: PRODUCTION_HOST, custom_domain: true },
  ]);
  assert.equal(config.workers_dev, false);
  assert.equal(JSON.stringify(config).includes("workers.dev"), false);
  // The tracked template stays the identity; the route is a release value, so a
  // deploy from the repository alone can never detach or widen the hostname.
  assert.equal(template.routes, undefined);
  assert.throws(() => assertReleaseTemplate({ ...template, routes: [] }), {
    name: "ReleaseRefusal",
  });
});

test("a missing or wrong release value stops the release before anything is generated", () => {
  for (const key of Object.keys(environment)) {
    assert.throws(
      () => readReleaseEnvironment({ ...environment, [key]: "" }),
      { name: "ReleaseRefusal", reason: "missing_configuration" },
      `${key} must be required`,
    );
  }
  assert.throws(
    () =>
      readReleaseEnvironment({
        ...environment,
        OWNWORDS_D1_DATABASE_ID: "00000000-0000-0000-0000-000000000000",
      }),
    { reason: "placeholder_database" },
  );
  assert.deepEqual(
    { ...readReleaseEnvironment(environment), apiToken: undefined },
    { accountId: ACCOUNT_ID, databaseId: DATABASE_ID, apiToken: undefined },
  );
});

test("a generated config carries no credential and is never committed", async () => {
  const text = serialiseReleaseConfig(
    buildReleaseConfig({ template, databaseId: DATABASE_ID }),
  );
  for (const secret of [
    "CLOUDFLARE_API_TOKEN",
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_SECRET",
    "INVITATION_ADMIN_TOKEN",
    "CONTENT_PUBLISH_TOKEN",
    environment.CLOUDFLARE_API_TOKEN,
  ]) {
    assert.ok(!text.includes(secret), `${secret} must not be in the config`);
  }
  const { stdout } = await run(
    "git",
    ["check-ignore", "--no-index", "apps/api/wrangler.production.jsonc"],
    { cwd: repositoryRoot },
  );
  assert.match(stdout.trim(), /wrangler\.production\.jsonc/);
});

test("the generated config is proved by the publisher's own production guards", async () => {
  const prepared = await prepareReleaseConfig({
    env: environment,
    write: (file, text) => writeFile(file, text),
    configPath: path.join(
      await mkdtemp(path.join(os.tmpdir(), "ownwords-release-")),
      "wrangler.production.jsonc",
    ),
  });
  assert.equal(prepared.host, PRODUCTION_HOST);
  assert.equal(prepared.target.origin, PRODUCTION_ORIGIN);
  assert.equal(prepared.target.workerName, "ownwords-api");
  assert.equal(prepared.target.databaseId, DATABASE_ID);
  // The same file, read back from disk, is the publication target.
  const onDisk = await readFile(prepared.configPath, "utf8");
  assert.deepEqual(
    JSON.parse(onDisk),
    JSON.parse(serialiseReleaseConfig(prepared.config)),
  );
  assert.equal(
    readPublicationTarget(prepared.configPath).databaseId,
    DATABASE_ID,
  );
});

// The template must stay trustworthy.

test("the tracked template is checked, not assumed", () => {
  for (const mutate of [
    (t) => ({ ...t, workers_dev: true }),
    (t) => ({ ...t, triggers: [{ crons: ["0 0 * * *"] }] }),
    (t) => ({ ...t, vars: { ...t.vars, ENVIRONMENT: "staging" } }),
    (t) => ({
      ...t,
      vars: { ...t.vars, BETTER_AUTH_URL: "https://example.com" },
    }),
    (t) => ({ ...t, secrets: { store: "vault" } }),
    (t) => ({ ...t, d1_databases: [] }),
    (t) => ({
      ...t,
      d1_databases: [{ ...t.d1_databases[0], database_id: DATABASE_ID }],
    }),
    (t) => ({
      ...t,
      vars: { ...t.vars, CONTENT_PUBLISH_TOKEN: "0".repeat(64) },
    }),
  ]) {
    assert.throws(() => assertReleaseTemplate(mutate(template)), {
      name: "ReleaseRefusal",
    });
  }
});

// Migrations.

test("the repository's own migrations are additive, in composed order", async () => {
  const composed = await composeMigrations(repositoryRoot);
  assert.deepEqual(composed, [
    "0001_core.sql",
    "0100_lexicon.sql",
    "0200_learning.sql",
  ]);
  for (const name of composed) {
    const sql = await read(`.wrangler/migrations/${name}`);
    const classified = classifyMigration({ name, sql });
    assert.deepEqual(
      classified.reasons,
      [],
      `${name} must apply without a human step: ${classified.reasons.join("; ")}`,
    );
  }
});

test("a trigger body is not mistaken for a data change", () => {
  const statements = splitStatements(`
    CREATE TABLE t (id TEXT PRIMARY KEY);
    CREATE TRIGGER t_immutable BEFORE UPDATE ON t
    BEGIN
      SELECT RAISE(ABORT, 'immutable');
    END;
    CREATE INDEX t_idx ON t (id);
  `);
  assert.equal(statements.length, 3);
  assert.ok(statements[1].startsWith("CREATE TRIGGER"));
  assert.ok(statements[1].includes("SELECT RAISE(ABORT"));
  for (const statement of statements) {
    assert.equal(classifyStatement(statement).safe, true);
  }
});

test("an identifier ending in begin cannot merge the statements after it", () => {
  const classified = classifyMigration({
    name: "0300_begin.sql",
    sql: "CREATE TABLE a (x_begin INTEGER, begin_at TEXT);\nDROP TABLE users;\nDELETE FROM sessions;",
  });
  assert.equal(classified.statements, 3);
  assert.equal(classified.safe, false);
  assert.equal(classified.reasons.length, 2);
});

test("only a trigger that refuses writes applies on its own", () => {
  assert.equal(
    classifyStatement(
      "CREATE TRIGGER t BEFORE UPDATE ON a WHEN OLD.x_begin <> NEW.x_begin BEGIN SELECT RAISE(ABORT, 'it''s immutable'); SELECT RAISE(FAIL, 'no'); END",
    ).safe,
    true,
  );
  for (const sql of [
    "CREATE TRIGGER t AFTER INSERT ON a BEGIN DELETE FROM users; END;",
    "CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT RAISE(ABORT, 'x'); UPDATE users SET email = ''; END;",
    "CREATE TRIGGER t AFTER INSERT ON a BEGIN INSERT INTO log VALUES (1); END;",
    "CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT 1; END;",
    "CREATE TRIGGER t BEFORE INSERT ON progress BEGIN SELECT RAISE(IGNORE); END;",
    "CREATE TRIGGER t BEFORE INSERT ON progress BEGIN SELECT RAISE(ABORT, 'x'); SELECT RAISE(IGNORE); END;",
    "CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT RAISE(ABORT, 'x'); END; DROP TABLE users;",
    "CREATE TRIGGER t AFTER INSERT ON a BEGIN BEGIN SELECT RAISE(ABORT, 'x'); END; DROP TABLE users; END;",
  ]) {
    assert.equal(
      classifyMigration({ name: "0300_trigger.sql", sql }).safe,
      false,
      `${sql} must not apply automatically`,
    );
  }
});

test("a comment or a literal cannot smuggle a destructive statement past the gate", () => {
  const sql = `
    -- DROP TABLE "user";
    /* DELETE FROM session; */
    CREATE TABLE note (body TEXT DEFAULT 'delete from nothing');
  `;
  const classified = classifyMigration({ name: "0300_note.sql", sql });
  assert.equal(classified.safe, true);
  assert.equal(classified.statements, 1);
});

test("anything that could destroy or reinterpret data is not additive", () => {
  const cases = [
    'DROP TABLE "user";',
    "DELETE FROM session;",
    'UPDATE "user" SET email = lower(email);',
    'ALTER TABLE "user" RENAME TO users;',
    'ALTER TABLE "user" DROP COLUMN "email";',
    'ALTER TABLE "user" ADD COLUMN nickname TEXT NOT NULL;',
    'ALTER TABLE invitation ADD COLUMN sponsor TEXT REFERENCES "user"(id);',
    "VACUUM;",
    "SELECT 1;",
  ];
  for (const statement of cases) {
    assert.equal(
      classifyStatement(statement).safe,
      false,
      `${statement} must not apply automatically`,
    );
  }
  // A nullable or defaulted column is the ordinary backward-compatible addition.
  assert.equal(
    classifyStatement("ALTER TABLE t ADD COLUMN a TEXT;").safe,
    true,
  );
  assert.equal(
    classifyStatement("ALTER TABLE t ADD COLUMN a INTEGER DEFAULT 0;").safe,
    true,
  );
  // A NOT NULL column with a default is still backward compatible: every write
  // the deployed code makes is accepted.
  assert.equal(
    classifyStatement('ALTER TABLE t ADD COLUMN a TEXT NOT NULL DEFAULT "x";')
      .safe,
    true,
  );
});

test("only the migrations the database has not recorded are pending", () => {
  const composed = ["0001_core.sql", "0100_lexicon.sql", "0200_learning.sql"];
  assert.deepEqual(pendingMigrations({ composed, applied: [] }), composed);
  assert.deepEqual(pendingMigrations({ composed, applied: composed }), []);
  assert.deepEqual(
    pendingMigrations({ composed, applied: ["0001_core.sql"] }),
    ["0100_lexicon.sql", "0200_learning.sql"],
  );
  assert.throws(
    () =>
      pendingMigrations({
        composed,
        applied: ["0001_core.sql", "0300_gone.sql"],
      }),
    { name: "ReleaseRefusal", reason: "unknown_applied_migration" },
  );
});

test("a destructive migration stops the release unless the record names its exact hash", async () => {
  const record = await read(DATABASE_AUTHORIZATIONS_PATH);
  const source = JSON.parse(record);
  const sql = "DELETE FROM learning_user_course_progress;";
  const classified = classifyMigration({ name: "0300_purge.sql", sql });
  assert.equal(classified.safe, false);

  const blocked = planMigrations({
    pending: ["0300_purge.sql"],
    sqlByName: { "0300_purge.sql": sql },
    authorizations: readDatabaseAuthorizations(record),
  });
  assert.equal(blocked.blocked.length, 1);
  assert.match(blocked.blocked[0].reasons[0], /rewrites or removes data/);

  const authorized = planMigrations({
    pending: ["0300_purge.sql"],
    sqlByName: { "0300_purge.sql": sql },
    authorizations: readDatabaseAuthorizations(
      JSON.stringify({
        migrations: [
          {
            file: "0300_purge.sql",
            sha256: classified.sha256,
            authorizedBy: "captain",
            note: "test",
          },
        ],
      }),
    ),
  });
  assert.deepEqual(authorized.blocked, []);
  assert.equal(authorized.planned[0].authorizedBy, "captain");

  // Editing an authorized migration withdraws the authorization.
  const edited = planMigrations({
    pending: ["0300_purge.sql"],
    sqlByName: { "0300_purge.sql": `${sql}\nDELETE FROM session;` },
    authorizations: readDatabaseAuthorizations(
      JSON.stringify({
        migrations: [
          {
            file: "0300_purge.sql",
            sha256: classified.sha256,
            authorizedBy: "captain",
            note: "test",
          },
        ],
      }),
    ),
  });
  assert.equal(edited.blocked.length, 1);
});

test("the database record accepts only a complete, exact authorization", async () => {
  assert.deepEqual(
    readDatabaseAuthorizations(await read(DATABASE_AUTHORIZATIONS_PATH)),
    [],
  );
  for (const entry of [
    {
      file: "*.sql",
      sha256: "a".repeat(64),
      authorizedBy: "captain",
      note: "x",
    },
    { file: "0300_a.sql", sha256: "nope", authorizedBy: "captain", note: "x" },
    { file: "0300_a.sql", sha256: "a".repeat(64), authorizedBy: "", note: "x" },
    { file: "0300_a.sql", sha256: "a".repeat(64), authorizedBy: "captain" },
    {
      file: "0300_a.sql",
      sha256: "a".repeat(64),
      authorizedBy: "captain",
      note: "x",
      extra: 1,
    },
  ]) {
    assert.throws(
      () => readDatabaseAuthorizations(JSON.stringify({ migrations: [entry] })),
      { name: "ReleaseRefusal", reason: "invalid_record" },
    );
  }
});

// Course versions.

test("the course release record names the exact published version, not a pattern", async () => {
  const releases = readContentReleases(await read(CONTENT_RELEASES_PATH));
  assert.deepEqual(releases, [
    {
      courseId: "russian-foundations",
      version: 1,
      contentHash:
        "684033be47b582f4d4fc87b95c0dd7c62f9a1015a45523af52cdb817c59ad708",
      pack: "packages/learning/content/russian-foundations-v1.json",
    },
  ]);
  // The pack the record names is the reviewed one, and it is inside the content
  // directory, so no release can point at an arbitrary file.
  const pack = await readFile(
    path.join(repositoryRoot, releases[0].pack),
    "utf8",
  );
  assert.equal(JSON.parse(pack).course.id, releases[0].courseId);
  assert.equal(JSON.parse(pack).version, releases[0].version);
  for (const entry of [
    { course: "*", version: 1, hash: "a".repeat(64), pack: "p.json" },
    {
      course: "russian-foundations",
      version: 0,
      hash: "a".repeat(64),
      pack: "p.json",
    },
    { course: "russian-foundations", version: 1, hash: "A1", pack: "p.json" },
    {
      course: "russian-foundations",
      version: 1,
      hash: "a".repeat(64),
      pack: "content/*.json",
    },
    {
      course: "russian-foundations",
      version: 1,
      hash: "a".repeat(64),
      pack: "../../etc/passwd",
    },
    { course: "russian-foundations", version: 1, hash: "a".repeat(64) },
  ]) {
    assert.throws(
      () => readContentReleases(JSON.stringify({ releases: [entry] })),
      {
        name: "ReleaseRefusal",
        reason: "invalid_record",
      },
    );
  }
  assert.throws(
    () =>
      readContentReleases(
        JSON.stringify({
          releases: [
            { course: "a", version: 1, hash: "a".repeat(64), pack: "a.json" },
            { course: "a", version: 1, hash: "b".repeat(64), pack: "b.json" },
          ],
        }),
      ),
    { name: "ReleaseRefusal" },
  );
});

// The publisher's refusals still stand for a release.

test("the guarded publisher refuses a release without the real token, and previews first", async () => {
  const configPath = await writeConfig(
    buildReleaseConfig({ template, databaseId: DATABASE_ID }),
  );
  const target = readPublicationTarget(configPath);
  assert.equal(target.origin, PRODUCTION_ORIGIN);
  assert.throws(() => readPublishToken({}), { name: "PublicationRefusal" });
  assert.throws(() => readPublishToken({ CONTENT_PUBLISH_TOKEN: "short" }), {
    name: "PublicationRefusal",
  });

  const expect = {
    courseId: "russian-foundations",
    version: 1,
    contentHash: "a".repeat(64),
  };
  const preview = planPublicationRequests({
    target,
    token: TOKEN,
    pack: { course: { id: "russian-foundations" } },
    expect,
    confirm: false,
  });
  assert.deepEqual(
    preview.map((request) => [
      request.step.includes("preflight"),
      request.body.dryRun,
    ]),
    [[true, true]],
  );
  const confirmed = planPublicationRequests({
    target,
    token: TOKEN,
    pack: {},
    expect,
    confirm: true,
  });
  assert.equal(confirmed.length, 2);
  assert.equal(confirmed[0].body.dryRun, true, "the preflight always runs");
  assert.equal(confirmed[1].body.dryRun, false);

  // A local or template config is still refused for a release.
  assert.throws(
    () => readPublicationTarget(path.join(apiDirectory, "wrangler.jsonc")),
    { name: "PublicationRefusal", reason: "local_config" },
  );
  assert.throws(
    () =>
      readPublicationTarget(
        path.join(apiDirectory, "wrangler.production.jsonc.example"),
      ),
    { name: "PublicationRefusal", reason: "template_config" },
  );
});

// The read-back.

test("the read-back accepts the deployment's own answers and fails on anything else", async () => {
  const answers = {
    "/health": [200, "application/json"],
    "/": [200, "text/html; charset=utf-8"],
    "/manifest.webmanifest": [200, "application/manifest+json"],
    "/api/nope": [404, "application/json"],
  };
  const results = await probeProduction({
    origin: PRODUCTION_ORIGIN,
    attempts: 1,
    fetchImpl: async (url) => {
      const [status, type] = answers[new URL(url).pathname];
      return { status, headers: new Headers({ "content-type": type }) };
    },
  });
  assert.deepEqual(
    results.map((result) => result.status),
    [200, 200, 200, 404],
  );

  // The app shell answering for the API is exactly the regression to catch.
  for (const broken of [
    { path: "/api/nope", status: 200, type: "text/html" },
    { path: "/health", status: 200, type: "text/html" },
    { path: "/", status: 502, type: "text/plain" },
  ]) {
    await assert.rejects(
      probeProduction({
        origin: PRODUCTION_ORIGIN,
        attempts: 1,
        fetchImpl: async () => ({
          status: broken.status,
          headers: new Headers({ "content-type": broken.type }),
        }),
      }),
      { name: "ReleaseRefusal", reason: "read_back_failed" },
    );
  }

  // A version that has not propagated yet is retried, not failed.
  const attemptsByPath = new Map();
  const resultsAfterRetry = await probeProduction({
    origin: PRODUCTION_ORIGIN,
    attempts: 3,
    wait: async () => {},
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      const seen = (attemptsByPath.get(pathname) ?? 0) + 1;
      attemptsByPath.set(pathname, seen);
      if (pathname === "/health" && seen < 3) {
        throw new Error("connection reset");
      }
      const [status, type] = answers[pathname];
      return { status, headers: new Headers({ "content-type": type }) };
    },
  });
  assert.equal(resultsAfterRetry.length, 4);
  assert.deepEqual(
    resultsAfterRetry.map((result) => result.status),
    [200, 200, 200, 404],
  );
});

// The workflow itself, parsed as GitHub reads it: what it needs, when it needs
// it, and which step a credential is allowed to reach.

const workflow = parseYaml(
  await readFile(
    path.join(repositoryRoot, ".github", "workflows", "release.yml"),
    "utf8",
  ),
);
const steps = workflow.jobs.release.steps;

/** One named step. */
function step(name) {
  const found = steps.find((candidate) => candidate.name === name);
  assert.ok(found, `the release workflow must have a "${name}" step`);
  return found;
}

/** Each step's position, by name or by its run command. */
function position(label) {
  const index = steps.findIndex(
    (candidate) => candidate.name === label || candidate.run === label,
  );
  assert.notEqual(index, -1, `the release workflow must have "${label}"`);
  return index;
}

const PRESENCE = "The release configuration is present";
const PUBLISH = "Publish the authorized course versions";

test("the release runs on a merge to main, after the checks and the app build", () => {
  assert.deepEqual(workflow.on, { push: { branches: ["main"] } });
  // One release at a time, and a new push waits rather than cancelling one.
  assert.deepEqual(workflow.concurrency, {
    group: "release-production",
    "cancel-in-progress": false,
  });
  // The workflow may not deploy with anything but the repository's own checks
  // and build: the release steps come after both.
  const check = position("npm run check");
  const build = position("npm run build");
  const stages = [
    "Generate and prove the production config",
    "Apply the additive migrations",
    "Deploy the Worker and the app",
    PUBLISH,
  ].map(position);
  assert.ok(check < build, "the checks run before the build");
  assert.ok(
    stages[0] > build,
    "no release stage runs before the checks and build",
  );
  assert.deepEqual(
    stages,
    [...stages].sort((a, b) => a - b),
    "stages run in order",
  );
});

test("every value the release needs is checked before anything is mutated", async () => {
  const presence = step(PRESENCE);
  assert.ok(position(PRESENCE) < position("npm ci"), "checked before install");
  const values = {
    CLOUDFLARE_API_TOKEN: "api-token-value",
    CLOUDFLARE_ACCOUNT_ID: "account-id-value",
    OWNWORDS_D1_DATABASE_ID: "database-id-value",
    CONTENT_PUBLISH_TOKEN: "publish-token-value",
  };
  const shell = (env) =>
    run("bash", ["-e", "-c", presence.run], {
      env: { PATH: process.env.PATH, ...env },
    }).then(
      (result) => ({ code: 0, output: result.stdout + result.stderr }),
      (error) => ({ code: error.code, output: error.stdout + error.stderr }),
    );
  assert.equal((await shell(values)).code, 0);
  for (const name of Object.keys(values)) {
    const { [name]: _absent, ...rest } = values;
    const result = await shell(rest);
    assert.equal(result.code, 1, `${name} must be required`);
    assert.match(
      result.output,
      new RegExp(`missing release configuration:.*${name}`),
    );
    for (const value of Object.values(rest)) {
      assert.equal(result.output.includes(value), false, "no value is printed");
    }
  }
});

/**
 * Every secret the document reads, wherever it reads it. A secret may appear
 * only as the whole value of a step's env entry, and only one of the two tokens
 * the release deploys and publishes with; anything else is returned as a
 * violation, with the path to it.
 */
function secretUse(document) {
  const reads = [];
  const violations = [];
  const walk = (value, at) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, [...at, index]));
    } else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) walk(item, [...at, key]);
    } else if (typeof value === "string" && /\bsecrets\b/.test(value)) {
      const whole = /^\$\{\{ secrets\.(\w+) \}\}$/.exec(value);
      const inStepEnv =
        at.length === 6 &&
        at[0] === "jobs" &&
        at[2] === "steps" &&
        at[4] === "env";
      if (
        whole &&
        inStepEnv &&
        ["CLOUDFLARE_API_TOKEN", "CONTENT_PUBLISH_TOKEN"].includes(whole[1])
      ) {
        reads.push({ secret: whole[1], step: at[3] });
      } else {
        violations.push(at.join("."));
      }
    }
  };
  walk(document, []);
  return { reads, violations };
}

test("the publication token reaches only the check and the publication", () => {
  const carrying = secretUse(workflow)
    .reads.filter((read) => read.secret === "CONTENT_PUBLISH_TOKEN")
    .map((read) => steps[read.step].name);
  assert.deepEqual(carrying, [PRESENCE, PUBLISH]);
});

test("a credential is read only as a step's env value, and only the two tokens", () => {
  assert.deepEqual(secretUse(workflow).violations, []);
  const secretsRead = new Set(
    secretUse(workflow).reads.map((read) => read.secret),
  );
  assert.deepEqual([...secretsRead].sort(), [
    "CLOUDFLARE_API_TOKEN",
    "CONTENT_PUBLISH_TOKEN",
  ]);

  // The check itself refuses every other way a secret could reach a step.
  const altered = (change) => {
    const copy = structuredClone(workflow);
    change(copy, copy.jobs.release.steps);
    return secretUse(copy).violations;
  };
  const placeholder = "${{ secrets.PLACEHOLDER_NAME }}";
  for (const [label, change] of [
    [
      "a secret in with:",
      (_, s) => (s[0].with = { token: "${{ secrets.GITHUB_TOKEN }}" }),
    ],
    [
      "surrounding text",
      (_, s) => (s.at(-1).env.FOO = "x-${{ secrets.OTHER }}"),
    ],
    ["another secret in env", (_, s) => (s.at(-1).env.FOO = placeholder)],
    ["a secret in run", (_, s) => (s.at(-1).run += ` ${placeholder}`)],
    [
      "a secret in if",
      (_, s) => (s.at(-1).if = "secrets.CLOUDFLARE_API_TOKEN != ''"),
    ],
    [
      "a secret in job env",
      (w) => (w.jobs.release.env.T = "${{ secrets.CLOUDFLARE_API_TOKEN }}"),
    ],
    [
      "a secret in workflow env",
      (w) => (w.env = { T: "${{ secrets.CONTENT_PUBLISH_TOKEN }}" }),
    ],
    ["index syntax", (_, s) => (s.at(-1).env.FOO = "${{ secrets['OTHER'] }}")],
    [
      "the whole secrets context",
      (_, s) => (s.at(-1).env.FOO = "${{ toJSON(secrets) }}"),
    ],
  ]) {
    assert.notDeepEqual(altered(change), [], `${label} must be refused`);
  }
  // A token under another env name still counts as reaching that step.
  const renamed = structuredClone(workflow);
  renamed.jobs.release.steps[position("npm ci")].env = {
    TOKEN: "${{ secrets.CONTENT_PUBLISH_TOKEN }}",
  };
  assert.equal(
    secretUse(renamed).reads.filter(
      (read) => read.secret === "CONTENT_PUBLISH_TOKEN",
    ).length,
    3,
  );
});

// The release can only ever name one Worker and one hostname. These are
// correctness guards, not a credential boundary: the token itself reaches the
// whole account (docs/RELEASES.md), so what the code refuses to touch is proved
// here rather than asserted.

test("the release names one Worker, one binding and one hostname, and only those", () => {
  const config = buildReleaseConfig({ template, databaseId: DATABASE_ID });
  assert.equal(config.name, "ownwords-api");
  assert.deepEqual(config.routes, [
    { pattern: PRODUCTION_HOST, custom_domain: true },
  ]);
  assert.equal(config.d1_databases.length, 1);
  assert.equal(config.d1_databases[0].database_name, "ownwords-production");
  assert.equal(config.d1_databases[0].binding, "DB");

  // Every hostname the configuration can publish is the approved one. A
  // hostname reaches a request through the Custom Domain route or an identity
  // var, so those are the two places that can name one.
  const hosts = new Set();
  const collect = (value) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/\b([a-z0-9*.-]+\.[a-z]{2,})\b/gi)) {
        hosts.add(match[1].toLowerCase());
      }
    } else if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(collect);
    }
  };
  collect({ routes: config.routes, vars: config.vars });
  assert.deepEqual([...hosts].sort(), [PRODUCTION_HOST]);
  // The only paths the config names are this repository's own.
  assert.equal(config.main, "src/index.ts");
  assert.equal(config.assets.directory, "../web/dist");
  assert.equal(
    config.d1_databases[0].migrations_dir,
    "../../.wrangler/migrations",
  );
});

test("a template that would touch another Worker, route or database is refused", () => {
  for (const mutate of [
    // Another Worker, or a name that is not the approved one at all.
    (t) => ({ ...t, name: "someone-elses-worker" }),
    (t) => ({ ...t, name: `${t.name}-preview` }),
    // A second D1 binding, so a migration could name another database.
    (t) => ({
      ...t,
      d1_databases: [
        ...t.d1_databases,
        { ...t.d1_databases[0], binding: "OTHER" },
      ],
    }),
    // A second database by name.
    (t) => ({
      ...t,
      d1_databases: [
        { ...t.d1_databases[0], database_name: "someone-elses-db" },
      ],
    }),
    // A second hostname, a wildcard, or a `workers.dev` fallback.
    (t) => ({
      ...t,
      routes: [{ pattern: "*.neonunez.com", custom_domain: true }],
    }),
    (t) => ({ ...t, subdomain: true }),
    // A scheduled trigger, which is another Cloudflare resource to mutate.
    (t) => ({ ...t, triggers: { crons: ["0 0 * * *"] } }),
  ]) {
    assert.throws(() => assertReleaseTemplate(mutate(template)), {
      name: "ReleaseRefusal",
    });
  }
});

test("the guards run again on the file the release actually deploys from", async () => {
  // A config that was generated correctly and then edited, or replaced, is
  // re-read from disk by the release's own target reader before any write. A
  // different real D1 ID is not refused here — only Cloudflare can say which
  // database an ID names, which is what the live binding proof asks.
  const config = buildReleaseConfig({ template, databaseId: DATABASE_ID });
  const generated = await writeConfig(config);
  assert.equal(readPublicationTarget(generated).workerName, "ownwords-api");

  for (const [mutate, reason] of [
    [(c) => ({ ...c, name: "someone-elses-worker" }), "wrong_worker"],
    [
      (c) => ({
        ...c,
        d1_databases: [
          { ...c.d1_databases[0], database_name: "someone-elses-db" },
        ],
      }),
      "wrong_binding",
    ],
    [
      (c) => ({
        ...c,
        vars: { ...c.vars, BETTER_AUTH_URL: "https://example.com" },
      }),
      "wrong_origin",
    ],
    [
      (c) => ({ ...c, vars: { ...c.vars, ENVIRONMENT: "staging" } }),
      "not_production",
    ],
  ]) {
    const mutated = await writeConfig(mutate(config));
    assert.throws(() => readPublicationTarget(mutated), {
      name: "PublicationRefusal",
      reason,
    });
  }
});
