import { passkey } from "@better-auth/passkey";
import { betterAuth, type ValidateUserInfoSource } from "better-auth";
import { loadRuntimeConfig } from "./config.js";
import {
  consumeSignupAuthorization,
  findSignupAuthorization,
  isAuthorizedUser,
  normalizeEmail,
  signupCookieName,
  type SignupAuthorization,
} from "./invitations.js";
import type { Bindings } from "./types.js";

export async function authorizeRegistration(
  env: Bindings,
  source: ValidateUserInfoSource,
  email: string | undefined,
  token: string | null,
  now = Date.now(),
): Promise<SignupAuthorization | null | undefined> {
  if (source.action !== "create-user") return undefined;
  if (!email) return null;
  return findSignupAuthorization(env.DB, token, normalizeEmail(email), now);
}

export function createAuth(env: Bindings, now: () => number = Date.now) {
  return buildAuth(env, now, true);
}

// Only a completed schema verdict is retained, never an adapter, session,
// request-bound D1 handle or pending I/O. A different binding starts cold.
// D1 disallows PRAGMA schema_version. Instead, one read of all schema
// definitions detects DDL (including indexes) without table-info introspection.
const validatedSchemas = new WeakMap<D1Database, string>();

async function schemaFingerprint(db: D1Database): Promise<string> {
  const rows = await db
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name",
    )
    .all<{
      type: string;
      name: string;
      tbl_name: string;
      sql: string | null;
    }>();
  if (!rows.success || !Array.isArray(rows.results)) {
    throw new Error("The authentication schema could not be checked");
  }
  return JSON.stringify(rows.results);
}

/** A fresh, request-owned auth instance, with DDL-guarded schema checks. */
export async function createRequestAuth(
  env: Bindings,
  now: () => number = Date.now,
): Promise<OwnwordsAuth> {
  // Configuration is read on every request, including a warm schema verdict.
  loadRuntimeConfig(env);
  const fingerprint = await schemaFingerprint(env.DB);
  if (
    validatedSchemas.has(env.DB) &&
    validatedSchemas.get(env.DB) === fingerprint
  ) {
    return buildAuth(env, now, false);
  }
  validatedSchemas.delete(env.DB);
  const auth = buildAuth(env, now, true);
  const context = await auth.$context;
  if (!context.checkSchema) {
    throw new Error("The pinned authentication adapter has no schema check");
  }
  await context.checkSchema();
  // Do not publish a verdict if DDL raced the introspection.
  if ((await schemaFingerprint(env.DB)) !== fingerprint) {
    throw new Error("The authentication schema changed during validation");
  }
  validatedSchemas.set(env.DB, fingerprint);
  return auth;
}

function buildAuth(env: Bindings, now: () => number, validateSchema: boolean) {
  const config = loadRuntimeConfig(env);
  const socialProviders = config.google
    ? {
        google: {
          clientId: config.google.clientId,
          clientSecret: config.google.clientSecret,
          requireEmailVerification: true,
        },
      }
    : {};

  return betterAuth({
    appName: "Ownwords",
    baseURL: config.authUrl,
    basePath: "/api/auth",
    secret: config.authSecret,
    database: env.DB,
    trustedOrigins: config.trustedOrigins,
    emailAndPassword: { enabled: false },
    socialProviders,
    account: {
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/social": { window: 60, max: 10 },
        "/passkey/verify-authentication": { window: 60, max: 20 },
      },
    },
    advanced: {
      database: { validateSchema },
      cookiePrefix: "ownwords",
      useSecureCookies: config.environment === "production",
      disableCSRFCheck: false,
      disableOriginCheck: false,
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    },
    user: {
      deleteUser: { enabled: false },
      validateUserInfo: async ({ user, source }, context) => {
        const authorization = await authorizeRegistration(
          env,
          source,
          user.email,
          context.getCookie(signupCookieName(env)),
          now(),
        );
        if (authorization === null) {
          return {
            error: "invitation_required",
            errorDescription:
              "A valid invitation is required to create an account",
          };
        }
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user, context) => {
            const token = context?.getCookie(signupCookieName(env)) ?? null;
            const timestamp = now();
            const authorization = await findSignupAuthorization(
              env.DB,
              token,
              user.email,
              timestamp,
            );
            if (!authorization) {
              throw new Error(
                "A valid signup authorization was not available after account creation",
              );
            }
            await consumeSignupAuthorization(
              env.DB,
              authorization,
              user.id,
              timestamp,
            );
            context?.setCookie(signupCookieName(env), "", {
              httpOnly: true,
              secure: config.environment === "production",
              sameSite: "lax",
              path: "/",
              maxAge: 0,
            });
          },
        },
      },
      session: {
        create: {
          before: async (session) => isAuthorizedUser(env.DB, session.userId),
        },
      },
    },
    plugins: [
      passkey({
        rpID: config.passkeyRpId,
        rpName: "Ownwords",
        origin: config.passkeyOrigin,
        registration: {
          // Passkeys can only be added after the invitation-gated Google flow
          // has established an authenticated account. Do not rely on the
          // plugin default for this security boundary.
          requireSession: true,
        },
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "required",
        },
      }),
    ],
  });
}

export type OwnwordsAuth = ReturnType<typeof buildAuth>;
