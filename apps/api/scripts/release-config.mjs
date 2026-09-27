// The production release configuration, generated for CI from the tracked
// template plus the values the owner sets once in GitHub, and the exact target
// proof every release must pass before anything is deployed or published.
//
// The tracked `wrangler.production.jsonc.example` stays the single source of
// the Worker's identity: its name, its origin variables, its asset shape and its
// D1 binding. The environment-specific parts - the real D1 ID and the live
// Custom Domain - are supplied at release time and never committed, so no
// credential and no production-only value is written down in Git.
//
// Everything here is a refusal by design. A release that cannot prove it is
// deploying the intended Worker, the intended hostname and the intended
// database stops before it can mutate anything, so a missing GitHub secret, a
// stale template or a substituted database fails the run rather than shipping.
import {
  apiDirectory,
  PRODUCTION_HOST,
  readProductionTemplate,
} from "./production-hosting.mjs";
import {
  readPublicationTarget,
  PRODUCTION_WORKER_NAME,
} from "./remote-publication.mjs";

/** The generated, gitignored production config a release deploys from. */
export const RELEASE_CONFIG_PATH = `${apiDirectory}/wrangler.production.jsonc`;

/** Every release value the release config is built from. */
export const RELEASE_ENVIRONMENT_KEYS = {
  accountId: "CLOUDFLARE_ACCOUNT_ID",
  apiToken: "CLOUDFLARE_API_TOKEN",
  databaseId: "OWNWORDS_D1_DATABASE_ID",
};

const D1_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ZERO_D1_ID = "00000000-0000-0000-0000-000000000000";
const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const PLACEHOLDER_DATABASE_ID = "replace-with-the-production-d1-id";

/** A refusal is a release that must not proceed; every one is fatal. */
export class ReleaseRefusal extends Error {
  /**
   * @param {string} reason
   * @param {string} message
   */
  constructor(reason, message) {
    super(message);
    this.name = "ReleaseRefusal";
    this.reason = reason;
  }
}

/**
 * The tracked template is the identity every release inherits, so it is checked
 * rather than assumed: no route of its own (the Custom Domain is an explicit
 * release value, not a side effect of deploying), no `workers.dev`, no trigger,
 * no secret, and exactly the one production D1 binding.
 *
 * @param {Record<string, any>} template
 */
export function assertReleaseTemplate(template) {
  if (template.name !== PRODUCTION_WORKER_NAME) {
    throw new ReleaseRefusal(
      "wrong_worker",
      `the production template names Worker ${String(template.name)}; a release may only deploy ${PRODUCTION_WORKER_NAME}`,
    );
  }
  if (template.workers_dev !== false || template.subdomain !== undefined) {
    throw new ReleaseRefusal(
      "workers_dev_enabled",
      "the production template must set workers_dev: false and name no subdomain; a release never publishes a workers.dev hostname",
    );
  }
  if (template.routes !== undefined || template.triggers !== undefined) {
    throw new ReleaseRefusal(
      "template_has_route",
      "the production template must carry no route; the live Custom Domain is supplied as a release value so a tracked file can never detach it",
    );
  }
  if (template.vars?.ENVIRONMENT !== "production") {
    throw new ReleaseRefusal(
      "not_production",
      "the production template must set vars.ENVIRONMENT=production",
    );
  }
  if (template.vars?.BETTER_AUTH_URL !== `https://${PRODUCTION_HOST}`) {
    throw new ReleaseRefusal(
      "wrong_origin",
      `the production template must name https://${PRODUCTION_HOST} as its origin`,
    );
  }
  if (template.secrets !== undefined) {
    throw new ReleaseRefusal(
      "secret_in_config",
      "the production template must not carry a secrets block; Worker secrets are set out of band",
    );
  }
  const tracked = JSON.stringify(template);
  for (const secret of [
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "INVITATION_ADMIN_TOKEN",
    "CONTENT_PUBLISH_TOKEN",
  ]) {
    if (tracked.includes(secret)) {
      throw new ReleaseRefusal(
        "secret_in_config",
        `${secret} must never appear in a Wrangler configuration`,
      );
    }
  }
  const databases = template.d1_databases;
  if (!Array.isArray(databases) || databases.length !== 1) {
    throw new ReleaseRefusal(
      "wrong_binding",
      "the production template must bind exactly one D1 database",
    );
  }
  if (databases[0]?.binding !== "DB") {
    throw new ReleaseRefusal(
      "wrong_binding",
      "the production D1 binding is DB",
    );
  }
  if (databases[0]?.database_name !== "ownwords-production") {
    throw new ReleaseRefusal(
      "wrong_binding",
      "the production database is ownwords-production",
    );
  }
  if (databases[0]?.database_id !== PLACEHOLDER_DATABASE_ID) {
    throw new ReleaseRefusal(
      "template_changed",
      "the production template must keep its placeholder D1 ID; the real one is a release value",
    );
  }
  if (!databases[0]?.migrations_dir) {
    throw new ReleaseRefusal(
      "wrong_binding",
      "the production D1 binding must name its migrations directory",
    );
  }
  return template;
}

