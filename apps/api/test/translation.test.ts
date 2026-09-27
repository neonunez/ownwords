import { env } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import {
  OpenCodeTranslationProvider,
  OPENCODE_GO_ENDPOINT,
  OPENCODE_GO_MODEL,
  OPENCODE_GO_USER_AGENT,
  readOpenCodeGoApiKey,
} from "../src/translation.js";
import type { Bindings } from "../src/types.js";
import { personalEntry, signedInUser, type TestUser } from "./e2e.js";
import { TRUSTED_ORIGIN } from "./helpers.js";

/**
 * The OpenCode Go path, exercised end to end through the real app with the
 * provider's network call mocked. No key is read, stored or sent anywhere: the
 * value below is a test fixture, and the production key is the owner's to enter.
 */
const TEST_KEY = "test-only-opencode-key-not-a-real-credential";
const app = createApp();

/**
 * The suggestion cache is keyed per owner, languages and sense, so every test
 * asks for a target language no other test has used. Without this a later test
 * would be answered from an earlier test's cache and never reach the stub.
 */
const SPARE_LANGUAGES = [
  "ru",
  "es",
  "de",
  "fr",
  "it",
  "pt",
  "nl",
  "pl",
  "tr",
  "ar",
  "he",
  "ko",
  "ja",
  "sv",
  "fi",
  "cs",
  "el",
  "uk",
  "hu",
  "ro",
  "da",
  "no",
];
let spare = 0;
function freshLanguage(): string {
  const tag = SPARE_LANGUAGES[spare % SPARE_LANGUAGES.length]!;
  spare += 1;
  return tag;
}

interface StoredEquivalent {
  id: string;
  languageTag: string;
  text?: string;
}

interface StoredEntry {
  id: string;
  senses: Array<{ id: string; equivalents: StoredEquivalent[] }>;
}

let learner: TestUser;
let entry: StoredEntry;
let source: StoredEquivalent;

/** The entry, sense and equivalent ids a suggestion request needs. */
type WireEntry = StoredEntry;

beforeAll(async () => {
  learner = await signedInUser("translation-user");
  const created = await app.request(
    `${TRUSTED_ORIGIN}/api/v1/lexicon/entries`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: TRUSTED_ORIGIN,
        Cookie: learner.cookie,
      },
      body: JSON.stringify(personalEntry),
    },
    env,
  );
  expect(created.status).toBe(201);
  const stored = (await created.json()) as { data: WireEntry };
  entry = stored.data;
  source = entry.senses[0]!.equivalents.find(
    (item) => item.languageTag === "en",
  )!;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function withKey(overrides: Partial<Bindings> = {}): Bindings {
  return { ...env, OPENCODE_GO_API_KEY: TEST_KEY, ...overrides };
}

function suggestionPath(): string {
  return `${TRUSTED_ORIGIN}/api/v1/lexicon/entries/${entry.id}/senses/${entry.senses[0]!.id}/suggestions`;
}

function ask(
  bindings: Bindings,
  targetLanguage = "ru",
  sourceEquivalentId = source.id,
): Promise<Response> {
  return Promise.resolve(
    app.request(
      suggestionPath(),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: TRUSTED_ORIGIN,
          Cookie: learner.cookie,
        },
        body: JSON.stringify({ sourceEquivalentId, targetLanguage }),
      },
      bindings,
    ),
  );
}

/** A Go chat-completions answer, shaped exactly as the endpoint returns one. */
function goResponse(content: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-fixture",
      choices: [{ message: { content } }],
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

interface ProviderCall {
  url: string;
  init: RequestInit;
}

async function stubGo(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
): Promise<{ calls: ProviderCall[] }> {
  const calls: ProviderCall[] = [];
  vi.stubGlobal("fetch", (input: unknown, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return respond(String(input), init);
  });
  return { calls };
}

describe("the absent key is the default, and it calls nothing", () => {
  it("leaves suggestions switched off with no provider request at all", async () => {
    const { calls } = await stubGo(() => goResponse("не должно быть"));
    const response = await ask({ ...env }, freshLanguage());
    expect(calls).toEqual([]);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "TRANSLATION_PROVIDER_DISABLED" },
    });
  });

  it("treats only a missing or blank key as absent", () => {
    for (const value of [undefined, "", "   "]) {
      expect(readOpenCodeGoApiKey({ ...env, OPENCODE_GO_API_KEY: value })).toBe(
        undefined,
      );
    }
    expect(readOpenCodeGoApiKey(withKey())).toBe(TEST_KEY);
  });

  it("accepts any non-blank key without guessing its format", async () => {
    for (const value of ["short", "replace-me-is-still-a-key"]) {
      expect(readOpenCodeGoApiKey({ ...env, OPENCODE_GO_API_KEY: value })).toBe(
        value,
      );
    }
    const { calls } = await stubGo(() => goResponse("до скорого"));
    const response = await ask(
      withKey({ OPENCODE_GO_API_KEY: "short" }),
      freshLanguage(),
    );
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe(
      "Bearer short",
    );
  });
});

