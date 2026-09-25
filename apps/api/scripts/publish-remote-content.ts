/**
 * Publishes one reviewed course pack to the production D1, through the
 * deployed API's guarded operator route. It never talks to Cloudflare, never
 * writes SQL, and never publishes unless this run is explicitly confirmed.
 *
 * Preflight (read-only, the default):
 *
 *   CONTENT_PUBLISH_TOKEN=... npm run content:publish:remote --workspace @ownwords/api -- \
 *     --config apps/api/wrangler.production.jsonc \
 *     --expect-course russian-foundations --expect-version 1 \
 *     --expect-hash <sha256 of the pack> \
 *     --note "<editorial status of this pack>" \
 *     ../../packages/learning/content/russian-foundations-v1.json
 *
 * Add `--confirm` to the same command to perform the publication. That write is
 * irreversible for that course version: a published version is immutable and is
 * corrected by publishing a higher version.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { contentHash, validateContentPack } from "@ownwords/learning/content";
import {
  assertExpectation,
  planPublicationRequests,
  PublicationRefusal,
  readPublicationTarget,
  readPublishToken,
} from "./remote-publication.mjs";

const USAGE =
  "Usage: publish-remote-content.ts --config <production.jsonc> --expect-course <id> " +
  "--expect-version <n> --expect-hash <sha256> --note <editorial status> " +
  "(--teacher-reviewed | --no-teacher-reviewed) <pack.json> [--confirm]";

interface Options {
  config: string;
  expectCourse: string;
  expectVersion: number;
  expectHash: string;
  note: string;
  teacherReviewed: boolean;
  pack: string;
  confirm: boolean;
}

function takeValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new PublicationRefusal("usage", `${flag} needs a value. ${USAGE}`);
  }
  return value;
}

function parseArguments(argv: string[]): Options {
  const options: Partial<Options> = {};
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--config":
        options.config = takeValue(argv, index, argument);
        index += 1;
        break;
      case "--expect-course":
        options.expectCourse = takeValue(argv, index, argument);
        index += 1;
        break;
      case "--expect-version": {
        const value = takeValue(argv, index, argument);
        if (!/^[1-9][0-9]*$/.test(value)) {
          throw new PublicationRefusal(
            "usage",
            `--expect-version must be a positive integer. ${USAGE}`,
          );
        }
        options.expectVersion = Number(value);
        index += 1;
        break;
      }
      case "--expect-hash": {
        const value = takeValue(argv, index, argument);
        if (!/^[a-f0-9]{64}$/.test(value)) {
          throw new PublicationRefusal(
            "usage",
            `--expect-hash must be the pack's 64-character lowercase sha256. ${USAGE}`,
          );
        }
        options.expectHash = value;
        index += 1;
        break;
      }
      case "--note":
        options.note = takeValue(argv, index, argument);
        index += 1;
        break;
      case "--teacher-reviewed":
        options.teacherReviewed = true;
        break;
      case "--no-teacher-reviewed":
        options.teacherReviewed = false;
        break;
      case "--confirm":
        options.confirm = true;
        break;
      default:
        if (argument.startsWith("-")) {
          throw new PublicationRefusal(
            "usage",
            `Unknown option ${argument}. ${USAGE}`,
          );
        }
        positional.push(argument);
    }
  }
  if (
    !options.config ||
    !options.expectCourse ||
    !options.expectVersion ||
    !options.expectHash ||
    !options.note ||
    typeof options.teacherReviewed !== "boolean" ||
    positional.length !== 1
  ) {
    throw new PublicationRefusal("usage", USAGE);
  }
  if (options.note.trim().length < 10) {
    throw new PublicationRefusal(
      "usage",
      "--note must state this pack's editorial status in a sentence, for example whether a qualified teacher has reviewed it and that it has no audio yet.",
    );
  }
  return {
    config: options.config,
    expectCourse: options.expectCourse,
    expectVersion: options.expectVersion,
    expectHash: options.expectHash,
    note: options.note,
    teacherReviewed: options.teacherReviewed,
    pack: positional[0],
    confirm: options.confirm ?? false,
  };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const target = readPublicationTarget(options.config);
  const token = readPublishToken(process.env);

  // Validate and hash locally, so a pack that is not the reviewed artifact is
  // refused here rather than after a request.
  const input: unknown = JSON.parse(
    await readFile(path.resolve(options.pack), "utf8"),
  );
  const pack = validateContentPack(input);
  const hash = await contentHash(pack);
  const expect = {
    courseId: options.expectCourse,
    version: options.expectVersion,
    contentHash: options.expectHash,
  };
  assertExpectation(
    { courseId: pack.course.id, version: pack.version, contentHash: hash },
    expect,
  );

  // The operator states the pack's editorial status; the route records the
  // statement, and the hash keeps the statement attached to the exact content.
  const editorial = {
    teacherReviewed: options.teacherReviewed,
    note: options.note.trim(),
  };
  const requests = planPublicationRequests({
    target,
    token,
    pack: input,
    expect,
    editorial,
    confirm: options.confirm,
  });

  const lessons = pack.units.reduce(
    (total, unit) => total + unit.lessons.length,
    0,
  );
  const withAudio = pack.items.filter((item) => item.audio).length;
  const lines = [
    `config      ${target.configPath}`,
    `worker      ${target.workerName}`,
    `origin      ${target.origin}`,
    `database    ${target.databaseName} (${target.databaseId})`,
    `course      ${pack.course.id} v${pack.version} "${pack.course.title}"`,
    `content     sha256:${hash}`,
    `contents    ${pack.units.length} units, ${lessons} lessons, ${pack.items.length} items, ${pack.references.length} references`,
    `audio       ${withAudio} of ${pack.items.length} items carry audio`,
    `editorial   ${editorial.note}`,
    `mode        ${options.confirm ? "CONFIRMED write after a preflight" : "preflight only; no write"}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);

  for (const request of requests) {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body ? JSON.stringify(request.body) : undefined,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `${request.step} failed: ${response.status} ${text.slice(0, 500)}`,
      );
    }
    process.stdout.write(`\n${request.step}:\n${text}\n`);
  }

  if (!options.confirm) {
    process.stdout.write(
      "\nNothing was published. Re-run the identical command with --confirm to " +
        "publish this exact version; a published course version cannot be changed afterwards.\n",
    );
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof PublicationRefusal) {
    console.error(`refused (${error.reason}): ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}
