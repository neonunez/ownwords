import type { Bindings } from "./types.js";

export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError";
}

export interface RuntimeConfig {
  environment: "local" | "test" | "production";
  authSecret: string;
  authUrl: string;
  trustedOrigins: string[];
  passkeyRpId: string;
  passkeyOrigin: string;
  google: { clientId: string; clientSecret: string } | undefined;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseOrigin(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError(`${label} must be an absolute origin`);
  }

  if (url.origin !== value || url.username || url.password) {
    throw new ConfigurationError(
      `${label} must not include a path or credentials`,
    );
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))
  ) {
    throw new ConfigurationError(`${label} must use HTTPS except on localhost`);
  }
  return url;
}

export function readTrustedOrigins(env: Bindings): string[] {
  const raw = env.TRUSTED_ORIGINS ?? "";
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0 || values.length > 8 || values.includes("*")) {
    throw new ConfigurationError(
      "TRUSTED_ORIGINS must contain 1-8 explicit origins",
    );
  }
  return [
    ...new Set(
      values.map((value) => parseOrigin(value, "TRUSTED_ORIGINS").origin),
    ),
  ];
}

export function loadRuntimeConfig(env: Bindings): RuntimeConfig {
  const environment = env.ENVIRONMENT;
  if (
    environment !== "local" &&
    environment !== "test" &&
    environment !== "production"
  ) {
    throw new ConfigurationError(
      "ENVIRONMENT must be local, test, or production",
    );
  }

  const authSecret = env.BETTER_AUTH_SECRET ?? "";
  if (authSecret.length < 32 || authSecret.startsWith("replace-")) {
    throw new ConfigurationError(
      "BETTER_AUTH_SECRET must be a generated value of at least 32 characters",
    );
  }

  const authUrl = parseOrigin(env.BETTER_AUTH_URL ?? "", "BETTER_AUTH_URL");
  const trustedOrigins = readTrustedOrigins(env);
  if (!trustedOrigins.includes(authUrl.origin)) {
    throw new ConfigurationError(
      "BETTER_AUTH_URL must be included in TRUSTED_ORIGINS",
    );
  }
  if (environment === "production" && authUrl.protocol !== "https:") {
    throw new ConfigurationError("Production authentication requires HTTPS");
  }
  if (environment !== "production" && !LOCAL_HOSTS.has(authUrl.hostname)) {
    throw new ConfigurationError(
      "Local and test authentication must use a loopback origin",
    );
  }

  const passkeyOrigin = parseOrigin(
    env.PASSKEY_RP_ORIGIN ?? "",
    "PASSKEY_RP_ORIGIN",
  );
  const passkeyRpId = (env.PASSKEY_RP_ID ?? "").toLowerCase();
  if (!/^[a-z0-9.-]{1,253}$/.test(passkeyRpId) || passkeyRpId.includes("..")) {
    throw new ConfigurationError(
      "PASSKEY_RP_ID must be a hostname without scheme or port",
    );
  }
  if (
    passkeyOrigin.hostname !== passkeyRpId &&
    !passkeyOrigin.hostname.endsWith(`.${passkeyRpId}`)
  ) {
    throw new ConfigurationError(
      "PASSKEY_RP_ID must equal or parent PASSKEY_RP_ORIGIN's hostname",
    );
  }
  if (!trustedOrigins.includes(passkeyOrigin.origin)) {
    throw new ConfigurationError(
      "PASSKEY_RP_ORIGIN must be included in TRUSTED_ORIGINS",
    );
  }

  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new ConfigurationError(
      "Google OAuth requires both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET",
    );
  }
  if (environment === "production" && (!clientId || !clientSecret)) {
    throw new ConfigurationError(
      "Production authentication requires Google OAuth credentials",
    );
  }

  return {
    environment,
    authSecret,
    authUrl: authUrl.origin,
    trustedOrigins,
    passkeyRpId,
    passkeyOrigin: passkeyOrigin.origin,
    google: clientId && clientSecret ? { clientId, clientSecret } : undefined,
  };
}
