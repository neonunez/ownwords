import { createMiddleware } from "hono/factory";
import { createAuth } from "./auth.js";
import { errorResponse } from "./errors.js";
import { isAuthorizedUser } from "./invitations.js";
import type { AppEnv, SessionVerifier, VerifiedSession } from "./types.js";

export const verifyBetterAuthSession: SessionVerifier = async (
  headers,
  env,
) => {
  const result = await createAuth(env).api.getSession({ headers });
  if (!result) return null;
  if (!(await isAuthorizedUser(env.DB, result.user.id))) return null;
  return {
    userId: result.user.id,
    expiresAt: new Date(result.session.expiresAt),
  };
};

export function createSessionMiddleware(
  verifier: SessionVerifier = verifyBetterAuthSession,
  now: () => number = Date.now,
) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = await verifier(c.req.raw.headers, c.env);
    if (!session || session.expiresAt.getTime() <= now()) {
      return errorResponse(401, "unauthorized", "A valid session is required");
    }

    c.set("userId", session.userId);
    c.set("session", session satisfies VerifiedSession);
    await next();
  });
}
