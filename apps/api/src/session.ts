import { createMiddleware } from "hono/factory";
import { createAuth } from "./auth.js";
import { errorResponse } from "./errors.js";
import { isAuthorizedUser } from "./invitations.js";
import type { AppEnv, Bindings, VerifiedSession } from "./types.js";

export async function verifyBetterAuthSession(
  headers: Headers,
  env: Bindings,
): Promise<VerifiedSession | null> {
  const result = await createAuth(env).api.getSession({ headers });
  if (!result) return null;
  if (!(await isAuthorizedUser(env.DB, result.user.id))) return null;
  return {
    userId: result.user.id,
    expiresAt: new Date(result.session.expiresAt),
  };
}

export function createSessionMiddleware(now: () => number = Date.now) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = await verifyBetterAuthSession(c.req.raw.headers, c.env);
    if (!session || session.expiresAt.getTime() <= now()) {
      return errorResponse(401, "unauthorized", "A valid session is required");
    }

    c.set("userId", session.userId);
    await next();
  });
}
