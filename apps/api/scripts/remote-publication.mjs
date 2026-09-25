// The guards and the request plan for the remote course publisher, kept
// separate from the process that runs them so both can be tested without a
// network, a credential or a Cloudflare account.
//
// Nothing here talks to Cloudflare. The publisher reaches the production
// database only through the deployed API's guarded operator route, so this
// module's whole job is to refuse anything that is not the exact intended
// production target, and to plan read-only requests unless the operator
// confirms the write.
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  apiDirectory,
  parseJsonc,
  PRODUCTION_HOST,
} from "./production-hosting.mjs";

/** The one database this publisher is allowed to name. */
export const PRODUCTION_DATABASE_NAME = "ownwords-production";
export const PRODUCTION_WORKER_NAME = "ownwords-api";
export const PRODUCTION_BINDING = "DB";
const D1_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ZERO_D1_ID = "00000000-0000-0000-0000-000000000000";

/** Every refusal is an error the operator must read before anything is sent. */
export class PublicationRefusal extends Error {
  /**
   * @param {string} reason
   * @param {string} message
   */
  constructor(reason, message) {
    super(message);
    this.name = "PublicationRefusal";
    this.reason = reason;
  }
}

/**
 * @typedef {object} PublicationTarget
 * @property {string} configPath
 * @property {string} origin
 * @property {string} workerName
 * @property {string} databaseName
 * @property {string} databaseId
 */

/** @typedef {{ courseId: string, version: number, contentHash: string }} PublicationExpectation */

/**
 * @typedef {object} PublicationPlan
 * @property {PublicationTarget} target
 * @property {string} token
 * @property {unknown} pack
 * @property {PublicationExpectation} expect
 * @property {{ teacherReviewed: boolean, note: string }} editorial
 * @property {boolean} confirm
 */

/**
 * Reads a copied production Wrangler config and refuses anything that is not
 * the deployed production API on the approved origin bound to the real
 * production database. The tracked local config, the tracked template, a
 * placeholder ID, a local environment and an HTTP origin all stop here.
 */
/**
 * @param {string} configPath
 * @returns {PublicationTarget}
 */
