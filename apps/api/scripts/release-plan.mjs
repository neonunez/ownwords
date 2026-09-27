// What a release is allowed to do to production, decided from repository data
// alone: which migrations it may apply without a human, which course versions
// it may publish, and how it reads the live deployment back afterwards.
//
// The line this draws is the one the owner asked for. A backward-compatible
// addition - a new table, an index, a nullable column, a guard trigger - applies
// itself on merge, because the deployed code keeps working either way. Anything
// that could destroy or reinterpret data, and anything this module cannot prove
// is safe, stops the release before a single migration is applied, and says
// exactly which file and which statement is in the way. Nothing here mutates
// anything: it reads SQL and JSON and returns a decision.
import { createHash } from "node:crypto";
import path from "node:path";
import { ReleaseRefusal } from "./release-config.mjs";

/** Where a release reads the two records an owner edits in a reviewed pull request. */
export const RELEASE_DIRECTORY = "apps/api/release";
export const DATABASE_AUTHORIZATIONS_PATH = `${RELEASE_DIRECTORY}/database-authorizations.json`;
export const CONTENT_RELEASES_PATH = `${RELEASE_DIRECTORY}/content-releases.json`;

/**
 * Removes SQL comments without touching string or quoted-identifier contents,
 * so `--` inside a literal never eats the rest of a statement and a trigger body
 * is read as one statement.
 *
 * @param {string} sql
 */
export function stripSqlComments(sql) {
  let text = "";
  let index = 0;
  while (index < sql.length) {
    const character = sql[index];
    const next = sql[index + 1];
    if (character === "'" || character === '"' || character === "`") {
      const quote = character;
      text += character;
      index += 1;
      while (index < sql.length) {
        const inner = sql[index];
        text += inner;
        index += 1;
        if (inner === quote) {
          if (sql[index] === quote) {
            text += sql[index];
            index += 1;
            continue;
          }
          break;
        }
      }
      continue;
    }
    if (character === "-" && next === "-") {
      while (index < sql.length && sql[index] !== "\n") index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      index += 2;
      while (
        index < sql.length &&
        !(sql[index] === "*" && sql[index + 1] === "/")
      ) {
        index += 1;
      }
      index += 2;
      continue;
    }
    text += character;
    index += 1;
  }
  return text;
}

/**
 * Splits SQL into statements, keeping a `CREATE TRIGGER` together with its
 * `BEGIN ... END` body. Without that, a trigger's own `BEFORE UPDATE` guard
 * would be read as a data-mutating statement and block its own migration.
 * `BEGIN` and `END` count only as whole words, and only inside a statement that
 * is itself a `CREATE TRIGGER`, so an identifier such as `x_begin` can never
 * swallow the statements after it.
 *
 * @param {string} sql
 * @returns {string[]}
 */
export function splitStatements(sql) {
  const text = stripSqlComments(sql);
  const statements = [];
  let start = 0;
  let index = 0;
  let depth = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === "'" || character === '"' || character === "`") {
      index = skipQuoted(text, index);
      continue;
    }
    const word = /^[A-Za-z0-9_$]+/.exec(text.slice(index))?.[0];
    if (word) {
      const keyword = word.toUpperCase();
      if (
        (keyword === "BEGIN" || keyword === "END") &&
        TRIGGER.test(text.slice(start, index).trim())
      ) {
        depth += keyword === "BEGIN" ? 1 : -1;
      }
      index += word.length;
      continue;
    }
    if (character === ";" && depth <= 0) {
      const statement = text.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
      index += 1;
      depth = 0;
      continue;
    }
    index += 1;
  }
  const last = text.slice(start).trim();
  if (last) statements.push(last);
  return statements;
}

/**
 * @param {string} text
 * @param {number} index the opening quote
 * @returns {number} the index just past the closing quote
 */
function skipQuoted(text, index) {
  const quote = text[index];
  let cursor = index + 1;
  while (cursor < text.length) {
    if (text[cursor] === quote) {
      if (text[cursor + 1] === quote) {
        cursor += 2;
        continue;
      }
      break;
    }
    cursor += 1;
  }
  return cursor + 1;
}

const TRIGGER = /^CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i;

/** The only trigger body a release applies on its own: a guard that aborts a write. */
const GUARD =
  /^SELECT\s+RAISE\s*\(\s*(?:ABORT|FAIL|ROLLBACK)\s*,\s*'(?:[^']|'')*'\s*\)$/i;

