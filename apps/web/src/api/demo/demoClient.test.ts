import { beforeEach, describe, expect, it } from "vitest";
import { createDemoClient } from "./demoClient";
import { OwnwordsError } from "../client";
import type { OwnwordsClient } from "../client";

let client: OwnwordsClient;

const scope = (mode: "maintain" | "learn", ahead = false) => ({
  mode,
  format: "cloze" as const,
  sessionId: "s",
  ahead,
});

beforeEach(() => {
  client = createDemoClient({ suggestionDelaysMs: {} });
});

describe("reading the collection", () => {
  it("searches without case or stress marks", async () => {
    const page = await client.listEntries({ search: "молоко" });
    expect(page.items.map((entry) => entry.headword)).toEqual(["молоко́"]);
  });

  it("keeps only entries carrying an unreviewed equivalent", async () => {
    const page = await client.listEntries({ unverifiedOnly: true });
    const headwords = page.items.map((entry) => entry.headword);
    expect(headwords).toContain("to make do with");
    expect(headwords).not.toContain("ni de coña");
  });

  it("filters to expressions", async () => {
    const page = await client.listEntries({ kind: "expression" });
    expect(page.items.every((entry) => entry.kind === "expression")).toBe(true);
  });

  it("filters to words", async () => {
    const page = await client.listEntries({ kind: "word" });
    expect(page.items.map((entry) => entry.headword).sort()).toEqual([
      "actually",
      "sobremesa",
      "молоко́",
    ]);
  });

  it("filters by mastery band", async () => {
    const strong = await client.listEntries({ mastery: "strong" });
    expect(strong.items.map((entry) => entry.headword)).toEqual(["sobremesa"]);
    const weak = await client.listEntries({ mastery: "weak" });
    expect(weak.items.map((entry) => entry.headword)).toContain(
      "to take for granted",
    );
    expect(weak.items.map((entry) => entry.headword)).not.toContain(
      "sobremesa",
    );
  });

  it("reports a missing entry rather than inventing one", async () => {
    await expect(client.getEntry("nope")).rejects.toBeInstanceOf(OwnwordsError);
  });
});

