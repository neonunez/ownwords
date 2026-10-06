import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { carryoverMigrationSql } from "../src/carryover";

const target = fileURLToPath(
  new URL("../migrations/0202_learn_practice_carryover.sql", import.meta.url),
);
await writeFile(target, carryoverMigrationSql());
console.log(`wrote ${target}`);
