// Rehearses the documented backup procedure end to end on local state only:
// real `wrangler dev` + local D1, `wrangler d1 export`, restore into a separate
// database, then verify both users' data and isolation over HTTP.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { makeSignature } from "better-auth/crypto";

const run = promisify(execFile);
const apiDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = path.resolve(apiDirectory, "..", "..");
const binaries = path.join(repositoryRoot, "node_modules", ".bin");
const ORIGIN = "http://localhost:8787";
const SECRET = "local-rehearsal-secret-with-at-least-32-chars";
const PACK = path.join(
  repositoryRoot,
  "packages/learning/test/fixtures/synthetic-russian.json",
);

let workspace;

async function makeDatabaseDirectory(name) {
  const directory = path.join(workspace, name);
  const config = {
    name: "ownwords-api",
    main: path.join(apiDirectory, "src/index.ts"),
    compatibility_date: "2026-09-15",
    compatibility_flags: ["nodejs_compat"],
    vars: {
      ENVIRONMENT: "local",
      BETTER_AUTH_URL: ORIGIN,
      TRUSTED_ORIGINS: ORIGIN,
      PASSKEY_RP_ID: "localhost",
      PASSKEY_RP_ORIGIN: ORIGIN,
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: "ownwords-local",
        database_id: "00000000-0000-0000-0000-000000000000",
        migrations_dir: path.join(repositoryRoot, ".wrangler/migrations"),
      },
    ],
  };
  await mkdir(directory, { recursive: true });
  const configPath = path.join(directory, "wrangler.json");
  await writeFile(configPath, JSON.stringify(config));
  return { directory, configPath };
}

