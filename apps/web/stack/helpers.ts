import { readFileSync } from "node:fs";
import path from "node:path";
import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { ORIGIN, STATE, type USERS } from "./env.mjs";

export type Account = keyof typeof USERS;

interface Sessions {
  cookieName: string;
  cookies: Record<Account, string>;
}

function sessions(): Sessions {
  return JSON.parse(
    readFileSync(path.join(STATE, "sessions.json"), "utf8"),
  ) as Sessions;
}

/** Signs the browser in as a seeded synthetic account: its real session cookie. */
export async function signIn(
  context: BrowserContext,
  account: Account,
): Promise<void> {
  const { cookieName, cookies } = sessions();
  await context.addCookies([
    {
      name: cookieName,
      value: cookies[account],
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

/**
 * Calls the API as an account, through the app's origin, the way the app does.
 * Used to arrange a journey's starting point, never to check its outcome.
 */
export async function api(
  request: APIRequestContext,
  account: Account,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<unknown> {
  const { cookieName, cookies } = sessions();
  const response = await request.fetch(`${ORIGIN}${pathname}`, {
    method,
    headers: {
      Cookie: `${cookieName}=${cookies[account]}`,
      Origin: ORIGIN,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { data: JSON.stringify(body) }),
  });
  if (!response.ok()) {
    throw new Error(
      `${method} ${pathname} returned ${response.status()}: ${await response.text()}`,
    );
  }
  const text = await response.text();
  return text ? (JSON.parse(text) as unknown) : null;
}

/** Finishes the first run through the API: English native, Spanish B2, learning Russian. */
export async function onboard(
  request: APIRequestContext,
  account: Account,
  learn = true,
): Promise<void> {
  await api(request, account, "PUT", "/api/v1/onboarding", {
    languages: [
      { tag: "en", kind: "maintain", level: "native" },
      { tag: "es", kind: "maintain", level: "b2" },
      ...(learn ? [{ tag: "ru", kind: "learn", level: "a0" }] : []),
    ],
    preferences: {
      explanationLanguage: "en",
      russianCourseAudio: true,
      translationSuggestions: true,
    },
  });
}
