import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { LearningEnv } from "./contracts";

export class LearningError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LearningError";
  }
}

export function errorResponse(
  c: Context<LearningEnv>,
  error: unknown,
): Response {
  if (error instanceof LearningError) {
    return c.json(
      { error: { code: error.code, message: error.message } },
      error.status,
    );
  }

  console.error("learning route failed", error);
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed",
      },
    },
    500,
  );
}