describe("fixing a translation", () => {
  it("refuses a change made against a version somebody replaced", async () => {
    const entry = await client.getEntry("e1");
    const sense = entry.senses[0]!;
    const equivalent = sense.equivalents[0]!;
    await client.updateEquivalent(entry.id, sense.id, equivalent.id, {
      version: equivalent.version,
      fit: "broader",
    });
    await expect(
      client.updateEquivalent(entry.id, sense.id, equivalent.id, {
        version: equivalent.version,
        fit: "narrower",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("records a fit and confirms the equivalent", async () => {
    const entry = await client.getEntry("e1");
    const sense = entry.senses[0]!;
    const equivalent = sense.equivalents[1]!;
    const updated = await client.updateEquivalent(
      entry.id,
      sense.id,
      equivalent.id,
      {
        version: equivalent.version,
        fit: "false-friend",
        state: "confirmed",
      },
    );
    const after = updated.senses[0]!.equivalents[1]!;
    expect(after.fit).toBe("false-friend");
    expect(after.state).toBe("confirmed");
    expect(updated.version).toBeGreaterThan(entry.version);
  });

  it("marks a hand-typed equivalent as typed by hand", async () => {
    const entry = await client.getEntry("e1");
    const sense = entry.senses[0]!;
    const equivalent = sense.equivalents[0]!;
    const updated = await client.updateEquivalent(
      entry.id,
      sense.id,
      equivalent.id,
      {
        version: equivalent.version,
        text: "apañárselas con",
      },
    );
    expect(updated.senses[0]!.equivalents[0]!.state).toBe("manual");
  });

  it("retries a failed translation without dropping the entry", async () => {
    const entry = await client.getEntry("e4");
    const sense = entry.senses[0]!;
    const failed = sense.equivalents.find(
      (candidate) => candidate.state === "failed",
    )!;
    const updated = await client.retryTranslation(
      entry.id,
      sense.id,
      failed.id,
    );
    const after = updated.senses[0]!.equivalents.find(
      (candidate) => candidate.id === failed.id,
    )!;
    expect(after.state).toBe("suggested");
    expect(after.text).not.toBe("");
  });
});

describe("adding a sense", () => {
  it("stores the gloss the person gave it", async () => {
    const updated = await client.addSense("e2", "  a joke that went too far ");
    expect(updated.senses.map((sense) => sense.gloss)).toEqual([
      "no way",
      "a joke that went too far",
    ]);
  });

  it("refuses a blank gloss and stores nothing", async () => {
    await expect(client.addSense("e2", "   ")).rejects.toBeInstanceOf(
      OwnwordsError,
    );
    expect((await client.getEntry("e2")).senses).toHaveLength(1);
  });
});

describe("starting from an empty Lexicon", () => {
  it("offers three starter expressions", async () => {
    const empty = createDemoClient({ suggestionDelaysMs: {}, entries: [] });
    const starters = await empty.listStarters();
    expect(starters).toHaveLength(3);
  });

  it("adds a starter with vetted equivalents and makes it due at once", async () => {
    const empty = createDemoClient({ suggestionDelaysMs: {}, entries: [] });
    expect((await empty.getDueQueue(scope("maintain"))).cards).toEqual([]);

    const [starter] = await empty.listStarters();
    const entry = await empty.addStarter(starter!.id);
    expect(entry.headword).toBe(starter!.headword);
    expect(
      entry.senses[0]!.equivalents.every(
        (equivalent) => equivalent.state === "confirmed",
      ),
    ).toBe(true);
    expect((await empty.listEntries()).items).toHaveLength(1);

    const maintain = await empty.getDueQueue(scope("maintain"));
    const learn = await empty.getDueQueue(scope("learn"));
    expect(maintain.cards.map((card) => card.headword)).toEqual([
      entry.headword,
    ]);
    expect(learn.cards.map((card) => card.headword)).toEqual([entry.headword]);
  });

  it("refuses a starter it never offered", async () => {
    await expect(client.addStarter("nope")).rejects.toBeInstanceOf(
      OwnwordsError,
    );
  });
});

describe("adding an entry", () => {
  const newEntry = {
    headword: "to let it slide",
    note: "when it is not worth the argument",
    kind: "expression" as const,
    language: "en",
  };

  it("stores the headword first, and the reviewed equivalents after", async () => {
    const created = await client.createEntry(newEntry);
    expect(created.senses[0]!.equivalents).toEqual([]);
    const saved = await client.addEquivalents(
      created.id,
      created.senses[0]!.id,
      [
        { language: "es", text: "dejarlo pasar", state: "confirmed" },
        { language: "ru", text: "", state: "failed" },
      ],
    );
    expect(
      saved.senses[0]!.equivalents.map(
        (candidate) => `${candidate.language}:${candidate.state}`,
      ),
    ).toEqual(["es:confirmed", "ru:failed"]);
    const page = await client.listEntries({ search: "let it slide" });
    expect(page.items).toHaveLength(1);
  });

  it("sets a stored draft aside, and refuses a stale version", async () => {
    const created = await client.createEntry(newEntry);
    await expect(
      client.deleteEntry(created.id, created.version + 1),
    ).rejects.toMatchObject({ status: 409 });
    await client.deleteEntry(created.id, created.version);
    await expect(client.getEntry(created.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("reports each suggestion as it arrives", async () => {
    const seen: string[] = [];
    const created = await client.createEntry(newEntry);
    await client.requestSuggestions(created, ["es", "ru"], (result) =>
      seen.push(`${result.language}:${result.state}`),
    );
    expect(seen.sort()).toEqual(["es:suggested", "ru:suggested"]);
  });

  it("says a translation failed without dropping anything", async () => {
    const failing = createDemoClient({
      suggestionDelaysMs: {},
      failingLanguages: ["ru"],
    });
    const results: string[] = [];
    await failing.requestSuggestions(
      await failing.getEntry("e4"),
      ["ru"],
      (result) => results.push(`${result.state}:${result.reason ?? ""}`),
    );
    expect(results[0]).toBe("failed:Translation failed. Nothing was dropped.");
  });
});

describe("practice", () => {
  it("keeps Learn practice to the language being learned", async () => {
    const queue = await client.getDueQueue(scope("learn"));
    expect(queue.cards.every((card) => card.language === "ru")).toBe(true);
  });

  it("sizes the session in words, not counts", async () => {
    const queue = await client.getDueQueue(scope("maintain"));
    expect(queue.estimate).toMatch(/^About (a minute|[a-z]+ minutes)\.$/);
  });

  it("keeps a card that was rated again in the session", async () => {
    const before = await client.getDueQueue(scope("maintain"));
    const card = before.cards[0]!;
    await client.submitReview({
      cardId: card.cardId,
      rating: "again",
      format: "cloze",
      sessionId: "s",
      submissionId: "a",
    });
    const after = await client.getDueQueue(scope("maintain"));
    expect(after.cards.map((one) => one.cardId)).toContain(card.cardId);
  });

  it("keeps Maintain practice away from the language being learned", async () => {
    const due = await client.getDueQueue(scope("maintain"));
    const ahead = await client.getDueQueue(scope("maintain", true));
    expect(
      [...due.cards, ...ahead.cards].some((card) => card.language === "ru"),
    ).toBe(false);
    expect(due.comingUp.some((item) => item.language === "ru")).toBe(false);
  });

  it("offers the cards coming up next once everything due is done", async () => {
    const due = await client.getDueQueue(scope("maintain"));
    for (const card of due.cards) {
      await client.submitReview({
        cardId: card.cardId,
        rating: "good",
        format: "cloze",
        sessionId: "s",
        submissionId: card.cardId,
      });
    }
    const empty = await client.getDueQueue(scope("maintain"));
    expect(empty.cards).toEqual([]);
    expect(empty.comingUp.map((item) => item.headword)).toEqual([
      "sobremesa",
      "actually",
    ]);

    const ahead = await client.getDueQueue(scope("maintain", true));
    expect(ahead.cards.map((card) => card.headword)).toEqual([
      "sobremesa",
      "actually",
    ]);
    expect(ahead.estimate).not.toBe("");
  });

  it("stops offering a card coming up once it has been practised ahead", async () => {
    const ahead = await client.getDueQueue(scope("learn", true));
    expect(ahead.cards.every((card) => card.language === "ru")).toBe(true);
    const first = ahead.cards[0]!;
    await client.submitReview({
      cardId: first.cardId,
      rating: "good",
      format: "cloze",
      sessionId: "s",
      submissionId: "c",
    });
    const due = await client.getDueQueue(scope("learn"));
    expect(due.comingUp.map((item) => item.headword)).not.toContain(
      first.headword,
    );
  });

  it("retires a card that was answered", async () => {
    const before = await client.getDueQueue(scope("maintain"));
    const card = before.cards[0]!;
    await client.submitReview({
      cardId: card.cardId,
      rating: "good",
      format: "cloze",
      sessionId: "s",
      submissionId: "b",
    });
    const after = await client.getDueQueue(scope("maintain"));
    expect(after.cards.map((one) => one.cardId)).not.toContain(card.cardId);
  });
});

describe("progress", () => {
  it("reports retention per language and per direction, and never a card count", async () => {
    const summary = await client.getProgress();
    const russianProduce = summary.perLanguage.find(
      (row) => row.language === "ru" && row.direction === "produce",
    )!;
    expect(russianProduce.retention).toBeNull();

    const numbers: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (typeof value === "number") numbers.push(path);
      else if (value && typeof value === "object") {
        for (const [key, inner] of Object.entries(value))
          walk(inner, `${path}.${key}`);
      }
    };
    walk(summary, "summary");
    expect(numbers.every((path) => path.endsWith(".retention"))).toBe(true);
  });

  it("says what Maintain practice is due, and not what Learn practice is", async () => {
    expect((await client.getProgress()).estimate).not.toBe("");
    const due = await client.getDueQueue(scope("maintain"));
    for (const card of due.cards) {
      await client.submitReview({
        cardId: card.cardId,
        rating: "good",
        format: "cloze",
        sessionId: "s",
        submissionId: card.cardId,
      });
    }
    expect((await client.getDueQueue(scope("learn"))).cards).not.toEqual([]);
    const summary = await client.getProgress();
    expect(summary.estimate).toBe("");
    expect(summary.comingUp.some((item) => item.language === "ru")).toBe(false);
  });
});

describe("the course", () => {
  it("has all 33 Cyrillic letters, with the Latin lookalikes marked", async () => {
    const alphabet = await client.getAlphabet();
    expect(alphabet).toHaveLength(33);
    expect(alphabet.find((letter) => letter.upper === "В")?.trap).toBe(
      "looks like B",
    );
    expect(alphabet.find((letter) => letter.upper === "К")?.sameAsLatin).toBe(
      true,
    );
  });

  it("refuses a lesson that is not in the course yet", async () => {
    await expect(client.getLesson("u9")).rejects.toBeInstanceOf(OwnwordsError);
  });
});
