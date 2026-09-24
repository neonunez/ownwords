import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { Hono } from "hono";
import { createLexiconRoutes } from "../src/routes.js";
import type {
  Clock,
  CreateLexiconRoutesOptions,
  IdGenerator,
  LexiconEnv,
  TranslationProvider,
} from "../src/types.js";
import { TestD1Database } from "./d1.js";

export class MutableClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class SequenceIds implements IdGenerator {
  private value = 0;

  constructor(private readonly prefix = "id") {}

  next(): string {
    this.value += 1;
    return `${this.prefix}-${this.value}`;
  }
}

export interface TestContext {
  rawDb: TestD1Database;
  db: D1Database;
  clock: MutableClock;
  ids: SequenceIds;
}

export async function setup(): Promise<TestContext> {
  const rawDb = new TestD1Database();
  const migration = readFileSync(
    fileURLToPath(
      new NodeURL("../../migrations/0100_lexicon.sql", import.meta.url),
    ),
    "utf8",
  );
  await rawDb.exec(migration);
  return {
    rawDb,
    db: rawDb.asD1(),
    clock: new MutableClock(new Date("2026-01-15T12:00:00.000Z")),
    ids: new SequenceIds(),
  };
}

export function appFor(
  context: TestContext,
  ownerId?: string,
  options: {
    translationProvider?: TranslationProvider;
    wrongAnswerDelayMs?: number;
  } = {},
): Hono<LexiconEnv> {
  const app = new Hono<LexiconEnv>();
  app.use("*", async (c, next) => {
    if (ownerId !== undefined) c.set("userId", ownerId);
    await next();
  });
  const routeOptions: CreateLexiconRoutesOptions = {
    clock: context.clock,
    idGenerator: context.ids,
    ...(options.translationProvider === undefined
      ? {}
      : { translationProvider: options.translationProvider }),
    ...(options.wrongAnswerDelayMs === undefined
      ? {}
      : { wrongAnswerDelayMs: options.wrongAnswerDelayMs }),
  };
  app.route("/api/v1/lexicon", createLexiconRoutes(routeOptions));
  return app;
}

export async function jsonRequest(
  app: Hono<LexiconEnv>,
  path: string,
  init: RequestInit & { json?: unknown } = {},
  db: D1Database,
): Promise<Response> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if ("json" in init) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const { json: _json, ...base } = init;
  const requestInit = {
    ...base,
    headers,
    ...(body === undefined ? {} : { body }),
  };
  return await app.request(path, requestInit, { DB: db });
}

export function verifiedEntryBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "expression",
    note: "used when greeting a friend",
    senses: [
      {
        gloss: "friendly greeting",
        equivalents: [
          {
            languageTag: "en",
            text: "hello there",
            fit: "exact",
            status: "manual",
          },
          {
            languageTag: "ru",
            text: "приве́т",
            fit: "exact",
            status: "confirmed",
          },
        ],
      },
    ],
    ...overrides,
  };
}

export async function createVerifiedEntry(
  context: TestContext,
  ownerId = "user-a",
): Promise<any> {
  const response = await jsonRequest(
    appFor(context, ownerId),
    "/api/v1/lexicon/entries",
    { method: "POST", json: verifiedEntryBody() },
    context.db,
  );
  if (response.status !== 201)
    throw new Error(
      `fixture entry failed: ${response.status} ${await response.text()}`,
    );
  return ((await response.json()) as { data: any }).data;
}
