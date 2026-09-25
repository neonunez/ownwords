// The production hosting shape, exercised by real Wrangler on this machine: a
// dry run of the deploy the template describes, and a local `wrangler dev`
// serving that deploy's own configuration. What it proves is the same-origin
// contract the app depends on - one host serving `apps/web/dist` and answering
// `/api/*` with the Worker, with the app shell's fallback never in front of an
// API request.
//
// It builds the app, runs against a local D1 and placeholder credentials, and
// never deploys, never authenticates to Cloudflare, and never opens a
// production resource. See `docs/SETUP.md` for the operator's own steps.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  freePort,
  repositoryRoot,
  webDirectory,
  writeLocalHostingConfig,
} from "./production-hosting.mjs";

const run = promisify(execFile);
const root = repositoryRoot;
const wrangler = path.join(root, "node_modules", ".bin", "wrangler");
const quiet = { ...process.env, WRANGLER_SEND_METRICS: "false" };
// Placeholder values for a local run only: this never reaches Google, and the
// production values exist as Worker secrets, not here.
const placeholderVars = {
  BETTER_AUTH_SECRET: "hosting-check-only-secret-of-32-plus-characters",
  GOOGLE_CLIENT_ID: "hosting-check-only-client-id",
  GOOGLE_CLIENT_SECRET: "hosting-check-only-client-secret",
};
const varFlags = Object.entries(placeholderVars).flatMap(([key, value]) => [
  "--var",
  `${key}:${value}`,
]);

function step(label, file, args) {
  return run(file, args, {
    cwd: root,
    env: quiet,
    maxBuffer: 32 * 1024 * 1024,
  }).then(({ stdout, stderr }) => {
    process.stdout.write(`[hosting] ${label}\n`);
    return `${stdout}${stderr}`;
  });
}

test(
  "one Worker serves the built app and the API, and the fallback never answers for /api",
  { timeout: 600_000 },
  async (t) => {
    await step("building the API's dependency packages", "npm", [
      "run",
      "deps:build",
      "--workspace",
      "@ownwords/api",
    ]);
    await step("building the app bundle", "npm", [
      "run",
      "build",
      "--workspace",
      "@ownwords/web",
    ]);

    const { config, configPath, directory } = await writeLocalHostingConfig();
    t.after(() => rm(directory, { recursive: true, force: true }));

    // The deploy the template describes, without sending it: the asset upload
    // is the app's own build, the bindings are production's, and no hostname
    // appears in the plan.
    const dryRun = await step("dry-running the production deploy", wrangler, [
      "deploy",
      "--dry-run",
      "--config",
      configPath,
    ]);
    const distFiles = await filesUnder(path.join(webDirectory, "dist"));
    const uploaded = /Read (\d+) files from the assets directory (\S+)/.exec(
      dryRun,
    );
    assert.ok(uploaded, "the dry run must read an asset directory");
    assert.equal(uploaded[2], path.join(webDirectory, "dist"));
    assert.ok(
      Number(uploaded[1]) >= distFiles.length,
      `the dry run must upload the app's own ${distFiles.length} built files`,
    );
    assert.ok(distFiles.includes("index.html"));
    assert.ok(distFiles.includes("manifest.webmanifest"));
    assert.ok(distFiles.includes("sw.js"));
    assert.ok(!dryRun.includes("demo-dist"), "never the demo build");
    assert.ok(
      !dryRun.includes("workers.dev"),
      "no workers.dev host is planned",
    );
    for (const variable of Object.keys(config.vars)) {
      assert.ok(
        dryRun.includes(`env.${variable} ("${config.vars[variable]}")`),
        `the dry run must show ${variable}`,
      );
    }
    assert.ok(dryRun.includes("env.DB (ownwords-production)"));

    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const server = spawn(
      wrangler,
      [
        "dev",
        "--config",
        configPath,
        "--ip",
        "127.0.0.1",
        "--port",
        String(port),
        ...varFlags,
      ],
      { cwd: root, env: quiet, stdio: ["ignore", "pipe", "pipe"] },
    );
    t.after(() => {
      if (server.exitCode === null) server.kill("SIGTERM");
    });
    const log = [];
    server.stdout.on("data", (chunk) => log.push(String(chunk)));
    server.stderr.on("data", (chunk) => log.push(String(chunk)));
    server.on("exit", (code) => {
      if (code) process.stdout.write(log.join(""));
    });
    await waitForServer(`${origin}/health`, log);

    // The app shell, its routes, and the installable app's own files.
    const shell = await get(`${origin}/`);
    assert.equal(shell.status, 200);
    assert.match(shell.contentType, /text\/html/);
    assert.match(shell.body, /<div id="root">/);

    const route = await get(`${origin}/maintain/lexicon`);
    assert.equal(route.status, 200);
    assert.match(route.contentType, /text\/html/);
    assert.match(route.body, /<div id="root">/);

    const manifest = await get(`${origin}/manifest.webmanifest`);
    assert.equal(manifest.status, 200);
    const installable = manifest.json();
    assert.equal(installable.scope, "/");
    assert.equal(installable.start_url, "/");
    assert.equal(installable.display, "standalone");

    const worker = await get(`${origin}/sw.js`);
    assert.equal(worker.status, 200);
    assert.match(worker.contentType, /javascript/);

    const icon = await get(`${origin}/icons/icon-192.png`);
    assert.equal(icon.status, 200);
    assert.match(icon.contentType, /image\/png/);

    // The Worker, not the shell: JSON in, JSON out, its own 404 included.
    const missing = await get(`${origin}/api/nope`);
    assert.equal(missing.status, 404);
    assert.match(missing.contentType, /application\/json/);
    assert.equal((await missing.json()).error.code, "not_found");

    const bare = await get(`${origin}/api`);
    assert.equal(bare.status, 404);
    assert.match(bare.contentType, /application\/json/);

    // The real session endpoint. Its local D1 carries no schema, so the answer
    // may be an error; what matters is that the Worker, not the shell, gives it.
    const session = await get(`${origin}/api/auth/get-session`);
    assert.match(session.contentType, /application\/json/);
    assert.doesNotMatch(session.contentType, /text\/html/);

    // A write to the API from an untrusted origin is refused by the Worker,
    // which is another way of seeing the Worker, not the shell, own /api.
    const refused = await fetch(`${origin}/api/v1/invitations/redeem`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://not-ownwords.example",
      },
      body: JSON.stringify({ code: "hosting-check" }),
    });
    assert.equal(refused.status, 403);
    assert.match(
      refused.headers.get("content-type") ?? "",
      /application\/json/,
    );
    assert.equal((await refused.json()).error.code, "origin_forbidden");

    const health = await get(`${origin}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
  },
);

async function filesUnder(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(...(await filesUnder(path.join(directory, entry.name))));
    } else {
      found.push(entry.name);
    }
  }
  return found;
}

async function get(url) {
  const response = await fetch(url);
  const body = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    body,
    json: () => JSON.parse(body),
  };
}

async function waitForServer(url, log) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (log.join("").includes("Ready on")) {
      try {
        if ((await fetch(url)).status < 500) return;
      } catch {
        // Not listening yet.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`wrangler dev never became ready at ${url}`);
}
