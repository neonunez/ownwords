// Serves the connected app for the stack browser tests, on local state only:
// the real API under `wrangler dev` with a fresh local D1 (every composed
// migration, plus the authored Russian Foundations course), and the production build of the
// app under `vite preview`, which forwards /api to it so both share one
// origin as a deployment does. Sign-in is credential-free: the accounts are
// real Better Auth session rows signed with a test-only secret, the same
// technique the API's integration tests use. Nothing here reaches Google, a
// Cloudflare account or any other network service.
//
// Run by `playwright.stack.config.ts`, which builds the app first. It keeps
// running until it is stopped, and stops both servers with it.
import { execFile, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  ADMIN_TOKEN,
  API_PORT,
  ORIGIN,
  STATE,
  USERS,
  WEB_PORT,
} from "./env.mjs";

const run = promisify(execFile);
const webDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = path.resolve(webDirectory, "..", "..");
const apiDirectory = path.join(root, "apps", "api");
const bin = (name) => path.join(root, "node_modules", ".bin", name);
const SECRET = "stack-tests-only-secret-with-at-least-32-chars";
const persist = path.join(STATE, "state");
const configPath = path.join(STATE, "wrangler.json");
const children = [];
const quiet = { ...process.env, WRANGLER_SEND_METRICS: "false" };

function log(message) {
  process.stdout.write(`[stack] ${message}\n`);
}

async function step(label, file, args, options = {}) {
  log(label);
  await run(file, args, {
    cwd: root,
    env: quiet,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
}

function start(label, file, args, options) {
  // In this process's own group, so whoever stops this script stops them too.
  const child = spawn(file, args, {
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  child.stdout.on("data", (chunk) =>
    process.stdout.write(`[${label}] ${chunk}`),
  );
  child.stderr.on("data", (chunk) =>
    process.stderr.write(`[${label}] ${chunk}`),
  );
  child.on("exit", (code) => {
    if (!stopping) {
      log(`${label} exited with ${code}`);
      void stop(1);
    }
  });
  children.push(child);
  return child;
}

let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  process.exit(code);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());

async function waitFor(url, label) {
  for (let attempt = 0; attempt < 480; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;

async function seedUsers() {
  const now = Date.now();
  const accounts = Object.entries(USERS).map(([key, email]) => ({
    key,
    id: `stack-${key}`,
    email,
    token: `stack-${key}-session-token`,
  }));
  const statements = accounts.flatMap(({ id, email, token }) => [
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (${sql(id)}, ${sql(id)}, ${sql(email)}, 1, ${now}, ${now});`,
    `INSERT INTO authorized_users (user_id, authorized_at) VALUES (${sql(id)}, ${now});`,
    `INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (${sql(`session-${id}`)}, ${now + 86_400_000}, ${sql(token)}, ${now}, ${now}, ${sql(id)});`,
  ]);
  await step("seeding synthetic accounts", bin("wrangler"), [
    "d1",
    "execute",
    "ownwords-local",
    "--local",
    "--config",
    configPath,
    "--persist-to",
    persist,
    "--command",
    statements.join(" "),
  ]);
  // Better Auth signs the session token with HMAC-SHA256 and standard base64.
  const cookies = Object.fromEntries(
    accounts.map(({ key, token }) => [
      key,
      `${token}.${createHmac("sha256", SECRET).update(token).digest("base64")}`,
    ]),
  );
  await writeFile(
    path.join(STATE, "sessions.json"),
    JSON.stringify({ cookieName: "ownwords.session_token", cookies }),
  );
}

async function main() {
  await rm(STATE, { recursive: true, force: true });
  await mkdir(STATE, { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({
      name: "ownwords-api",
      main: path.join(apiDirectory, "src/index.ts"),
      compatibility_date: "2026-09-15",
      compatibility_flags: ["nodejs_compat"],
      // The app's origin is the one the browser sees: the preview, which
      // forwards /api here. Auth, CORS and the passkey relying party all
      // name it, as a deployment names its public host.
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
          migrations_dir: path.join(root, ".wrangler/migrations"),
        },
      ],
    }),
  );

  await step("building the Lexicon package", "npm", [
    "run",
    "deps:build",
    "--workspace",
    "@ownwords/api",
  ]);
  await step("composing migrations", "npm", [
    "run",
    "db:compose",
    "--workspace",
    "@ownwords/api",
  ]);
  await step("applying migrations to a fresh local D1", bin("wrangler"), [
    "d1",
    "migrations",
    "apply",
    "ownwords-local",
    "--local",
    "--config",
    configPath,
    "--persist-to",
    persist,
  ]);
  await step(
    "publishing the authored Russian Foundations course",
    bin("tsx"),
    [
      path.join(apiDirectory, "scripts/local-content.ts"),
      path.join(root, "packages/learning/content/russian-foundations-v1.json"),
      "--persist-to",
      persist,
    ],
    { cwd: apiDirectory },
  );
  await seedUsers();

  log(`starting the API on 127.0.0.1:${API_PORT}`);
  start(
    "api",
    bin("wrangler"),
    [
      "dev",
      "--config",
      configPath,
      "--persist-to",
      persist,
      "--ip",
      "127.0.0.1",
      "--port",
      String(API_PORT),
      "--var",
      `BETTER_AUTH_SECRET:${SECRET}`,
      "--var",
      `INVITATION_ADMIN_TOKEN:${ADMIN_TOKEN}`,
      // Placeholders, so the Google redirect can be checked without an account.
      "--var",
      "GOOGLE_CLIENT_ID:stack-placeholder.apps.googleusercontent.com",
      "--var",
      "GOOGLE_CLIENT_SECRET:stack-placeholder-secret",
      "--show-interactive-dev-session=false",
      "--log-level",
      "warn",
    ],
    { cwd: STATE, env: quiet },
  );
  await waitFor(`http://127.0.0.1:${API_PORT}/health`, "The API");

  log(`starting the app on ${ORIGIN}`);
  start(
    "web",
    bin("vite"),
    [
      "preview",
      "--port",
      String(WEB_PORT),
      "--strictPort",
      "--host",
      "localhost",
    ],
    {
      cwd: webDirectory,
      env: { ...process.env, OWNWORDS_API_URL: `http://127.0.0.1:${API_PORT}` },
    },
  );
  await waitFor(`${ORIGIN}/`, "The app");
  const { cookieName, cookies } = JSON.parse(
    await readFile(path.join(STATE, "sessions.json"), "utf8"),
  );
  log(
    `ready. To use it by hand, open ${ORIGIN} and sign in as a synthetic account from the browser console:\n` +
      `  document.cookie = "${cookieName}=${cookies.collector}; path=/"\n` +
      `  (every account's cookie is in ${path.join(STATE, "sessions.json")})`,
  );
}

main().catch((error) => {
  process.stderr.write(`[stack] ${error.stack ?? error}\n`);
  void stop(1);
});
