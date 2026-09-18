import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { composeMigrations } from "./compose-migrations.mjs";

async function fixture(t, files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ownwords-migrations-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of files) {
    const destination = path.join(root, name);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, `SELECT '${name}';`);
  }
  return root;
}

test("composes sequential migrations across all reserved ranges in order", async (t) => {
  const files = [
    "packages/learning/migrations/0299_last.sql",
    "apps/api/migrations/0099_last.sql",
    "packages/lexicon/migrations/0101_next.sql",
    "apps/api/migrations/0002_next.sql",
    "packages/learning/migrations/0201_next.sql",
    "packages/lexicon/migrations/0100_initial.sql",
    "apps/api/migrations/0001_core.sql",
    "packages/learning/migrations/0200_initial.sql",
    "packages/lexicon/migrations/0199_last.sql",
  ];
  const root = await fixture(t, files);
  const names = await composeMigrations(root);
  assert.deepEqual(names, files.map((file) => path.basename(file)).sort());
  for (const file of files) {
    assert.equal(
      await readFile(
        path.join(root, ".wrangler/migrations", path.basename(file)),
        "utf8",
      ),
      `SELECT '${file}';`,
    );
  }
  await writeFile(
    path.join(root, ".wrangler/migrations/stale.sql"),
    "SELECT 0;",
  );
  await composeMigrations(root);
  assert.deepEqual(
    (await readdir(path.join(root, ".wrangler/migrations"))).sort(),
    names,
  );
});

for (const invalid of [
  "apps/api/migrations/0000_zero.sql",
  "apps/api/migrations/0100_wrong_owner.sql",
  "packages/lexicon/migrations/0099_wrong_owner.sql",
  "packages/lexicon/migrations/0200_wrong_owner.sql",
  "packages/learning/migrations/0199_wrong_owner.sql",
  "packages/learning/migrations/0300_wrong_owner.sql",
  "apps/api/migrations/not_numbered.sql",
  "apps/api/migrations/0001_duplicate.sql",
]) {
  test(`rejects ${invalid} before replacing composed output`, async (t) => {
    const root = await fixture(t, ["apps/api/migrations/0001_core.sql"]);
    await composeMigrations(root);
    await mkdir(path.dirname(path.join(root, invalid)), { recursive: true });
    await writeFile(path.join(root, invalid), "SELECT 1;");
    await assert.rejects(
      composeMigrations(root),
      /Unexpected migration|Duplicate migration/,
    );
    assert.deepEqual(await readdir(path.join(root, ".wrangler/migrations")), [
      "0001_core.sql",
    ]);
  });
}

test("requires the initial core migration but permits missing domain packages", async (t) => {
  const root = await fixture(t, ["apps/api/migrations/0002_later.sql"]);
  await assert.rejects(
    composeMigrations(root),
    /Core migration 0001 is missing/,
  );
  await writeFile(
    path.join(root, "apps/api/migrations/0001_core.sql"),
    "SELECT 1;",
  );
  assert.deepEqual(await composeMigrations(root), [
    "0001_core.sql",
    "0002_later.sql",
  ]);
});
