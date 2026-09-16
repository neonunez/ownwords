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

export type OwnwordsAuth = ReturnType<typeof createAuth>;