/**
 * A trigger is additive only when its body does nothing but refuse a write. A
 * trigger that deletes, updates or inserts rewrites data on every later write,
 * and a Worker rollback does not undo it.
 *
 * @param {string} statement a whole `CREATE TRIGGER` statement
 */
function isGuardTrigger(statement) {
  let index = 0;
  let body = null;
  while (index < statement.length) {
    const character = statement[index];
    if (character === "'" || character === '"' || character === "`") {
      index = skipQuoted(statement, index);
      continue;
    }
    const word = /^[A-Za-z0-9_$]+/.exec(statement.slice(index))?.[0];
    if (word) {
      index += word.length;
      if (word.toUpperCase() === "BEGIN") {
        body = statement.slice(index);
        break;
      }
      continue;
    }
    index += 1;
  }
  const end = body === null ? null : /^([\s\S]*)\bEND$/i.exec(body.trim());
  if (!end) return false;
  const guards = splitStatements(end[1]);
  return guards.length > 0 && guards.every((guard) => GUARD.test(guard));
}

/** Statements a release applies on merge: additive DDL and nothing else. */
const ADDITIVE = [
  /^CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE\b/i,
  /^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i,
  /^CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?VIEW\b/i,
  /^PRAGMA\s+(?:foreign_keys|foreign_key_check|defer_foreign_keys)\b/i,
];

/**
 * Classifies one statement. The decision is about what the statement does to
 * data the deployed app can already see, not about SQL that merely looks
 * dangerous: a `CREATE TABLE` full of `ON DELETE CASCADE` is additive, and a
 * `BEFORE DELETE` trigger body inside `CREATE TRIGGER` never reaches here.
 *
 * @param {string} statement
 * @returns {{ safe: boolean, reason: string | null }}
 */
export function classifyStatement(statement) {
  const text = statement.trim();
  if (TRIGGER.test(text)) {
    return isGuardTrigger(text)
      ? { safe: true, reason: null }
      : {
          safe: false,
          reason:
            "a trigger whose body does more than SELECT RAISE(...) changes data on later writes",
        };
  }
  if (ADDITIVE.some((pattern) => pattern.test(text))) {
    return { safe: true, reason: null };
  }
  const alter =
    /^ALTER\s+TABLE\s+\S+\s+ADD\s+(?:COLUMN\s+)?(\S+)([\s\S]*)$/i.exec(text);
  if (alter) {
    const [, column, tail] = alter;
    if (/\bNOT\s+NULL\b/i.test(tail) && !/\bDEFAULT\b/i.test(tail)) {
      return {
        safe: false,
        reason: `adding NOT NULL column ${column} with no DEFAULT rejects every write the deployed code makes`,
      };
    }
    if (/\bREFERENCES\b/i.test(tail)) {
      return {
        safe: false,
        reason: `adding column ${column} with a foreign key changes what the deployed code's writes are allowed to mean`,
      };
    }
    return { safe: true, reason: null };
  }
  if (/^ALTER\s+TABLE\b/i.test(text)) {
    return {
      safe: false,
      reason:
        "only ALTER TABLE ... ADD [COLUMN] is a release-safe change; a rename or a dropped column is not",
    };
  }
  const keyword = /^\s*([A-Za-z]+)/.exec(text)?.[1]?.toUpperCase();
  if (keyword === "DROP") {
    return {
      safe: false,
      reason: "DROP removes a schema object the deployed code may still use",
    };
  }
  if (["DELETE", "UPDATE", "INSERT", "REPLACE"].includes(keyword ?? "")) {
    return {
      safe: false,
      reason: `${keyword} rewrites or removes data the deployed code is already serving`,
    };
  }
  if (keyword === "VACUUM" || keyword === "ATTACH" || keyword === "DETACH") {
    return { safe: false, reason: `${keyword} is not a schema addition` };
  }
  return {
    safe: false,
    reason: `unrecognised statement beginning "${text.slice(0, 60).replace(/\s+/g, " ")}"; a release proves a change is safe or waits`,
  };
}

/**
 * @param {{ name: string, sql: string }} migration
 * @returns {{ name: string, safe: boolean, reasons: string[], statements: number, sha256: string }}
 */
export function classifyMigration({ name, sql }) {
  const statements = splitStatements(sql);
  const reasons = [];
  for (const statement of statements) {
    const { safe, reason } = classifyStatement(statement);
    if (!safe && reason) reasons.push(reason);
  }
  return {
    name,
    safe: reasons.length === 0,
    reasons,
    statements: statements.length,
    sha256: sha256(sql),
  };
}