/**
 * Reads the release values out of the environment. Every one of them is
 * required, so a release whose GitHub configuration is incomplete fails here -
 * before any request is sent, and with the name of what is missing rather than
 * an empty config that would deploy somewhere unintended.
 *
 * @param {Record<string, string | undefined>} env
 */
export function readReleaseEnvironment(env) {
  const read = (key) => {
    const value = String(env[key] ?? "").trim();
    if (!value) {
      throw new ReleaseRefusal(
        "missing_configuration",
        `${key} is not set; set it as a GitHub Actions secret or repository variable for the release workflow (see docs/RELEASES.md)`,
      );
    }
    return value;
  };

  const databaseId = read(RELEASE_ENVIRONMENT_KEYS.databaseId);
  if (!D1_ID.test(databaseId) || databaseId === ZERO_D1_ID) {
    throw new ReleaseRefusal(
      "placeholder_database",
      `${RELEASE_ENVIRONMENT_KEYS.databaseId} is not the production D1 ID; the local and placeholder databases are never deployed to`,
    );
  }

  const accountId = read(RELEASE_ENVIRONMENT_KEYS.accountId);
  if (!ACCOUNT_ID.test(accountId)) {
    throw new ReleaseRefusal(
      "missing_configuration",
      `${RELEASE_ENVIRONMENT_KEYS.accountId} is not a Cloudflare account ID`,
    );
  }

  return {
    accountId,
    // Read for its presence only: the value is a credential and is never
    // printed, logged or written into a generated config.
    apiToken: read(RELEASE_ENVIRONMENT_KEYS.apiToken),
    databaseId,
  };
}

/**
 * The production config a release deploys from: the tracked template's identity
 * with the real database ID and the one live Custom Domain route.
 *
 * @param {{ template: Record<string, any>, databaseId: string }} input
 */
export function buildReleaseConfig({ template, databaseId }) {
  assertReleaseTemplate(template);
  if (!D1_ID.test(databaseId) || databaseId === ZERO_D1_ID) {
    throw new ReleaseRefusal(
      "placeholder_database",
      `database_id is not a real production D1 ID (${databaseId || "empty"})`,
    );
  }
  const config = {
    ...structuredClone(template),
    workers_dev: false,
    routes: [{ pattern: PRODUCTION_HOST, custom_domain: true }],
    d1_databases: template.d1_databases.map((database) => ({
      ...database,
      database_id: databaseId,
    })),
  };
  return config;
}

/**
 * Serialises the generated config as the JSONC dialect Wrangler reads, with no
 * secret anywhere in it: the document is the template's own values plus the
 * database ID and the hostname.
 *
 * @param {Record<string, any>} config
 */
export function serialiseReleaseConfig(config) {
  const text = JSON.stringify(config, null, 2);
  for (const secret of [
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "INVITATION_ADMIN_TOKEN",
    "CONTENT_PUBLISH_TOKEN",
    "CLOUDFLARE_API_TOKEN",
  ]) {
    if (text.includes(secret)) {
      throw new ReleaseRefusal(
        "secret_in_config",
        `the generated config would contain ${secret}`,
      );
    }
  }
  return `${text}\n`;
}

/**
 * Generates the config, writes it to the gitignored production path, and then
 * re-reads it through the publisher's own target guards. Those guards are the
 * ones the content route already trusts, so a release config and a publication
 * target can never drift apart.
 *
 * @param {{ env: Record<string, string | undefined>, write: (path: string, text: string) => Promise<void>, configPath?: string }} input
 */
export async function prepareReleaseConfig({
  env,
  write,
  configPath = RELEASE_CONFIG_PATH,
}) {
  const release = readReleaseEnvironment(env);
  const template = assertReleaseTemplate(await readProductionTemplate());
  const config = buildReleaseConfig({
    template,
    databaseId: release.databaseId,
  });
  const text = serialiseReleaseConfig(config);
  await write(configPath, text);

  // The proof is read back from what was written, not from what was intended.
  const target = readPublicationTarget(configPath);
  return {
    config,
    configPath,
    target,
    host: PRODUCTION_HOST,
  };
}
