import { readFile } from "node:fs/promises";
import { contentHash, ContentValidationError, validateContentPack } from "../src/content";

async function main(): Promise<void> {
  const [command, file] = process.argv.slice(2);
  if (command !== "validate" || !file) {
    console.error("Usage: npm run content:validate -- <content-pack.json>");
    process.exitCode = 2;
    return;
  }

  let input: unknown;
  try {
    input = JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (error) {
    console.error(`Could not read valid JSON: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
    return;
  }

  try {
    const pack = validateContentPack(input);
    const hash = await contentHash(pack);
    console.log(`valid ${pack.course.id}@${pack.version} sha256:${hash}`);
  } catch (error) {
    if (error instanceof ContentValidationError) {
      for (const issue of error.issues) console.error(issue);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

await main();