/** @param {string | Buffer } value */
export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * The migrations a release would apply: composed order, minus what the target
 * database already records. An applied migration the repository no longer has
 * is refused, because a release cannot reason about a database whose history it
 * cannot see.
 *
 * @param {{ composed: string[], applied: string[] }} input
 * @returns {string[]}
 */
export function pendingMigrations({ composed, applied }) {
  const known = new Set(composed);
  const missing = applied.filter((name) => !known.has(name));
  if (missing.length > 0) {
    throw new ReleaseRefusal(
      "unknown_applied_migration",
      `the database has applied migrations this repository no longer contains (${missing.join(", ")}); restoring them is a prerequisite for an automatic release`,
    );
  }
  const appliedSet = new Set(applied);
  return composed.filter((name) => !appliedSet.has(name));
}

/**
 * The database release record: an explicit, reviewable authorization for the
 * migrations a release may not apply on its own. Each entry names the exact
 * file and the exact content hash, so editing a migration that was authorized
 * withdraws the authorization.
 *
 * @param {string} source
 */
export function readDatabaseAuthorizations(source) {
  const parsed = parseReleaseJson(source, DATABASE_AUTHORIZATIONS_PATH);
  const migrations = parsed.migrations ?? [];
  if (!Array.isArray(migrations)) {
    throw new ReleaseRefusal(
      "invalid_record",
      `${DATABASE_AUTHORIZATIONS_PATH}: "migrations" must be an array`,
    );
  }
  for (const entry of migrations) {
    const keys = Object.keys(entry ?? {})
      .sort()
      .join(",");
    if (keys !== "authorizedBy,file,note,sha256") {
      throw new ReleaseRefusal(
        "invalid_record",
        `${DATABASE_AUTHORIZATIONS_PATH}: every entry needs exactly file, sha256, authorizedBy and note, found [${keys}]`,
      );
    }
    if (!/^\d{4}[_-][a-z0-9_-]+\.sql$/i.test(entry.file)) {
      throw new ReleaseRefusal(
        "invalid_record",
        `${DATABASE_AUTHORIZATIONS_PATH}: "${entry.file}" is not a migration filename`,
      );
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new ReleaseRefusal(
        "invalid_record",
        `${DATABASE_AUTHORIZATIONS_PATH}: ${entry.file} needs the 64-character sha256 of the file as it is now`,
      );
    }
    if (
      !String(entry.authorizedBy ?? "").trim() ||
      !String(entry.note ?? "").trim()
    ) {
      throw new ReleaseRefusal(
        "invalid_record",
        `${DATABASE_AUTHORIZATIONS_PATH}: ${entry.file} must name who authorized it and why`,
      );
    }
  }
  return migrations;
}

/**
 * The course release record: the exact course, version and content hash a
 * reviewed pull request authorizes for publication, and the pack it names. There
 * is no wildcard and no "publish every pack" sweep, because a publication is
 * irreversible for that version.
 *
 * @param {string} source
 * @param {string} [contentDirectory]
 */
export function readContentReleases(source, contentDirectory) {
  const parsed = parseReleaseJson(source, CONTENT_RELEASES_PATH);
  const releases = parsed.releases;
  if (!Array.isArray(releases)) {
    throw new ReleaseRefusal(
      "invalid_record",
      `${CONTENT_RELEASES_PATH}: "releases" must be an array`,
    );
  }
  const seen = new Set();
  return releases.map((entry) => {
    const keys = Object.keys(entry ?? {})
      .sort()
      .join(",");
    if (keys !== "course,hash,pack,version") {
      throw new ReleaseRefusal(
        "invalid_record",
        `${CONTENT_RELEASES_PATH}: every entry needs exactly course, version, hash and pack, found [${keys}]`,
      );
    }
    const course = String(entry.course);
    const version = Number(entry.version);
    const hash = String(entry.hash);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(course)) {
      throw new ReleaseRefusal(
        "invalid_record",
        `${CONTENT_RELEASES_PATH}: "${course}" is not a course id; a wildcard or pattern is never published`,
      );
    }
    if (!Number.isInteger(version) || version < 1) {
      throw new ReleaseRefusal(
        "invalid_record",
        `${CONTENT_RELEASES_PATH}: ${course} needs a positive integer version`,
      );
    }
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      throw new ReleaseRefusal(
        "invalid_record",
        `${CONTENT_RELEASES_PATH}: ${course} v${version} needs the pack's 64-character sha256`,
      );
    }
    const pack = String(entry.pack ?? "");
    if (
      !pack.endsWith(".json") ||
      path.isAbsolute(pack) ||
      pack.includes("*")
    ) {
      throw new ReleaseRefusal(
        "invalid_record",
        `${CONTENT_RELEASES_PATH}: ${course} v${version} names no single pack file (${pack || "empty"}); a sweep is never published`,
      );
    }
    const key = `${course}@${version}`;
    if (seen.has(key)) {
      throw new ReleaseRefusal(
        "invalid_record",
        `${CONTENT_RELEASES_PATH}: ${key} is listed twice`,
      );
    }
    seen.add(key);
    return { courseId: course, version, contentHash: hash, pack };
  });
}

