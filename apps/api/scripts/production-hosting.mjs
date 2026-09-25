// The production hosting shape, in one place, read from the tracked Wrangler
// template rather than repeated here.
//
// `wrangler.production.jsonc.example` is the configuration an operator copies;
// it is a template, not a deployable file, because its D1 ID is a placeholder
// and its host is written down rather than provisioned here. These helpers read
// it so the tests check the shape that will actually be deployed, and derive a
// local, credential-free copy of it for real Wrangler runs. Nothing in this
// module deploys, authenticates to Cloudflare, or holds a secret.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const apiDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const webDirectory = path.resolve(apiDirectory, "..", "web");
export const repositoryRoot = path.resolve(apiDirectory, "..", "..");
export const templatePath = path.join(
  apiDirectory,
  "wrangler.production.jsonc.example",
);

/** The approved public origin, and the passkey relying party on it. */
export const PRODUCTION_HOST = "ownwords.neonunez.com";
export const PRODUCTION_ORIGIN = `https://${PRODUCTION_HOST}`;

/**
 * Reads JSON with comments and trailing commas, the dialect Wrangler accepts,
 * without pulling in a parser the repository does not depend on.
 */
export function parseJsonc(source) {
  let text = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (inLineComment) {
      if (character === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (character === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      text += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      text += character;
      continue;
    }
    if (character === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    text += character;
  }

  return JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"));
}

/** The tracked production template, parsed. */
export async function readProductionTemplate() {
  return parseJsonc(await readFile(templatePath, "utf8"));
}

/**
 * The production template with its environment-specific parts made local: the
 * asset directory and the Worker entrypoint point at this checkout, and the
 * placeholder D1 ID becomes a local one. Everything an operator must be able to
 * see at a glance - the name, the public host, the asset shape, the routing
 * rules - is the template's own, so a real Wrangler run exercises it.
 */
export async function writeLocalHostingConfig({
  name = "ownwords-api",
  assetsDirectory = path.join(webDirectory, "dist"),
} = {}) {
  const template = await readProductionTemplate();
  const config = { ...template, name };
  delete config.$schema;
  config.main = path.join(apiDirectory, "src", "index.ts");
  Object.assign(config, {
    assets: {
      ...template.assets,
      directory: assetsDirectory,
    },
    d1_databases: template.d1_databases.map((database) => ({
      ...database,
      database_id: "00000000-0000-0000-0000-000000000000",
      migrations_dir: path.join(repositoryRoot, ".wrangler", "migrations"),
    })),
  });

  const directory = await mkdtemp(path.join(os.tmpdir(), "ownwords-hosting-"));
  const configPath = path.join(directory, "wrangler.jsonc");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return { config, configPath, directory };
}
