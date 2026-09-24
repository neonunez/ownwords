/**
 * The HTTP transport under the client: one place that knows the API's
 * address, sends the session cookie, and turns every failure into an
 * `OwnwordsError` a screen can show.
 */

import { OwnwordsError } from "../client";
import { badResponse } from "./read";

/**
 * The API is served from the app's own origin, so the session cookie is
 * first-party and a passkey ceremony runs on the relying party's origin.
 * These are the only two prefixes the app ever spells.
 */
export const API = {
  auth: "/api/auth",
  v1: "/api/v1",
} as const;

export interface TransportOptions {
  /** Defaults to the browser's `fetch`; tests pass their own. */
  fetch?: typeof fetch;
  /** Prepended to every path. Empty: the app's own origin. */
  origin?: string;
}

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal | undefined;
  /**
   * Leave a 401 to the caller instead of announcing that the session ended;
   * the session probe uses it, because "signed out" is its answer there.
   */
  quietWhenSignedOut?: boolean;
}

interface ErrorBody {
  code: string;
  message: string;
}

/** The API wraps errors in `error`; the auth handler answers `{ code, message }` bare. */
function errorBody(value: unknown): ErrorBody | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const inner =
    typeof record.error === "object" && record.error !== null
      ? (record.error as Record<string, unknown>)
      : record;
  const code = inner.code;
  return typeof code === "string"
    ? { code, message: typeof inner.message === "string" ? inner.message : "" }
    : null;
}

/** What a person reads when a request fails. The backend's own wording stays in the logs. */
function writtenFor(status: number, code: string): string {
  switch (code) {
    case "VERSION_CONFLICT":
      return "It was changed somewhere else first. Look at it again, then retry.";
    case "TRANSLATION_PROVIDER_DISABLED":
      return "Suggestions are switched off for now. Type it yourself.";
    case "PREREQUISITES_NOT_MET":
      return "Finish the lessons before this one first.";
    case "COURSE_VERSION_MISMATCH":
      return "The course changed since this screen was opened. Go back to the course and open it again.";
    case "invitation_invalid":
      return "That invitation is not valid for this email address, or it has run out.";
    case "PROVIDER_NOT_FOUND":
      return "Google sign-in is not set up on this server yet.";
    case "origin_forbidden":
      return "This copy of the app is not allowed to reach Ownwords from here.";
  }
  if (status === 401)
    return "You have been signed out. Sign in again to carry on.";
  if (status === 404) return "That is no longer there.";
  if (status === 409)
    return "That could not be done in this order. Go back and try again.";
  if (status === 413) return "That is too long to store.";
  if (status === 429) return "Too many tries. Wait a minute, then try again.";
  if (status >= 500)
    return "Ownwords could not finish that. Nothing was lost; try again.";
  return "That was not accepted. Nothing was changed.";
}

export interface Transport {
  request(
    method: string,
    path: string,
    options?: RequestOptions,
  ): Promise<Response>;
  json(
    method: string,
    path: string,
    options?: RequestOptions,
  ): Promise<unknown>;
  onSignedOut(listener: () => void): () => void;
}

export function createTransport(options: TransportOptions = {}): Transport {
  const origin = options.origin ?? "";
  const listeners = new Set<() => void>();
  const send = options.fetch ?? ((...args) => fetch(...args));

  async function request(
    method: string,
    path: string,
    { body, headers, signal, quietWhenSignedOut }: RequestOptions = {},
  ): Promise<Response> {
    const init: RequestInit = {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    if (signal) init.signal = signal;

    let response: Response;
    try {
      response = await send(`${origin}${path}`, init);
    } catch (cause) {
      if (signal?.aborted) throw cause;
      throw new OwnwordsError(
        "offline",
        "Ownwords could not be reached. Check the connection, then try again.",
      );
    }
    if (response.ok) return response;

    let parsed: ErrorBody | null = null;
    try {
      parsed = errorBody(await response.json());
    } catch {
      // Not JSON: the status alone says what happened.
    }
    const code = parsed?.code ?? `http_${response.status}`;
    if (response.status === 401 && !quietWhenSignedOut) {
      for (const listener of listeners) listener();
    }
    throw new OwnwordsError(
      code,
      writtenFor(response.status, code),
      response.status,
    );
  }

  return {
    request,
    async json(method, path, requestOptions) {
      const response = await request(method, path, requestOptions);
      if (response.status === 204) return null;
      // An address the API does not serve can fall through to the app's own
      // HTML; that is a wrong answer, not an empty one.
      const type = response.headers.get("Content-Type") ?? "";
      if (!type.includes("json")) throw badResponse(path);
      try {
        return (await response.json()) as unknown;
      } catch {
        throw badResponse(path);
      }
    },
    onSignedOut(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