/**
 * @param {string} source
 * @param {string} file
 */
function parseReleaseJson(source, file) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new ReleaseRefusal(
      "invalid_record",
      `${file} is not valid JSON: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ReleaseRefusal("invalid_record", `${file} must be an object`);
  }
  const unknown = Object.keys(parsed).filter(
    (key) => !["comment", "migrations", "releases"].includes(key),
  );
  if (unknown.length > 0) {
    throw new ReleaseRefusal(
      "invalid_record",
      `${file}: unknown field(s) ${unknown.join(", ")}; a release record states only what it authorizes`,
    );
  }
  return parsed;
}

/**
 * The migration half of a release plan: the pending migrations in order, each
 * marked as applying itself or as needing the exact authorization, and every
 * reason a blocked migration is blocked. A release with a blocked migration
 * applies nothing at all, so a partly applied change is not a state production
 * can be left in.
 *
 * @param {{ pending: string[], sqlByName: Record<string, string>, authorizations: ReturnType<typeof readDatabaseAuthorizations> }} input
 */
export function planMigrations({ pending, sqlByName, authorizations }) {
  const authorized = new Map(
    authorizations.map((entry) => [entry.file, entry]),
  );
  const planned = pending.map((name) => {
    const classified = classifyMigration({
      name,
      sql: String(sqlByName[name] ?? ""),
    });
    const record = authorized.get(name);
    const matchesAuthorization =
      record !== undefined && record.sha256 === classified.sha256;
    return {
      ...classified,
      authorizedBy: matchesAuthorization ? record.authorizedBy : null,
      apply: classified.safe || matchesAuthorization,
    };
  });
  return {
    planned,
    blocked: planned.filter((migration) => !migration.apply),
  };
}

/** The public read-back a release performs after deploying, from a plain client. */
export const PRODUCTION_PROBES = [
  { path: "/health", status: 200, kind: "json" },
  { path: "/", status: 200, kind: "html" },
  { path: "/manifest.webmanifest", status: 200, kind: "json" },
  // The API's own JSON 404, never the app shell's fallback.
  { path: "/api/nope", status: 404, kind: "json" },
];

/**
 * Reads the deployed origin back with an unauthenticated client, the same probes
 * the owner's manual post-deploy checklist uses. It retries briefly, because a
 * new Worker version takes a moment to answer everywhere, and it fails on the
 * first probe that does not answer exactly as the deployment promises.
 *
 * @param {{ origin: string, fetchImpl?: typeof fetch, attempts?: number, wait?: (ms: number) => Promise<void>, log?: (line: string) => void }} input
 * @returns {Promise<{ path: string, status: number }[]>}
 */
export async function probeProduction({
  origin,
  fetchImpl = fetch,
  attempts = 10,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = () => {},
}) {
  const results = [];
  for (const probe of PRODUCTION_PROBES) {
    let last = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetchImpl(`${origin}${probe.path}`, {
          headers: { "User-Agent": "ownwords-release-readback" },
        });
        const type = response.headers.get("content-type") ?? "";
        const matches =
          response.status === probe.status &&
          (probe.kind === "json"
            ? type.includes("json")
            : type.includes("text/html"));
        if (matches) {
          last = { path: probe.path, status: response.status, ok: true };
          break;
        }
        last = { path: probe.path, status: response.status, ok: false, type };
      } catch (error) {
        last = {
          path: probe.path,
          status: 0,
          ok: false,
          type: error instanceof Error ? error.message : "unreachable",
        };
      }
      if (attempt < attempts) await wait(3000);
    }
    if (!last?.ok) {
      throw new ReleaseRefusal(
        "read_back_failed",
        `${origin}${probe.path} answered ${last?.status ?? "nothing"} (${last?.type ?? "no response"}), expected ${probe.status} ${probe.kind}; the deployment is not serving what it should`,
      );
    }
    log(`read-back ok  ${probe.path} ${last.status}`);
    results.push({ path: probe.path, status: last.status });
  }
  return results;
}
