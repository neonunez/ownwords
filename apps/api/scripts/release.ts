/**
 * The automated release. Four ordered subcommands, one per stage, so the
 * workflow that runs them is readable and each stage can be re-run on its own:
 *
 *   release config    write the production config from the tracked template
 *                     plus the owner's GitHub values, and prove the target
 *   release migrate   compose the migrations, list the plan against the exact
 *                     target, apply the safe ones, verify what landed
 *   release deploy    dry-run, deploy the Worker and the built app, then read
 *                     the live binding and the public origin back
 *   release publish   publish the course versions a reviewed pull request
 *                     authorized, and nothing else
 *
 * Every stage refuses rather than guesses: a missing secret, a widened
 * hostname, a substituted database, an unproven migration or a publication that
 * is not the named course, version and hash all stop the release with the reason
 * printed. No credential is ever an argument, a log line or a generated file.
 */
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { contentHash, validateContentPack } from "@ownwords/learning/content";
import { composeMigrations } from "./compose-migrations.mjs";
import {
  apiDirectory,
  PRODUCTION_HOST,
  repositoryRoot,
} from "./production-hosting.mjs";
import {
  prepareReleaseConfig,
  RELEASE_CONFIG_PATH,
  ReleaseRefusal,
} from "./release-config.mjs";
import {
  classifyMigration,
  CONTENT_RELEASES_PATH,
  DATABASE_AUTHORIZATIONS_PATH,
  planMigrations,
  pendingMigrations,
  probeProduction,
  readContentReleases,
  readDatabaseAuthorizations,
} from "./release-plan.mjs";
import {
  assertExpectation,
  planPublicationRequests,
  PublicationRefusal,
  readPublicationTarget,
  readPublishToken,
  verifyDeployedDatabaseBinding,
} from "./remote-publication.mjs";

const execFileAsync = promisify(execFile);
const log = (line: string) => process.stdout.write(`${line}\n`);