export function readPublicationTarget(configPath) {
  const resolved = path.resolve(configPath);
  const name = path.basename(resolved);
  if (
    name === "wrangler.jsonc" ||
    resolved === path.join(apiDirectory, "wrangler.jsonc")
  ) {
    throw new PublicationRefusal(
      "local_config",
      `${resolved} is the local development config; publication needs a copy of wrangler.production.jsonc.example as apps/api/wrangler.production.jsonc`,
    );
  }
  if (name.endsWith(".example") || name.endsWith(".example.jsonc")) {
    throw new PublicationRefusal(
      "template_config",
      `${resolved} is the tracked template with a placeholder D1 ID; copy it to apps/api/wrangler.production.jsonc and put the D1 ID returned by wrangler d1 create in database_id`,
    );
  }

  let config;
  try {
    config = parseJsonc(readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new PublicationRefusal(
      "unreadable_config",
      `Could not read ${resolved}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const vars = config?.vars ?? {};
  if (vars.ENVIRONMENT !== "production") {
    throw new PublicationRefusal(
      "not_production",
      `${resolved} has ENVIRONMENT=${String(vars.ENVIRONMENT)}; only a production config may be published to`,
    );
  }
  if (config?.name !== PRODUCTION_WORKER_NAME) {
    throw new PublicationRefusal(
      "wrong_worker",
      `${resolved} names Worker ${String(config?.name)}; the intended Worker is ${PRODUCTION_WORKER_NAME}`,
    );
  }

  const origin = String(vars.BETTER_AUTH_URL ?? "");
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new PublicationRefusal(
      "wrong_origin",
      `${resolved} has no absolute BETTER_AUTH_URL; publication needs the deployed https origin`,
    );
  }
  if (url.protocol !== "https:" || url.origin !== origin) {
    throw new PublicationRefusal(
      "wrong_origin",
      `BETTER_AUTH_URL must be one https origin, found ${origin}`,
    );
  }
  if (url.hostname !== PRODUCTION_HOST) {
    throw new PublicationRefusal(
      "wrong_origin",
      `Publication is only for https://${PRODUCTION_HOST}, found ${url.hostname}`,
    );
  }
  if (
    !String(vars.TRUSTED_ORIGINS ?? "")
      .split(",")
      .includes(origin)
  ) {
    throw new PublicationRefusal(
      "wrong_origin",
      `TRUSTED_ORIGINS does not include ${origin}`,
    );
  }

  const databases = config?.d1_databases;
  if (!Array.isArray(databases) || databases.length !== 1) {
    throw new PublicationRefusal(
      "wrong_binding",
      `${resolved} must bind exactly one D1 database`,
    );
  }
  const [database] = databases;
  if (database?.binding !== PRODUCTION_BINDING) {
    throw new PublicationRefusal(
      "wrong_binding",
      `the production D1 binding is ${PRODUCTION_BINDING}, found ${String(database?.binding)}`,
    );
  }
  if (database?.database_name !== PRODUCTION_DATABASE_NAME) {
    throw new PublicationRefusal(
      "wrong_binding",
      `the production database is ${PRODUCTION_DATABASE_NAME}, found ${String(database?.database_name)}`,
    );
  }
  const databaseId = String(database?.database_id ?? "");
  if (!D1_ID.test(databaseId) || databaseId === ZERO_D1_ID) {
    throw new PublicationRefusal(
      "placeholder_database",
      `database_id is not a real production D1 ID (${databaseId || "empty"}); a placeholder or local ID is never published to`,
    );
  }

  return {
    configPath: resolved,
    origin: url.origin,
    workerName: PRODUCTION_WORKER_NAME,
    databaseName: PRODUCTION_DATABASE_NAME,
    databaseId,
  };
}

/** The reviewed artifact must be exactly what the operator expects to publish. */
/**
 * @param {{ courseId: string, version: number, contentHash: string }} observed
 * @param {PublicationExpectation} expected
 */
export function assertExpectation(observed, expected) {
  if (
    observed.courseId !== expected.courseId ||
    observed.version !== expected.version ||
    observed.contentHash !== expected.contentHash
  ) {
    throw new PublicationRefusal(
      "target_mismatch",
      `the pack is ${observed.courseId} v${observed.version} sha256:${observed.contentHash}, not the reviewed ${expected.courseId} v${expected.version} sha256:${expected.contentHash}`,
    );
  }
}

/** @param {Record<string, string | undefined>} env */
export function readPublishToken(env) {
  const token = String(env.CONTENT_PUBLISH_TOKEN ?? "");
  if (!/^[a-f0-9]{64}$/.test(token)) {
    throw new PublicationRefusal(
      "missing_token",
      "set CONTENT_PUBLISH_TOKEN in this terminal to the 64-hex CONTENT_PUBLISH_TOKEN Worker secret; it is never passed as an argument",
    );
  }
  return token;
}

/** @param {PublicationPlan} plan */
export function planPublicationRequests({
  target,
  token,
  pack,
  expect,
  editorial,
  confirm,
}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Origin: target.origin,
  };
  const body = { pack, expect, editorial, dryRun: !confirm };
  // The read-only plan always runs; the write is a second, separate request
  // that only exists once the operator has confirmed this exact run.
  const requests = [
    {
      step: "read existing versions",
      mutates: false,
      method: "GET",
      path: `/api/v1/admin/content/versions?courseId=${encodeURIComponent(expect.courseId)}`,
    },
    {
      step: confirm
        ? "preflight the confirmed publication"
        : "preflight the publication",
      mutates: false,
      method: "POST",
      path: "/api/v1/admin/content/publish",
      body: { ...body, dryRun: true },
    },
  ];
  if (confirm) {
    requests.push({
      step: "publish (irreversible for this version)",
      mutates: true,
      method: "POST",
      path: "/api/v1/admin/content/publish",
      body,
    });
  }
  return requests.map((request) => ({
    ...request,
    url: `${target.origin}${request.path}`,
    headers,
  }));
}
