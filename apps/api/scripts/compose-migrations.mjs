import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const outputDirectory = path.join(repositoryRoot, ".wrangler", "migrations");
const sources = [
  {
    directory: path.join(repositoryRoot, "apps", "api", "migrations"),
    prefix: "0001",
  },
  {
    directory: path.join(repositoryRoot, "packages", "lexicon", "migrations"),
    prefix: "0100",
  },
  {
    directory: path.join(repositoryRoot, "packages", "learning", "migrations"),
    prefix: "0200",
  },
];

const migrations = [];
for (const source of sources) {
  let entries;
  try {
    entries = await readdir(source.directory, { withFileTypes: true });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      continue;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".sql")) continue;
    if (
      !entry.name.startsWith(source.prefix) ||
      !/^\d{4}[_-][a-z0-9_-]+\.sql$/i.test(entry.name)
    ) {
      throw new Error(
        `Unexpected migration name ${entry.name} in ${source.directory}`,
      );
    }
    migrations.push({
      name: entry.name,
      source: path.join(source.directory, entry.name),
    });
  }
}

migrations.sort((left, right) => left.name.localeCompare(right.name));
for (let index = 1; index < migrations.length; index += 1) {
  if (migrations[index]?.name === migrations[index - 1]?.name) {
    throw new Error(`Duplicate migration name ${migrations[index]?.name}`);
  }
}
if (!migrations.some((migration) => migration.name.startsWith("0001"))) {
  throw new Error("Core migration 0001 is missing");
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
for (const migration of migrations) {
  await cp(migration.source, path.join(outputDirectory, migration.name));
}

process.stdout.write(
  `Composed ${migrations.length} migration(s) in deterministic filename order.\n`,
);