/** A Wrangler call exactly as given; the binding read-back names its own config. */
const exec = async (args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync(
    "npx",
    ["--no-install", "wrangler", ...args],
    { cwd: repositoryRoot, maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout;
};

/** Read-only or writing Wrangler calls, always against the generated config. */
const wrangler = (args: string[]): Promise<string> =>
  exec([...args, "--config", RELEASE_CONFIG_PATH]);

const PRODUCTION_DATABASE = "ownwords-production";

/** A release record an owner edits; a missing one is a refusal, not a crash. */
async function readReleaseRecord(file: string): Promise<string> {
  return readFile(path.join(repositoryRoot, file), "utf8").catch(() => {
    throw new ReleaseRefusal(
      "missing_record",
      `${file} is missing; a release states what it may change in the release records, and an absent record authorizes nothing`,
    );
  });
}

/** The generated config is the release's only target, and it is re-proved here. */
async function releaseTarget() {
  try {
    return readPublicationTarget(RELEASE_CONFIG_PATH);
  } catch (error) {
    if (error instanceof ReleaseRefusal || error instanceof PublicationRefusal)
      throw error;
    throw new ReleaseRefusal(
      "missing_config",
      `no production config at ${RELEASE_CONFIG_PATH}; run "npm run release --workspace @ownwords/api -- config" first`,
    );
  }
}

/**
 * Before anything is written: the configured D1 ID is the one Cloudflare names
 * ownwords-production and the one the live Worker is already bound to.
 */
async function proveLiveTarget(
  target: Awaited<ReturnType<typeof releaseTarget>>,
): Promise<void> {
  const live = await verifyDeployedDatabaseBinding({ target, exec });
  log(
    `live        version ${live.versionIds.join(", ")} of ${target.workerName} is bound to ${target.databaseName} (${target.databaseId})`,
  );
}

/** Stage one: the config, and the proof that it is the intended target. */
async function stageConfig(): Promise<void> {
  const prepared = await prepareReleaseConfig({
    env: process.env,
    write: async (file, text) => writeFile(file, text),
  });
  log(`config      ${prepared.configPath} (generated, gitignored)`);
  log(`worker      ${prepared.target.workerName}`);
  log(`origin      ${prepared.target.origin}`);
  log(`database    ${prepared.target.databaseName}`);
  log(`domain      ${prepared.host} (custom domain, workers.dev off)`);
  log("target      proved against the publisher's own production guards");
}

/** Stage two: migrations, in order, with a list checkpoint and a gate. */
async function stageMigrate(): Promise<void> {
  const target = await releaseTarget();
  await proveLiveTarget(target);
  const composed = await composeMigrations(repositoryRoot);
  const directory = path.join(repositoryRoot, ".wrangler", "migrations");
  const sqlByName: Record<string, string> = {};
  for (const name of composed) {
    sqlByName[name] = await readFile(path.join(directory, name), "utf8");
  }
  log(`database    ${target.databaseName} (${target.databaseId})`);
  log(`composed    ${composed.join(", ") || "none"}`);

  // The checkpoint: Wrangler's own list of what it would apply to this exact
  // database, read before anything is applied.
  const list = await wrangler([
    "d1",
    "migrations",
    "list",
    PRODUCTION_DATABASE,
    "--remote",
  ]);
  log(`plan\n${list.trimEnd()}`);

  const applied = await appliedMigrations();
  const pending = pendingMigrations({ composed, applied });
  const plan = planMigrations({
    pending,
    sqlByName,
    authorizations: readDatabaseAuthorizations(
      await readReleaseRecord(DATABASE_AUTHORIZATIONS_PATH),
    ),
  });
  for (const migration of plan.planned) {
    const how = migration.safe
      ? "additive; applies on merge"
      : migration.authorizedBy
        ? `destructive; authorized by ${migration.authorizedBy}`
        : "destructive; NOT authorized";
    log(
      `pending     ${migration.name} (${migration.statements} statements, sha256:${migration.sha256}) ${how}`,
    );
  }
  if (plan.blocked.length > 0) {
    for (const migration of plan.blocked) {
      log(
        `refused     ${migration.name} sha256:${migration.sha256}: ${migration.reasons.join("; ")}`,
      );
    }
    throw new ReleaseRefusal(
      "unauthorized_migration",
      `${plan.blocked.length} migration(s) would change or remove data the deployed code is serving, and ${DATABASE_AUTHORIZATIONS_PATH} does not authorize them by exact file and sha256; nothing was applied. Add the entry, or split the change into an additive migration and a later one`,
    );
  }
  if (plan.planned.length === 0) {
    log("migrations  nothing pending");
    return;
  }

  await wrangler([
    "d1",
    "migrations",
    "apply",
    PRODUCTION_DATABASE,
    "--remote",
  ]);
  const afterwards = await appliedMigrations();
  const missing = pending.filter((name) => !afterwards.includes(name));
  if (missing.length > 0) {
    throw new ReleaseRefusal(
      "migration_unverified",
      `${missing.join(", ")} did not reach ${PRODUCTION_DATABASE}; the schema is not what this release assumes`,
    );
  }
  for (const migration of plan.planned) {
    if (!migration.safe) {
      log(
        `applied     ${migration.name} under the ${DATABASE_AUTHORIZATIONS_PATH} authorization by ${migration.authorizedBy}; a Worker rollback does not reverse it`,
      );
    }
  }
  log(`migrations  applied and verified ${plan.planned.length} migration(s)`);
}

/** What `d1_migrations` records, as Wrangler's JSON shape carries it. */
async function appliedMigrations(): Promise<string[]> {
  const output = await wrangler([
    "d1",
    "execute",
    PRODUCTION_DATABASE,
    "--remote",
    "--command",
    "SELECT name FROM d1_migrations ORDER BY name",
    "--json",
  ]);
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new ReleaseRefusal(
      "unreadable_migrations",
      "the applied migration list from Cloudflare was not JSON",
    );
  }
  const rows = Array.isArray(parsed) ? parsed[0]?.results : undefined;
  if (!Array.isArray(rows)) {
    throw new ReleaseRefusal(
      "unreadable_migrations",
      "the applied migration list from Cloudflare had no rows",
    );
  }
  return rows.map((row) => String(row?.name ?? ""));
}

/** Stage three: the Worker and the built app, then a read-back of both. */
async function stageDeploy(): Promise<void> {
  const target = await releaseTarget();
  const shell = path.join(apiDirectory, "..", "web", "dist", "index.html");
  await readFile(shell).catch(() => {
    throw new ReleaseRefusal(
      "missing_assets",
      "apps/web/dist/index.html is missing; build the app (npm run build --workspace @ownwords/web) before deploying. The demo build is never deployed",
    );
  });

  await proveLiveTarget(target);
  const dryRun = await wrangler(["deploy", "--dry-run"]);
  log(`dry-run\n${dryRun.trimEnd()}`);
  assertNoWorkersDev(dryRun);
  const deployed = await wrangler(["deploy"]);
  log(`deploy\n${deployed.trimEnd()}`);
  assertNoWorkersDev(deployed);

  const live = await verifyDeployedDatabaseBinding({ target, exec });
  // The version this run deployed is the version now serving, read back from
  // Cloudflare rather than trusted from the deploy's own output.
  const current = /Current Version ID:\s*([0-9a-f-]{36})/i.exec(deployed)?.[1];
  if (!current) {
    throw new ReleaseRefusal(
      "unreadable_deploy",
      "the deploy output named no Current Version ID, so this release cannot prove which version is live",
    );
  }
  if (!live.versionIds.includes(current)) {
    throw new ReleaseRefusal(
      "deployed_binding_mismatch",
      `this run deployed ${current}, but the live version is ${live.versionIds.join(", ")}; something else changed the deployment`,
    );
  }
  log(
    `deployed    version ${current} of ${target.workerName} is live and bound to ${target.databaseName}`,
  );
  await probeProduction({ origin: target.origin, log });
  log(`origin      ${target.origin} serves the new version`);
}

/**
 * A `workers.dev` line in Wrangler's own output would mean the release published
 * a second, unintended hostname. It never does by configuration; this is the
 * check on the evidence rather than on the intention.
 */
function assertNoWorkersDev(output: string): void {
  if (/workers\.dev/i.test(output)) {
    throw new ReleaseRefusal(
      "workers_dev_exposed",
      "the release output mentions a workers.dev hostname; the production configuration never publishes one",
    );
  }
}

type PublicationRequest = ReturnType<typeof planPublicationRequests>[number];

/** One guarded request to the deployed operator route. Never logs headers. */
async function sendPublication(
  request: PublicationRequest,
  fetchImpl: typeof fetch,
): Promise<any> {
  const response = await fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new ReleaseRefusal(
      "publication_failed",
      `${request.step} failed: ${response.status} ${text.slice(0, 500)}`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ReleaseRefusal(
      "publication_unreadable",
      `${request.step} answered ${response.status} with a body that is not JSON`,
    );
  }
}

/**
 * Stage four: the course versions a reviewed pull request authorized. The
 * preflight always runs; the write happens only for an entry that is not already
 * published, so re-running a release is a no-op rather than a second attempt at
 * an irreversible write.
 */
async function stagePublish(): Promise<void> {
  const target = await releaseTarget();
  const releases = readContentReleases(
    await readReleaseRecord(CONTENT_RELEASES_PATH),
  );
  if (releases.length === 0) {
    log("content     no authorized versions");
    return;
  }
  const token = readPublishToken(process.env);
  const live = await verifyDeployedDatabaseBinding({ target, exec });
  log(
    `deployed    version ${live.versionIds.join(", ")} of ${target.workerName} is bound to ${target.databaseName}`,
  );

  for (const release of releases) {
    const packPath = path.resolve(repositoryRoot, release.pack);
    const pack = validateContentPack(
      JSON.parse(await readFile(packPath, "utf8")),
    );
    const hash = await contentHash(pack);
    const expect = {
      courseId: release.courseId,
      version: release.version,
      contentHash: release.contentHash,
    };
    assertExpectation(
      { courseId: pack.course.id, version: pack.version, contentHash: hash },
      expect,
    );
    log(
      `content     ${pack.course.id} v${pack.version} sha256:${hash} (${release.pack})`,
    );

    const [preflight, write] = planPublicationRequests({
      target,
      token,
      pack,
      expect,
      confirm: true,
    });
    const read = await sendPublication(preflight, fetch);
    const action = read?.data?.action;
    if (action === "already-published") {
      log(
        `            already published (${read?.data?.versions?.length ?? 0} version(s) on record); nothing written`,
      );
      continue;
    }
    if (action !== "publish" && action !== "resume-draft") {
      throw new ReleaseRefusal(
        "unexpected_action",
        `${pack.course.id} v${pack.version} preflight answered ${String(action)}; a release only publishes, resumes an identical draft, or finds the version already published`,
      );
    }
    const result = await sendPublication(write as PublicationRequest, fetch);
    log(
      `            ${result?.data?.action} ${result?.data?.status} at ${result?.data?.publishedAt}; this version is now immutable and a Worker rollback does not reverse it`,
    );
  }
}

const STAGES: Record<string, () => Promise<void>> = {
  config: stageConfig,
  migrate: stageMigrate,
  deploy: stageDeploy,
  publish: stagePublish,
};

try {
  const stage = process.argv[2];
  if (!stage || !(stage in STAGES)) {
    throw new ReleaseRefusal(
      "usage",
      `Usage: npm run release --workspace @ownwords/api -- <${Object.keys(STAGES).join("|")}>`,
    );
  }
  log(`stage       ${stage} (${PRODUCTION_HOST})`);
  await STAGES[stage]();
} catch (error) {
  if (error instanceof ReleaseRefusal || error instanceof PublicationRefusal) {
    console.error(`refused (${error.reason}): ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}
