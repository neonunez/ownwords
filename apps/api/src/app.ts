import {
  createLearningRoutes,
  type LexiconCourseImporterFactory,
} from "@ownwords/learning";
import {
  createCourseLexiconImporter,
  createLexiconRoutes,
} from "@ownwords/lexicon";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createAccountRoutes } from "./account.js";
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
import type { AppEnv } from "./types.js";

export interface AppDependencies {
  now?: () => number;
  /** Overrides the course-to-Lexicon importer; tests use it to inject failures. */
  lexiconImporter?: LexiconCourseImporterFactory;
}

/** Upper bound for any domain request body; packages enforce tighter field limits. */
const DOMAIN_BODY_LIMIT_BYTES = 256 * 1024;

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

  const requireSession = createSessionMiddleware(now);
  app.use("/api/v1/profile", requireSession);
  app.use("/api/v1/onboarding", requireSession);
  app.route("/api/v1", createOnboardingRoutes(now));

  // Domain packages trust only the userId set here by verified Better Auth
  // sessions; nothing in a request body, query, or header can select an owner.
  const clock = { now: () => new Date(now()) };
  const limitBody = bodyLimit({
    maxSize: DOMAIN_BODY_LIMIT_BYTES,
    onError: () =>
      errorResponse(413, "request_too_large", "The request body is too large"),
  });
  // Hono's "/prefix/*" also matches the bare prefix.
  for (const prefix of [
    "/api/v1/account",
    "/api/v1/lexicon",
    "/api/v1/learning",
  ]) {
    app.use(`${prefix}/*`, requireSession, limitBody);
  }
  app.route("/api/v1/account", createAccountRoutes(now));
  app.route("/api/v1/lexicon", createLexiconRoutes({ clock }));
  app.route(
    "/api/v1/learning",
    createLearningRoutes({
      lexiconImporter:
        dependencies.lexiconImporter ??
        ((bindings) => createCourseLexiconImporter({ db: bindings.DB, clock })),
      clock: clock.now,
    }),
  );

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
