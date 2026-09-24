import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createCourseLexiconImporter, createEntry } from "../src/service.js";
import {
  DisabledTranslationProvider,
  ProviderDisabledError,
  TranslationSuggestionService,
} from "../src/translation.js";
import type {
  IdGenerator,
  TranslationProvider,
  TranslationSuggestionRequest,
} from "../src/types.js";
import {
  appFor,
  createVerifiedEntry,
  jsonRequest,
  setup,
  type TestContext,
} from "./helpers.js";

const contexts: TestContext[] = [];

afterEach(() => {
  while (contexts.length > 0) contexts.pop()!.rawDb.close();
});

async function context(): Promise<TestContext> {
  const value = await setup();
  contexts.push(value);
  return value;
}

class FakeProvider implements TranslationProvider {
  readonly id = "deterministic-fake";
  readonly version = "2026-01";
  calls: TranslationSuggestionRequest[] = [];

  async suggest(request: TranslationSuggestionRequest) {
    this.calls.push(request);
    return [
      {
        text: "предложение",
        fit: "exact" as const,
        provenance: { fixture: true },
      },
    ];
  }
}

describe("translation boundary and private cache", () => {
  it("defaults to a disabled provider that performs no request", async () => {
    const provider = new DisabledTranslationProvider();
    await assert.rejects(
      provider.suggest({
        sourceLanguage: "en",
        targetLanguage: "ru",
        text: "hello",
      }),
      ProviderDisabledError,
    );
  });

  it("caches per owner and never shares private context across accounts", async () => {
    const ctx = await context();
    const provider = new FakeProvider();
    const service = new TranslationSuggestionService(
      ctx.db,
      provider,
      ctx.clock,
    );
    const request = {
      sourceLanguage: "en",
      targetLanguage: "ru",
      text: "private family phrase",
      sense: "said only at home",
      senseVersion: 3,
    };
    const first = await service.suggest({ ...request, ownerId: "user-a" });
    const cached = await service.suggest({ ...request, ownerId: "user-a" });
    const otherOwner = await service.suggest({ ...request, ownerId: "user-b" });

    assert.equal(first.cache, "miss");
    assert.equal(cached.cache, "hit");
    assert.equal(otherOwner.cache, "miss");
    assert.equal(provider.calls.length, 2);
  });

  it("returns provider suggestions for review without overwriting a human correction", async () => {
    const ctx = await context();
    const entry = await createVerifiedEntry(ctx);
    const sense = entry.senses[0];
    const english = sense.equivalents.find(
      (item: any) => item.languageTag === "en",
    );
    const russian = sense.equivalents.find(
      (item: any) => item.languageTag === "ru",
    );
    const provider = new FakeProvider();
    const app = appFor(ctx, "user-a", { translationProvider: provider });

    const corrected = await jsonRequest(
      app,
      `/api/v1/lexicon/entries/${entry.id}/senses/${sense.id}/equivalents/${russian.id}`,
      {
        method: "PATCH",
        json: {
          version: russian.version,
          status: "manual",
          text: "здра́вствуй",
        },
      },
      ctx.db,
    );
    assert.equal(corrected.status, 200);

    const suggestion = await jsonRequest(
      app,
      `/api/v1/lexicon/entries/${entry.id}/senses/${sense.id}/suggestions`,
      {
        method: "POST",
        json: { sourceEquivalentId: english.id, targetLanguage: "ru" },
      },
      ctx.db,
    );
    assert.equal(suggestion.status, 200);
    assert.equal(
      ((await suggestion.json()) as any).data[0].text,
      "предложение",
    );

    const read = await jsonRequest(
      app,
      `/api/v1/lexicon/entries/${entry.id}`,
      {},
      ctx.db,
    );
    const current = (
      (await read.json()) as any
    ).data.senses[0].equivalents.find((item: any) => item.id === russian.id);
    assert.equal(current.text, "здра́вствуй");
    assert.equal(current.status, "manual");
    assert.equal(current.humanEdited, true);
  });

  it("surfaces disabled suggestion service honestly", async () => {
    const ctx = await context();
    const entry = await createVerifiedEntry(ctx);
    const sense = entry.senses[0];
    const source = sense.equivalents[0];
    const response = await jsonRequest(
      appFor(ctx, "user-a"),
      `/api/v1/lexicon/entries/${entry.id}/senses/${sense.id}/suggestions`,
      {
        method: "POST",
        json: { sourceEquivalentId: source.id, targetLanguage: "es" },
      },
      ctx.db,
    );
    assert.equal(response.status, 503);
    assert.equal(
      ((await response.json()) as any).error.code,
      "TRANSLATION_PROVIDER_DISABLED",
    );
  });
});

