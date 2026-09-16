import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { errorResponse } from "./errors.js";
import { readTrustedOrigins } from "./config.js";
import type { AppEnv } from "./types.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const apiCors = cors({
  origin: (origin, c) => {
    try {
      return readTrustedOrigins(c.env).includes(origin) ? origin : null;
    } catch {
      return null;
    }
  },
  allowMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type"],
  credentials: true,
  maxAge: 600,
});

export const requireTrustedOrigin: MiddlewareHandler<AppEnv> = async (
  c,
  next,
) => {
  if (SAFE_METHODS.has(c.req.method)) {
    await next();
    return;
  }

  const origin = c.req.header("Origin");
  let allowed: string[];
  try {
    allowed = readTrustedOrigins(c.env);
  } catch {
    return errorResponse(
      500,
      "configuration_error",
      "The service is not configured correctly",
    );
  }
  if (!origin || !allowed.includes(origin)) {
    return errorResponse(
      403,
      "origin_forbidden",
      "The request origin is not allowed",
    );
  }
  await next();
};

export const privateNoStore: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
};