async function wrangler(args) {
  const { stdout } = await run(path.join(binaries, "wrangler"), args, {
    cwd: workspace,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function startWorker(database) {
  const port = await freePort();
  const child = spawn(
    path.join(binaries, "wrangler"),
    [
      "dev",
      "--config",
      database.configPath,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--var",
      `BETTER_AUTH_SECRET:${SECRET}`,
      "--show-interactive-dev-session=false",
      "--log-level",
      "warn",
    ],
    {
      cwd: database.directory,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return { base, stop: () => stopWorker(child) };
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await stopWorker(child);
  throw new Error(`wrangler dev did not become ready:\n${output}`);
}

async function stopWorker(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  process.kill(-child.pid, "SIGTERM");
  const timer = setTimeout(() => process.kill(-child.pid, "SIGKILL"), 5_000);
  await exited;
  clearTimeout(timer);
}

async function seedUsers(database, users) {
  const now = Date.now();
  const statements = users.flatMap(({ id, token }) => [
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('${id}', '${id}', '${id}@example.com', 1, ${now}, ${now});`,
    `INSERT INTO authorized_users (user_id, authorized_at) VALUES ('${id}', ${now});`,
    `INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, userId) VALUES ('session-${id}', ${now + 86_400_000}, '${token}', ${now}, ${now}, '${id}');`,
  ]);
  await wrangler([
    "d1",
    "execute",
    "ownwords-local",
    "--local",
    "--config",
    database.configPath,
    "--command",
    statements.join(" "),
  ]);
  return Promise.all(
    users.map(async ({ id, token }) => ({
      id,
      cookie: `ownwords.session_token=${token}.${await makeSignature(token, SECRET)}`,
    })),
  );
}

async function api(worker, user, method, pathname, body) {
  const response = await fetch(`${worker.base}${pathname}`, {
    method,
    headers: {
      Origin: ORIGIN,
      Cookie: user.cookie,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function expectStatus(promise, status) {
  const result = await promise;
  assert.equal(result.status, status, JSON.stringify(result.body));
  return result.body;
}

function withoutTimestamp(exported) {
  const { exportedAt, ...rest } = exported;
  assert.match(exportedAt, /^\d{4}-\d{2}-\d{2}T/);
  return rest;
}

const lesson = (id) =>
  `/api/v1/learning/courses/russian-zero/versions/1/lessons/${id}`;

describe("backup export and restore rehearsal", { timeout: 300_000 }, () => {
  let source;
  let restored;
  let learner;
  let other;
  let learnerEntry;
  const snapshots = {};

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "ownwords-restore-"));
    source = await makeDatabaseDirectory("source");
    restored = await makeDatabaseDirectory("restored");
    await wrangler([
      "d1",
      "migrations",
      "apply",
      "ownwords-local",
      "--local",
      "--config",
      source.configPath,
    ]);
    await run(
      path.join(binaries, "tsx"),
      [
        path.join(apiDirectory, "scripts/local-content.ts"),
        PACK,
        "--persist-to",
        path.join(source.directory, ".wrangler/state"),
      ],
      { cwd: apiDirectory },
    );
    [learner, other] = await seedUsers(source, [
      { id: "restore-learner", token: "restore-learner-token" },
      { id: "restore-other", token: "restore-other-token" },
    ]);
  });

  after(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it("captures real API activity for two users on the source database", async () => {
    const worker = await startWorker(source);
    try {
      await expectStatus(
        api(worker, learner, "PUT", "/api/v1/onboarding", {
          languages: [
            { tag: "en", kind: "maintain", level: "native" },
            { tag: "ru", kind: "learn", level: "a0" },
          ],
          preferences: {
            explanationLanguage: "en",
            russianCourseAudio: true,
            translationSuggestions: false,
          },
        }),
        200,
      );
      learnerEntry = (
        await expectStatus(
          api(worker, learner, "POST", "/api/v1/lexicon/entries", {
            kind: "expression",
            senses: [
              {
                gloss: "restore rehearsal",
                equivalents: [
                  { languageTag: "en", text: "see you", status: "manual" },
                  { languageTag: "ru", text: "увидимся", status: "confirmed" },
                ],
              },
            ],
          }),
          201,
        )
      ).data;
      const due = await expectStatus(
        api(
          worker,
          learner,
          "GET",
          "/api/v1/lexicon/practice/due?language=ru&direction=produce&format=flashcard&sessionId=restore",
        ),
        200,
      );
      await expectStatus(
        api(worker, learner, "POST", "/api/v1/lexicon/practice/reviews", {
          submissionId: "restore-review",
          cardId: due.data[0].card.id,
          sessionId: "restore",
          rating: 3,
        }),
        201,
      );
      for (const stepId of ["hello-hear", "hello-use"]) {
        await expectStatus(
          api(worker, learner, "PUT", `${lesson("hello")}/progress`, {
            stepId,
          }),
          200,
        );
      }
      const completion = await expectStatus(
        api(worker, learner, "POST", `${lesson("hello")}/complete`),
        200,
      );
      assert.equal(completion.completion.lexiconSync.status, "synced");
      await expectStatus(
        api(worker, other, "POST", "/api/v1/lexicon/entries", {
          kind: "word",
          senses: [
            {
              gloss: "other owner",
              equivalents: [
                { languageTag: "en", text: "mine", status: "manual" },
              ],
            },
          ],
        }),
        201,
      );
      for (const user of [learner, other]) {
        snapshots[user.id] = withoutTimestamp(
          await expectStatus(
            api(worker, user, "GET", "/api/v1/account/export"),
            200,
          ),
        );
      }
      assert.equal(snapshots[learner.id].lexicon.entries.length, 2);
      assert.equal(snapshots[learner.id].lexicon.reviewEvents.length, 1);
      assert.equal(snapshots[other.id].lexicon.entries.length, 1);
    } finally {
      await worker.stop();
    }
  });

  it("restores a wrangler d1 export into a separate database with identical user data", async () => {
    const dump = path.join(workspace, "backup.sql");
    await wrangler([
      "d1",
      "export",
      "ownwords-local",
      "--local",
      "--config",
      source.configPath,
      "--output",
      dump,
    ]);
    await wrangler([
      "d1",
      "execute",
      "ownwords-local",
      "--local",
      "--config",
      restored.configPath,
      "--file",
      dump,
      "--yes",
    ]);
    const migrations = await wrangler([
      "d1",
      "migrations",
      "apply",
      "ownwords-local",
      "--local",
      "--config",
      restored.configPath,
    ]);
    assert.match(migrations, /No migrations to apply/);

    const worker = await startWorker(restored);
    try {
      for (const user of [learner, other]) {
        const exported = await expectStatus(
          api(worker, user, "GET", "/api/v1/account/export"),
          200,
        );
        assert.deepEqual(withoutTimestamp(exported), snapshots[user.id]);
      }
      const hidden = await api(
        worker,
        other,
        "GET",
        `/api/v1/lexicon/entries/${learnerEntry.id}`,
      );
      assert.equal(hidden.status, 404);

      // The restored database keeps enforcing enrollment and immutability.
      for (const stepId of ["goodbye-rule", "goodbye-use"]) {
        await expectStatus(
          api(worker, learner, "PUT", `${lesson("goodbye")}/progress`, {
            stepId,
          }),
          200,
        );
      }
      const next = await expectStatus(
        api(worker, learner, "POST", `${lesson("goodbye")}/complete`),
        200,
      );
      assert.equal(next.completion.lexiconSync.status, "synced");
      const triggers = await wrangler([
        "d1",
        "execute",
        "ownwords-local",
        "--local",
        "--config",
        restored.configPath,
        "--json",
        "--command",
        "UPDATE learning_course_versions SET title = 'tampered' WHERE course_id = 'russian-zero'",
      ]).then(
        () => "updated",
        (error) => `${error.stdout ?? ""}${error.stderr ?? ""}`,
      );
      assert.match(triggers, /unsupported content version transition/);
    } finally {
      await worker.stop();
    }
  });
});
