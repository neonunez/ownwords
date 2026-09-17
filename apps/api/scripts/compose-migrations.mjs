import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function composeMigrations(repositoryRoot) {
  const outputDirectory = path.join(repositoryRoot, ".wrangler", "migrations");
  const sources = [
    { directory: "apps/api/migrations", min: 1, max: 99 },
    { directory: "packages/lexicon/migrations", min: 100, max: 199 },
    { directory: "packages/learning/migrations", min: 200, max: 299 },
  ];
  const migrations = [];
  const numbers = new Set();
  for (const source of sources) {
    const directory = path.join(repositoryRoot, source.directory);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".sql")) continue;
      const match = /^(\d{4})[_-][a-z0-9_-]+\.sql$/i.exec(entry.name);
      const number = Number(match?.[1]);
      if (!match || number < source.min || number > source.max) {
        throw new Error(
          `Unexpected migration name ${entry.name} in ${directory}`,
        );
      }
      if (numbers.has(number)) {
        throw new Error(`Duplicate migration number ${match[1]}`);
      }
      numbers.add(number);
      migrations.push({
        name: entry.name,
        source: path.join(directory, entry.name),
      });
    }
  }
  if (!numbers.has(1)) throw new Error("Core migration 0001 is missing");
  migrations.sort((left, right) => left.name.localeCompare(right.name));
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  for (const migration of migrations) {
    await cp(migration.source, path.join(outputDirectory, migration.name));
  }
  return migrations.map(({ name }) => name);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const migrations = await composeMigrations(
    fileURLToPath(new URL("../../../", import.meta.url)),
  );
  process.stdout.write(
    `Composed ${migrations.length} migration(s) in deterministic filename order.\n`,
  );
}
