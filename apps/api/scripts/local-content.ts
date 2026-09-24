/**
 * Publishes a validated course pack into the LOCAL D1 database used by
 * `wrangler dev`. It never touches a remote database.
 *
 *   npm run content:publish:local --workspace @ownwords/api -- <pack.json> [--persist-to <dir>]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ingestCourseVersion,
  publishCourseVersion,
} from "@ownwords/learning/operator";
import { getPlatformProxy } from "wrangler";

const apiDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function parseArguments(argv: string[]): { pack: string; persistTo?: string } {
  const [pack, ...rest] = argv;
  if (!pack || pack.startsWith("-")) {
    throw new Error("Usage: local-content.ts <pack.json> [--persist-to <dir>]");
  }
  if (rest.length === 0) return { pack };
  if (rest.length === 2 && rest[0] === "--persist-to" && rest[1]) {
    return { pack, persistTo: rest[1] };
  }
  throw new Error(`Unexpected arguments: ${rest.join(" ")}`);
}

const { pack, persistTo } = parseArguments(process.argv.slice(2));
const input: unknown = JSON.parse(await readFile(path.resolve(pack), "utf8"));
const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath: path.join(apiDirectory, "wrangler.jsonc"),
  // Same meaning as wrangler's --persist-to, which keeps state under <dir>/v3.
  ...(persistTo
    ? { persist: { path: path.join(path.resolve(persistTo), "v3") } }
    : {}),
});
try {
  // A failed ingest leaves no draft; an interrupted run leaves an identical
  // draft that ingest reports as unchanged, so re-running resumes the publish.
  const ingested = await ingestCourseVersion(proxy.env.DB, input);
  await publishCourseVersion(proxy.env.DB, ingested.courseId, ingested.version);
  process.stdout.write(
    `Published ${ingested.courseId} v${ingested.version} (${ingested.contentHash.slice(0, 12)}) to local D1.\n`,
  );
} finally {
  await proxy.dispose();
}