describe("the configured provider, called the documented way", () => {
  it("returns one honest candidate through the real suggestions route", async () => {
    const { calls } = await stubGo(() => goResponse("  увидимся  \n"));
    const response = await ask(withKey(), freshLanguage());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ text: "увидимся", fit: "context_only" }],
    });
    // Nothing is stored by a suggestion: it is a review candidate only, so the
    // stored Russian equivalent is still exactly what was typed.
    const stored = await app.request(
      `${TRUSTED_ORIGIN}/api/v1/lexicon/entries/${entry.id}`,
      { headers: { Origin: TRUSTED_ORIGIN, Cookie: learner.cookie } },
      env,
    );
    const read = (await stored.json()) as {
      data: { senses: Array<{ equivalents: Array<Record<string, any>> }> };
    };
    const equivalents = read.data.senses[0]!.equivalents;
    const russian = equivalents.find((item) => item.languageTag === "ru")!;
    expect(russian.text).toBe("пока́");
    expect(equivalents).toHaveLength(3);
    expect(calls).toHaveLength(1);
  });

  it("sends the documented endpoint, this product's own name, and a real session id", async () => {
    const { calls } = await stubGo(() => goResponse("обойтиться"));
    const asked = freshLanguage();
    const first = await ask(withKey(), asked);
    expect(first.status).toBe(200);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;

    expect(call.url).toBe(OPENCODE_GO_ENDPOINT);
    const headers = new Headers(call.init.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${TEST_KEY}`);
    // Honest identity: this is Ownwords, and it does not claim to be a coding
    // agent, because it is not one.
    expect(headers.get("User-Agent")).toBe(OPENCODE_GO_USER_AGENT);
    expect(headers.get("User-Agent")).toContain("ownwords");
    expect(headers.get("User-Agent")).not.toMatch(
      /claude|codex|opencode|agent/i,
    );

    const body = JSON.parse(String(call.init.body)) as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe(OPENCODE_GO_MODEL);
    expect(body.stream).toBe(false);
    expect(body.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
    ]);
    const userMessage = body.messages[1]!.content;
    expect(userMessage).toContain("see you later");
    expect(userMessage).toContain(`to ${asked}`);
    expect(userMessage).toContain("leaving politely");

    // The session header is a real, stable id for this one conversation: the
    // same request reuses it, and a different language does not.
    const session = headers.get("x-opencode-session");
    expect(session).toMatch(/^[0-9a-f]{32}$/);
    expect(session).not.toContain("see");
    const other = await ask(withKey(), freshLanguage());
    expect(other.status).toBe(200);
    const again = new Headers(calls[1]!.init.headers).get("x-opencode-session");
    expect(again).not.toBe(session);
  });

  it("answers no suggestion, and caches nothing, when the model has nothing usable", async () => {
    for (const content of [
      "",
      "   ",
      "see you later",
      '"see you later"',
      `[разг.] до свидания`,
    ]) {
      const { calls } = await stubGo(() => goResponse(content));
      const response = await ask(withKey(), freshLanguage());
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: unknown[];
        cache: string;
      };
      if (content.includes("до свидания")) {
        expect(body.data).toEqual([
          { text: "[разг.] до свидания", fit: "context_only" },
        ]);
      } else {
        // An echoed or empty answer is never offered as a translation.
        expect(body.data).toEqual([]);
        expect(body.cache).toBe("miss");
      }
      expect(calls).toHaveLength(1);
    }
  });

  it("fails honestly, without leaking provider text, when the call goes wrong", async () => {
    for (const [status, payload] of [
      [429, JSON.stringify({ error: { message: "monthly limit reached" } })],
      [500, "upstream exploded"],
      [401, JSON.stringify({ error: { message: "bad key" } })],
    ] as Array<[number, string]>) {
      const { calls } = await stubGo(
        () => new Response(payload, { status, headers: { "x-fixture": "1" } }),
      );
      const response = await ask(withKey(), freshLanguage());
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).not.toContain("monthly limit");
      expect(text).not.toContain("bad key");
      expect(text).not.toContain(TEST_KEY);
      expect(JSON.parse(text).error.code).toBe("INTERNAL_ERROR");
      expect(calls).toHaveLength(1);
    }
  });

  it("fails honestly when the call cannot be made at all", async () => {
    const { calls } = await stubGo(() => {
      throw new TypeError("network down");
    });
    const response = await ask(withKey(), freshLanguage());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INTERNAL_ERROR" },
    });
    expect(calls).toHaveLength(1);
  });

  it("never sends the key to a request that is not a translation", async () => {
    const { calls } = await stubGo(() => goResponse("не используется"));
    const response = await app.request(
      `${TRUSTED_ORIGIN}/api/v1/lexicon/entries`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: TRUSTED_ORIGIN,
          Cookie: learner.cookie,
        },
        body: JSON.stringify(personalEntry),
      },
      withKey(),
    );
    expect(response.status).toBe(201);
    expect(calls).toEqual([]);
  });

  it("reuses the cached answer for the same sense, so the provider is not paid twice", async () => {
    const { calls } = await stubGo(() => goResponse("прощайте"));
    const shared = freshLanguage();
    const first = await ask(withKey(), shared);
    const second = await ask(withKey(), shared);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { cache: string };
    expect(firstBody.cache).toBe("miss");
    await expect(second.json()).resolves.toMatchObject({ cache: "hit" });
    expect(calls).toHaveLength(1);
  });
});

describe("the session id names the phrase, not the person", () => {
  const request = {
    sourceLanguage: "en",
    targetLanguage: "ru",
    sense: "leaving politely",
    text: "see you later",
  };

  async function sessionFor(asked: typeof request): Promise<string | null> {
    const calls: RequestInit[] = [];
    const provider = new OpenCodeTranslationProvider({
      apiKey: TEST_KEY,
      fetch: async (_input, init = {}) => {
        calls.push(init);
        return goResponse("пока");
      },
    });
    await provider.suggest(asked);
    return new Headers(calls[0]!.headers).get("x-opencode-session");
  }

  it("is a digest of the languages, sense and phrase, and nothing else", async () => {
    const material = [
      "ownwords-translation",
      request.sourceLanguage,
      request.targetLanguage,
      request.sense,
      request.text,
    ].join("\u0000");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(material),
    );
    const expected = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    expect(await sessionFor(request)).toBe(expected);
    // No account identity is part of it, so the same ask is the same session.
    expect(await sessionFor({ ...request })).toBe(expected);
    expect(await sessionFor({ ...request, sense: "a toast" })).not.toBe(
      expected,
    );
  });
});

describe("the key belongs to one account only", () => {
  it("keeps one person's cached suggestions out of another's request", async () => {
    const other = await signedInUser("translation-user-two");
    const { calls } = await stubGo(() => goResponse("увидимся"));
    const shared = freshLanguage();
    const mine = await ask(withKey(), shared);
    expect(mine.status).toBe(200);
    const theirs = await app.request(
      suggestionPath(),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: TRUSTED_ORIGIN,
          Cookie: other.cookie,
        },
        body: JSON.stringify({
          sourceEquivalentId: source.id,
          targetLanguage: shared,
        }),
      },
      withKey(),
    );
    expect(theirs.status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it("refuses an unauthenticated suggestion request before any provider call", async () => {
    const { calls } = await stubGo(() => goResponse("нельзя"));
    const response = await app.request(
      suggestionPath(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: TRUSTED_ORIGIN },
        body: JSON.stringify({
          sourceEquivalentId: source.id,
          targetLanguage: freshLanguage(),
        }),
      },
      withKey(),
    );
    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });
});

describe("the session cookie helper stays the only credential in play", () => {
  it("uses the same signed-session path the product uses", async () => {
    const other = await signedInUser("translation-user-three");
    const { calls } = await stubGo(() => goResponse("до встречи"));
    const response = await app.request(
      suggestionPath(),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: TRUSTED_ORIGIN,
          Cookie: other.cookie,
        },
        body: JSON.stringify({
          sourceEquivalentId: source.id,
          targetLanguage: freshLanguage(),
        }),
      },
      withKey(),
    );
    // The session names a different account, so the entry is not theirs to read.
    expect(response.status).toBe(404);
    expect(calls).toEqual([]);
  });
});