describe("course integration and transaction failure behavior", () => {
  const courseInput = {
    ownerId: "user-a",
    courseId: "russian-a0",
    courseVersion: "2026.1",
    itemId: "greeting-1",
    kind: "expression" as const,
    provenance: { contentVersion: "2026.1", license: "authored-fixture" },
    senses: [
      {
        gloss: "basic greeting",
        equivalents: [
          {
            languageTag: "en",
            text: "hello",
            status: "confirmed" as const,
            fit: "exact" as const,
          },
          {
            languageTag: "ru",
            text: "приве́т",
            status: "confirmed" as const,
            fit: "exact" as const,
          },
        ],
      },
    ],
  };

  it("imports a course item atomically and idempotently under concurrent retry", async () => {
    const ctx = await context();
    const importer = createCourseLexiconImporter({
      db: ctx.db,
      clock: ctx.clock,
      idGenerator: ctx.ids,
    });
    const [first, second] = await Promise.all([
      importer.importCourseEntry(courseInput),
      importer.importCourseEntry(courseInput),
    ]);
    assert.equal(first.entryId, second.entryId);
    assert.deepEqual([first.created, second.created].sort(), [false, true]);

    const count = ctx.rawDb.sqlite
      .prepare("SELECT COUNT(*) AS count FROM lexicon_entries")
      .get() as { count: number };
    assert.equal(count.count, 1);
    const marker = ctx.rawDb.sqlite
      .prepare("SELECT COUNT(*) AS count FROM lexicon_course_imports")
      .get() as { count: number };
    assert.equal(marker.count, 1);
  });

  it("separates the same course identity by owner", async () => {
    const ctx = await context();
    const importer = createCourseLexiconImporter({
      db: ctx.db,
      clock: ctx.clock,
      idGenerator: ctx.ids,
    });
    const first = await importer.importCourseEntry(courseInput);
    const second = await importer.importCourseEntry({
      ...courseInput,
      ownerId: "user-b",
    });
    assert.notEqual(first.entryId, second.entryId);
  });

  it("rejects unverified course equivalents before any write", async () => {
    const ctx = await context();
    const importer = createCourseLexiconImporter({
      db: ctx.db,
      clock: ctx.clock,
      idGenerator: ctx.ids,
    });
    await assert.rejects(
      importer.importCourseEntry({
        ...courseInput,
        senses: [
          {
            gloss: "bad",
            equivalents: [
              {
                languageTag: "ru",
                text: "может",
                status: "suggested",
                fit: "exact",
              },
            ],
          },
        ],
      }),
      /verified/u,
    );
    const count = ctx.rawDb.sqlite
      .prepare("SELECT COUNT(*) AS count FROM lexicon_entries")
      .get() as { count: number };
    assert.equal(count.count, 0);
  });

  it("validates the typed course boundary at runtime before any write", async () => {
    const ctx = await context();
    const importer = createCourseLexiconImporter({
      db: ctx.db,
      clock: ctx.clock,
      idGenerator: ctx.ids,
    });
    await assert.rejects(
      importer.importCourseEntry({ ...courseInput, kind: "phrase" } as any),
      /kind must be one of/u,
    );
    await assert.rejects(
      importer.importCourseEntry({
        ...courseInput,
        provenance: undefined,
      } as any),
      /provenance is required/u,
    );
    const count = ctx.rawDb.sqlite
      .prepare("SELECT COUNT(*) AS count FROM lexicon_entries")
      .get() as { count: number };
    assert.equal(count.count, 0);
  });

  it("rolls back a failed multi-row entry batch", async () => {
    const ctx = await context();
    const collidingIds: IdGenerator = { next: () => "same-id" };
    await assert.rejects(
      createEntry(
        ctx.db,
        "user-a",
        {
          kind: "word",
          senses: [
            {
              equivalents: [
                { languageTag: "en", text: "one", status: "manual" },
                { languageTag: "es", text: "uno", status: "manual" },
              ],
            },
          ],
        },
        ctx.clock,
        collidingIds,
      ),
    );
    const count = ctx.rawDb.sqlite
      .prepare("SELECT COUNT(*) AS count FROM lexicon_entries")
      .get() as { count: number };
    assert.equal(count.count, 0);
  });
});

describe("migration", () => {
  it("enforces owner-linked nested foreign keys", async () => {
    const ctx = await context();
    assert.throws(() => {
      ctx.rawDb.sqlite
        .prepare(
          `INSERT INTO lexicon_senses
            (id, owner_id, entry_id, position, human_edited, version, created_at, updated_at)
           VALUES ('sense-x', 'user-b', 'missing-entry', 0, 0, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        )
        .run();
    }, /FOREIGN KEY/u);
  });
});
