import { Hono } from "hono";
import { createAuth } from "./auth.js";
import { ConfigurationError } from "./config.js";
import { errorResponse } from "./errors.js";
import {
  createInvitationAdminRoutes,
  createInvitationRoutes,
} from "./invitations.js";
import { createOnboardingRoutes } from "./onboarding.js";
import { apiCors, privateNoStore, requireTrustedOrigin } from "./security.js";
import { createSessionMiddleware } from "./session.js";
import type { AppEnv, SessionVerifier } from "./types.js";

export interface AppDependencies {
  sessionVerifier?: SessionVerifier;
  now?: () => number;
}

export function createApp(dependencies: AppDependencies = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const now = dependencies.now ?? Date.now;

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.use("/api/*", privateNoStore);
  app.use("/api/*", apiCors);
  app.use("/api/*", requireTrustedOrigin);

  app.route("/api/v1/invitations", createInvitationRoutes(now));
  app.route("/api/v1/admin/invitations", createInvitationAdminRoutes(now));

  app.all("/api/auth/*", (c) => createAuth(c.env, now).handler(c.req.raw));

  const requireSession = createSessionMiddleware(
    dependencies.sessionVerifier,
    now,
  );
  app.use("/api/v1/profile", requireSession);
  app.use("/api/v1/onboarding", requireSession);
  app.route("/api/v1", createOnboardingRoutes(now));

  app.notFound(() =>
    errorResponse(404, "not_found", "The requested resource was not found"),
  );
  app.onError((error) => {
    if (error instanceof ConfigurationError) {
      return errorResponse(
        500,
        "configuration_error",
        "The service is not configured correctly",
      );
    }
    return errorResponse(500, "internal_error", "An unexpected error occurred");
  });

  return app;
}
