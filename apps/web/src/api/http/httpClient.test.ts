import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "./httpClient";
import { OwnwordsError } from "../client";

/**
 * A stand-in for the API: answers by method and path with the bodies the
 * real routes return, and records every request the client makes.
 */
function fakeApi(
  routes: Record<string, unknown | ((request: Request) => Response)>,
) {
  const requests: Request[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(
      new URL(String(input), "http://app.test"),
      init,
    );
    requests.push(request);
    const url = new URL(request.url);
    const key = `${request.method} ${url.pathname}`;
    const answer = routes[key];
    if (answer === undefined) {
      return Response.json(
        { error: { code: "not_found", message: "missing" } },
        { status: 404 },
      );
    }
    return typeof answer === "function"
      ? (answer as (request: Request) => Response)(request)
      : Response.json(answer);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests };
}

const profile = {
  data: {
    profile: {
      completedAt: "2026-09-01T00:00:00.000Z",
      languages: [
        { id: "1", tag: "en", kind: "maintain", level: "native" },
        { id: "2", tag: "es", kind: "maintain", level: "b2" },
        { id: "3", tag: "ru", kind: "learn", level: "a0" },
      ],
      preferences: {
        explanationLanguage: "en",
        russianCourseAudio: true,
        translationSuggestions: false,
      },
    },
  },
};

const signedIn = {
  "GET /api/auth/get-session": {
    session: { id: "s" },
    user: { id: "u", name: "Ana", email: "ana@example.com" },
  },
  "GET /api/v1/profile": profile,
};

function equivalent(
  id: string,
  languageTag: string,
  text: string | null,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    senseId: "s1",
    languageTag,
    text,
    fit: "exact",
    status: "manual",
    note: null,
    source: null,
    provenance: null,
    scriptData: null,
    mastery: {
      recognize: { level: "new", dueAt: "", due: true },
      produce: { level: "new", dueAt: "", due: true },
    },
    version: 1,
    ...extra,
  };
}

const wireEntry = {
  id: "e1",
  kind: "expression",
  note: "when it is not ideal",
  source: null,
  provenance: { createdBy: "ownwords-web", headwordLanguage: "es" },
  version: 3,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  senses: [
    {
      id: "s1",
      entryId: "e1",
      gloss: null,
      note: null,
      position: 0,
      version: 1,
      equivalents: [
        // Ordered by language, as the API orders them: the headword is not first.
        equivalent("q-en", "en", "to make do", {
          mastery: {
            recognize: { level: "mastered", dueAt: "", due: false },
            produce: { level: "learning", dueAt: "", due: false },
          },
        }),
        equivalent("q-es", "es", "apañarse", {
          mastery: {
            recognize: { level: "learning", dueAt: "", due: false },
            produce: { level: "new", dueAt: "", due: true },
          },
        }),
        equivalent("q-ru", "ru", null, {
          status: "failed",
          fit: "exact",
          mastery: null,
        }),
        equivalent("q-ru2", "ru", "обходи́ться", {
          fit: "context_only",
          status: "suggested",
          mastery: null,
          version: 4,
        }),
      ],
    },
  ],
};

describe("the session", () => {
  it("reads a missing session as signed out", async () => {
    const api = fakeApi({ "GET /api/auth/get-session": null });
    const client = createHttpClient({ fetch: api.fetch });
    expect(await client.getSession()).toEqual({ status: "signed-out" });
  });

  it("reports a signed-in account that has not finished the first run", async () => {
    const api = fakeApi({
      ...signedIn,
      "GET /api/v1/profile": { data: { profile: null } },
    });
    const session = await createHttpClient({ fetch: api.fetch }).getSession();
    expect(session).toEqual({
      status: "signed-in",
      account: { name: "Ana", email: "ana@example.com" },
      onboarding: null,
    });
  });

  it("reads the profile into languages and preferences", async () => {
    const api = fakeApi(signedIn);
    const client = createHttpClient({ fetch: api.fetch });
    const session = await client.getSession();
    expect(session.status === "signed-in" && session.onboarding).toMatchObject({
      languages: [
        { code: "en", kind: "maintain", level: "native" },
        { code: "es", kind: "maintain", level: "b2" },
        { code: "ru", kind: "learn", level: "a0" },
      ],
      preferences: { explanationsIn: "en", suggestTranslations: false },
    });
    expect(await client.listLanguages()).toEqual([
      { code: "en", name: "English", role: "native", level: "native" },
      { code: "es", name: "Español", role: "maintained", level: "B2" },
      { code: "ru", name: "Русский", role: "learning", level: "learning · A0" },
    ]);
  });

  it("sends the first run in the shape the API validates", async () => {
    const api = fakeApi({ "PUT /api/v1/onboarding": profile });
    await createHttpClient({ fetch: api.fetch }).saveOnboarding({
      languages: [{ code: "en", kind: "maintain", level: "native" }],
      preferences: {
        explanationsIn: "es",
        audioInCourse: false,
        suggestTranslations: true,
      },
    });
    expect(await api.requests[0]!.json()).toEqual({
      languages: [{ tag: "en", kind: "maintain", level: "native" }],
      preferences: {
        explanationLanguage: "es",
        russianCourseAudio: false,
        translationSuggestions: true,
      },
    });
  });

  it("announces a session that ended, and throws a written error", async () => {
    const api = fakeApi({
      ...signedIn,
      "GET /api/v1/lexicon/entries": () =>
        Response.json(
          {
            error: {
              code: "unauthorized",
              message: "A valid session is required",
            },
          },
          { status: 401 },
        ),
    });
    const client = createHttpClient({ fetch: api.fetch });
    const ended = vi.fn();
    client.onSignedOut(ended);
    await client.getSession();
    const error = await client.listEntries().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(OwnwordsError);
    expect(error).toMatchObject({ status: 401, code: "unauthorized" });
    expect(ended).toHaveBeenCalledOnce();
  });

  it("says the backend could not be reached, rather than showing nothing", async () => {
    const client = createHttpClient({
      fetch: (async () => {
        throw new TypeError("Failed to fetch");
      }) as typeof fetch,
    });
    await expect(client.getSession()).rejects.toMatchObject({
      code: "offline",
    });
  });

  it("refuses an answer that is not the API's, such as the app's own page", async () => {
    const api = fakeApi({
      "GET /api/auth/get-session": () =>
        new Response("<!doctype html>", {
          headers: { "Content-Type": "text/html" },
        }),
    });
    await expect(
      createHttpClient({ fetch: api.fetch }).getSession(),
    ).rejects.toMatchObject({ code: "bad_response" });
  });

  it("returns Google's sign-in address rather than inventing one", async () => {
    const api = fakeApi({
      "POST /api/auth/sign-in/social": {
        url: "https://accounts.google.com/o/oauth2/v2/auth?x=1",
        redirect: true,
      },
    });
    expect(
      await createHttpClient({ fetch: api.fetch }).startGoogleSignIn(),
    ).toBe("https://accounts.google.com/o/oauth2/v2/auth?x=1");
    expect(await api.requests[0]!.json()).toMatchObject({ provider: "google" });
  });

  it("will not send the browser anywhere but an HTTPS address", async () => {
    const api = fakeApi({
      "POST /api/auth/sign-in/social": { url: "javascript:alert(1)" },
    });
    await expect(
      createHttpClient({ fetch: api.fetch }).startGoogleSignIn(),
    ).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("the collection", () => {
  async function client(routes: Record<string, unknown> = {}) {
    const api = fakeApi({ ...signedIn, ...routes });
    const created = createHttpClient({ fetch: api.fetch });
    await created.getSession();
    return { client: created, requests: api.requests };
  }

  it("shows the headword in its own language, and the rest as equivalents", async () => {
    const { client: http } = await client({
      "GET /api/v1/lexicon/entries/e1": { data: wireEntry },
    });
    const entry = await http.getEntry("e1");
    expect(entry.headword).toBe("apañarse");
    expect(entry.language).toBe("es");
    expect(entry.version).toBe(3);
    const equivalents = entry.senses[0]!.equivalents;
    expect(equivalents.map((item) => item.language)).toEqual([
      "en",
      "ru",
      "ru",
    ]);
    // A failed translation has no wording to fit; suggested keeps its version.
    expect(equivalents[1]).toMatchObject({
      state: "failed",
      text: "",
      fit: null,
    });
    expect(equivalents[2]).toMatchObject({
      state: "suggested",
      fit: "context-only",
      text: "обходи́ться",
      version: 4,
    });
  });

  it("leaves the native language's mastery off, and writes stages as words", async () => {
    const { client: http } = await client({
      "GET /api/v1/lexicon/entries/e1": { data: wireEntry },
    });
    const entry = await http.getEntry("e1");
    // English is native here; unverified Russian has no cards.
    expect(entry.mastery).toEqual({
      es: { recognise: "learning", produce: null },
    });
  });

  it("asks for the page it wants, in the API's terms", async () => {
    const { client: http, requests } = await client({
      "GET /api/v1/lexicon/entries": {
        data: [wireEntry],
        page: { limit: 30, nextCursor: "abc" },
      },
    });
    const page = await http.listEntries({
      search: "  obhod ",
      unverifiedOnly: true,
      mastery: "weak",
      cursor: "prev",
    });
    const query = new URL(requests.at(-1)!.url).searchParams;
    expect(Object.fromEntries(query)).toEqual({
      query: "obhod",
      verification: "unverified",
      mastery: "due",
      cursor: "prev",
    });
    expect(page.nextCursor).toBe("abc");
    expect(page.total).toBeUndefined();
    await http.listEntries({ mastery: "strong" });
    expect(new URL(requests.at(-1)!.url).searchParams.get("mastery")).toBe(
      "mastered",
    );
  });

  it("stores a new entry as its headword, typed by hand, marked with its language", async () => {
    const { client: http, requests } = await client({
      "POST /api/v1/lexicon/entries": { data: wireEntry },
    });
    await http.createEntry({
      headword: " apañarse ",
      note: "",
      kind: "expression",
      language: "es",
    });
    expect(await requests.at(-1)!.json()).toEqual({
      kind: "expression",
      note: null,
      provenance: { createdBy: "ownwords-web", headwordLanguage: "es" },
      senses: [
        {
          gloss: null,
          equivalents: [
            {
              languageTag: "es",
              text: "apañarse",
              status: "manual",
              fit: "exact",
            },
          ],
        },
      ],
    });
  });

  it("sends the version it read, so a change made elsewhere first is refused", async () => {
    const { client: http, requests } = await client({
      "PATCH /api/v1/lexicon/entries/e1/senses/s1/equivalents/q-ru2": () =>
        Response.json(
          { error: { code: "VERSION_CONFLICT", message: "changed" } },
          { status: 409 },
        ),
    });
    const error = await http
      .updateEquivalent("e1", "s1", "q-ru2", {
        version: 4,
        fit: "false-friend",
        state: "confirmed",
      })
      .catch((cause: unknown) => cause);
    expect(await requests.at(-1)!.json()).toEqual({
      version: 4,
      status: "confirmed",
      fit: "false_friend",
    });
    expect(error).toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
    expect((error as Error).message).toMatch(/changed somewhere else first/);
  });

  it("marks a wording typed over a suggestion as typed by hand", async () => {
    const { client: http, requests } = await client({
      "PATCH /api/v1/lexicon/entries/e1/senses/s1/equivalents/q-ru2": {
        data: {},
      },
      "GET /api/v1/lexicon/entries/e1": { data: wireEntry },
    });
    await http.updateEquivalent("e1", "s1", "q-ru2", {
      version: 4,
      text: " обходиться ",
    });
    const patch = requests.find((request) => request.method === "PATCH")!;
    expect(await patch.json()).toEqual({
      version: 4,
      text: "обходиться",
      status: "manual",
    });
  });

  it("says each suggestion failed when the provider is switched off", async () => {
    const { client: http } = await client({
      "GET /api/v1/lexicon/entries/e1": { data: wireEntry },
      "POST /api/v1/lexicon/entries/e1/senses/s1/suggestions": () =>
        Response.json(
          {
            error: {
              code: "TRANSLATION_PROVIDER_DISABLED",
              message: "Translation suggestions are disabled",
            },
          },
          { status: 503 },
        ),
    });
    const entry = await http.getEntry("e1");
    const results: string[] = [];
    await http.requestSuggestions(entry, ["en", "ru"], (result) =>
      results.push(`${result.language}:${result.state}:${result.reason}`),
    );
    expect(results.sort()).toEqual([
      "en:failed:Suggestions are switched off for now. Type it yourself.",
      "ru:failed:Suggestions are switched off for now. Type it yourself.",
    ]);
  });

  it("translates from the headword and reports a suggestion for review only", async () => {
    const { client: http, requests } = await client({
      "GET /api/v1/lexicon/entries/e1": { data: wireEntry },
      "POST /api/v1/lexicon/entries/e1/senses/s1/suggestions": {
        data: [{ text: "to get by", fit: "context_only" }],
        cache: "miss",
      },
    });
    const entry = await http.getEntry("e1");
    const results: unknown[] = [];
    await http.requestSuggestions(entry, ["en"], (result) =>
      results.push(result),
    );
    expect(results).toEqual([
      {
        language: "en",
        state: "suggested",
        text: "to get by",
        fit: "context-only",
      },
    ]);
    const asked = requests.find((request) => request.method === "POST")!;
    expect(await asked.json()).toEqual({
      sourceEquivalentId: "q-es",
      targetLanguage: "en",
    });
  });

  it("keeps a failed translation when saving the reviewed equivalents", async () => {
    const { client: http, requests } = await client({
      "POST /api/v1/lexicon/entries/e1/senses/s1/equivalents": { data: {} },
      "GET /api/v1/lexicon/entries/e1": { data: wireEntry },
    });
    await http.addEquivalents("e1", "s1", [
      { language: "en", text: "to get by", state: "confirmed", fit: "broader" },
      { language: "ru", text: "", state: "failed" },
    ]);
    const posted = await Promise.all(
      requests
        .filter((request) => request.method === "POST")
        .map((request) => request.json()),
    );
    expect(posted).toEqual([
      {
        languageTag: "en",
        text: "to get by",
        status: "confirmed",
        fit: "broader",
      },
      { languageTag: "ru", text: null, status: "failed" },
    ]);
  });

  it("offers no starter expressions, since the backend has none", async () => {
    const { client: http } = await client();
    expect(await http.listStarters()).toEqual([]);
    await expect(http.addStarter("st1")).rejects.toBeInstanceOf(OwnwordsError);
  });

  it("deletes with the version it read, in the header the API asks for", async () => {
    const { client: http, requests } = await client({
      "DELETE /api/v1/lexicon/entries/e1": () =>
        new Response(null, { status: 204 }),
    });
    await http.deleteEntry("e1", 3);
    expect(requests.at(-1)!.headers.get("If-Match")).toBe('"3"');
  });
});

describe("practice and progress", () => {
  function dueRow(
    id: string,
    languageTag: string,
    direction: "recognize" | "produce",
    dueAt: string,
    revisit = false,
  ) {
    return {
      card: { id, equivalentId: `q-${id}`, languageTag, direction, dueAt },
      target: { id: `q-${id}`, text: `${languageTag}-word`, languageTag },
      prompt: {
        type: "equivalent",
        id: "q-en",
        languageTag: "en",
        text: "word",
      },
      cloze: null,
      revisit,
    };
  }

  it("asks every practised language in both directions, most urgent first", async () => {
    const api = fakeApi({
      ...signedIn,
      "GET /api/v1/lexicon/practice/due": (request: Request) => {
        const query = new URL(request.url).searchParams;
        const lane = `${query.get("language")}:${query.get("direction")}`;
        if (lane === "es:produce") {
          return Response.json({
            data: [dueRow("a", "es", "produce", "2026-09-02T00:00:00.000Z")],
            nextDueAt: null,
          });
        }
        if (lane === "ru:recognize") {
          return Response.json({
            data: [
              dueRow("b", "ru", "recognize", "2026-09-03T00:00:00.000Z", true),
            ],
            nextDueAt: null,
          });
        }
        return Response.json({
          data: [],
          nextDueAt:
            lane === "es:recognize" ? "2999-01-01T00:00:00.000Z" : null,
        });
      },
    });
    const client = createHttpClient({ fetch: api.fetch });
    await client.getSession();
    const queue = await client.getDueQueue({
      mode: "maintain",
      format: "flashcard",
      sessionId: "sitting-1",
    });
    const lanes = api.requests
      .filter((request) => request.url.includes("/practice/due"))
      .map((request) => {
        const query = new URL(request.url).searchParams;
        expect(query.get("sessionId")).toBe("sitting-1");
        expect(query.get("origin")).toBeNull();
        return `${query.get("language")}:${query.get("direction")}`;
      })
      .sort();
    // English is native, so Maintain does not practise it.
    expect(lanes).toEqual([
      "es:produce",
      "es:recognize",
      "ru:produce",
      "ru:recognize",
    ]);
    // A card missed earlier in the sitting comes back first.
    expect(queue.cards.map((card) => card.cardId)).toEqual(["b", "a"]);
    expect(queue.cards[0]).toMatchObject({
      direction: "recognise",
      headword: "ru-word",
      answer: "word",
      answerLanguage: "en",
      promptLanguage: "ru",
    });
    expect(queue.cards[1]).toMatchObject({
      direction: "produce",
      headword: "word",
      answer: "es-word",
      answerLanguage: "es",
      promptLanguage: "en",
    });
    expect(queue.estimate).toBe("About two minutes.");
    expect(queue.comingUp).toEqual([
      {
        when: expect.stringMatching(/weeks|days/) as unknown as string,
        headword: null,
        language: "es",
        direction: "recognise",
      },
    ]);
    expect(queue.aheadAvailable).toBe(false);
  });

  it("keeps Learn practice to what the course taught, and completes phrases by producing", async () => {
    const api = fakeApi({
      ...signedIn,
      "GET /api/v1/lexicon/practice/due": { data: [], nextDueAt: null },
    });
    const client = createHttpClient({ fetch: api.fetch });
    await client.getSession();
    await client.getDueQueue({
      mode: "learn",
      format: "cloze",
      sessionId: "s",
    });
    const asked = api.requests
      .filter((request) => request.url.includes("/practice/due"))
      .map((request) => Object.fromEntries(new URL(request.url).searchParams));
    expect(asked).toEqual([
      {
        language: "ru",
        direction: "produce",
        format: "cloze",
        sessionId: "s",
        limit: "20",
        origin: "course",
      },
    ]);
  });

  it("shows a phrase with its gap, and accepts every answer it lists", async () => {
    const api = fakeApi({
      ...signedIn,
      "GET /api/v1/lexicon/practice/due": (request: Request) =>
        Response.json({
          data:
            new URL(request.url).searchParams.get("language") === "es"
              ? [
                  {
                    ...dueRow("c", "es", "produce", "2026-09-01T00:00:00.000Z"),
                    cloze: {
                      template: "No tenemos harina; hay que {{blank}}.",
                      answer: "apañarse",
                      acceptedAnswers: ["arreglarse"],
                      hint: "to manage",
                      languageTag: "es",
                    },
                  },
                ]
              : [],
          nextDueAt: null,
        }),
    });
    const client = createHttpClient({ fetch: api.fetch });
    await client.getSession();
    const { cards } = await client.getDueQueue({
      mode: "maintain",
      format: "cloze",
      sessionId: "s",
    });
    expect(cards).toEqual([
      expect.objectContaining({
        prompt: "No tenemos harina; hay que ___.",
        answer: "apañarse",
        accepted: ["arreglarse"],
        hint: "to manage",
      }),
    ]);
  });

  it("submits a rating as the scheduler's number, with the sitting it belongs to", async () => {
    const api = fakeApi({
      "POST /api/v1/lexicon/practice/reviews": { data: {} },
    });
    await createHttpClient({ fetch: api.fetch }).submitReview({
      cardId: "c1",
      rating: "again",
      format: "flashcard",
      sessionId: "sitting",
      submissionId: "r1",
    });
    expect(await api.requests[0]!.json()).toEqual({
      submissionId: "r1",
      cardId: "c1",
      sessionId: "sitting",
      rating: 1,
    });
  });

  it("reports retention per language and direction, and what is due now", async () => {
    const api = fakeApi({
      ...signedIn,
      "GET /api/v1/lexicon/progress": (request: Request) =>
        Response.json({
          data: [
            {
              languageTag: new URL(request.url).searchParams.get("language"),
              direction: "recognize",
              retention: 0.8,
              nextDueAt: "2026-01-01T00:00:00.000Z",
            },
            {
              languageTag: new URL(request.url).searchParams.get("language"),
              direction: "produce",
              retention: null,
              nextDueAt: null,
            },
          ],
        }),
      "GET /api/v1/lexicon/practice/due": (request: Request) => {
        const query = new URL(request.url).searchParams;
        return Response.json({
          data:
            query.get("language") === "es" &&
            query.get("direction") === "recognize"
              ? [dueRow("a", "es", "recognize", "2026-01-01T00:00:00.000Z")]
              : [],
          nextDueAt: null,
        });
      },
    });
    const client = createHttpClient({ fetch: api.fetch });
    await client.getSession();
    const summary = await client.getProgress();
    expect(summary.perLanguage).toEqual([
      {
        language: "es",
        direction: "recognise",
        retention: 0.8,
        nextDueAt: "2026-01-01T00:00:00.000Z",
        dueNow: true,
      },
      {
        language: "es",
        direction: "produce",
        retention: null,
        nextDueAt: null,
        dueNow: false,
      },
      {
        language: "ru",
        direction: "recognise",
        retention: 0.8,
        nextDueAt: "2026-01-01T00:00:00.000Z",
        dueNow: false,
      },
      {
        language: "ru",
        direction: "produce",
        retention: null,
        nextDueAt: null,
        dueNow: false,
      },
    ]);
    expect(summary.estimate).toBe("About a minute.");
  });

  it("reports a direction as due even when another fills the 20-card queue", async () => {
    const api = fakeApi({
      ...signedIn,
      "GET /api/v1/lexicon/progress": (request: Request) =>
        Response.json({
          data: ["recognize", "produce"].map((direction) => ({
            languageTag: new URL(request.url).searchParams.get("language"),
            direction,
            retention: 0.5,
            nextDueAt: null,
          })),
        }),
      "GET /api/v1/lexicon/practice/due": (request: Request) => {
        const query = new URL(request.url).searchParams;
        const lane = `${query.get("language")}:${query.get("direction")}`;
        if (lane === "es:recognize") {
          return Response.json({
            data: Array.from({ length: 20 }, (_, index) =>
              dueRow(
                `es${index}`,
                "es",
                "recognize",
                "2026-01-01T00:00:00.000Z",
              ),
            ),
            nextDueAt: null,
          });
        }
        if (lane === "ru:produce") {
          return Response.json({
            data: [
              dueRow("r1", "ru", "produce", "2026-06-01T00:00:00.000Z"),
              dueRow("r2", "ru", "produce", "2026-06-02T00:00:00.000Z"),
              dueRow("r3", "ru", "produce", "2026-06-03T00:00:00.000Z"),
            ],
            nextDueAt: null,
          });
        }
        return Response.json({ data: [], nextDueAt: null });
      },
    });
    const client = createHttpClient({ fetch: api.fetch });
    await client.getSession();
    const summary = await client.getProgress();
    expect(
      summary.perLanguage.map(
        (row) => `${row.language}:${row.direction}:${row.dueNow}`,
      ),
    ).toEqual([
      "es:recognise:true",
      "es:produce:false",
      "ru:recognise:false",
      "ru:produce:true",
    ]);
  });
});

describe("the course", () => {
  const courses = {
    courses: [
      {
        id: "russian-zero",
        languageTag: "ru",
        title: "Russian",
        description: "",
        version: 2,
        publishedAt: "",
      },
    ],
  };
  const outline = {
    course: {
      id: "russian-zero",
      version: 2,
      languageTag: "ru",
      title: "Russian",
      units: [
        {
          id: "u1",
          position: 1,
          title: "Hello",
          canDo: "Greet somebody",
          lessons: [
            {
              id: "l1",
              position: 1,
              title: "Hi",
              status: "completed",
              currentStepId: "l1-b",
              prerequisites: [],
            },
            {
              id: "l2",
              position: 2,
              title: "Bye",
              status: "in_progress",
              currentStepId: "l2-b",
              prerequisites: ["l1"],
            },
          ],
        },
        {
          id: "u2",
          position: 2,
          title: "Café",
          canDo: "Order a coffee",
          lessons: [
            {
              id: "l3",
              position: 1,
              title: "Coffee",
              status: "not_started",
              currentStepId: null,
              prerequisites: ["l2"],
            },
          ],
        },
      ],
    },
  };
  const lesson = {
    lesson: {
      id: "l2",
      unitId: "u1",
      title: "Bye",
      steps: [
        {
          id: "l2-a",
          position: 1,
          kind: "hear",
          payload: { instruction: "Listen first." },
          items: [{ itemId: "poka", role: "introduced", position: 1 }],
        },
        {
          id: "l2-b",
          position: 2,
          kind: "use",
          payload: {
            title: "Say goodbye",
            prompt: "___, до за́втра!",
            options: ["пока́", "да"],
            answer: "пока́",
            responses: { пока́: "Right.", да: "That is “yes”." },
          },
          items: [],
        },
      ],
      contentItems: [
        {
          id: "poka",
          kind: "word",
          languageTag: "ru",
          displayText: "пока",
          gloss: "bye",
          stressText: "пока́",
          grammaticalMetadata: { gender: "feminine" },
          license: {},
          provenance: {},
          audio: { kind: "recorded", url: "https://audio.example/poka.ogg" },
        },
      ],
    },
  };

  const routes = {
    ...signedIn,
    "GET /api/v1/learning/courses": courses,
    "GET /api/v1/learning/courses/russian-zero/versions/2": outline,
    "GET /api/v1/learning/courses/russian-zero/resume": {
      resume: {
        courseId: "russian-zero",
        version: 2,
        complete: false,
        unitId: "u1",
        lessonId: "l2",
        stepId: "l2-b",
      },
    },
    "GET /api/v1/learning/courses/russian-zero/versions/2/lessons/l2": lesson,
  };

  it("puts the resume card, the units and the can-do milestones together", async () => {
    const api = fakeApi(routes);
    const client = createHttpClient({ fetch: api.fetch });
    await client.getSession();
    const course = await client.getCourse();
    expect(course).toMatchObject({
      id: "russian-zero",
      version: "2",
      language: "ru",
      resume: {
        unitId: "u1",
        unitNumber: 1,
        lessonId: "l2",
        title: "Bye",
        step: "Say goodbye",
        progress: 0.5,
        canDo: "Greet somebody",
      },
      units: [
        { id: "u1", state: "current", lessonId: "l2" },
        { id: "u2", state: "locked", lessonId: null },
      ],
      milestones: [
        { id: "u1", text: "Greet somebody", reached: false },
        { id: "u2", text: "Order a coffee", reached: false },
      ],
    });
  });

  it("has no course to show when nothing is being learned", async () => {
    const api = fakeApi({
      ...routes,
      "GET /api/v1/profile": {
        data: {
          profile: {
            ...profile.data.profile,
            languages: [profile.data.profile.languages[0]],
          },
        },
      },
    });
    const client = createHttpClient({ fetch: api.fetch });
    await client.getSession();
    expect(await client.getCourse()).toBeNull();
    expect(await client.getAlphabet()).toEqual([]);
  });

  it("reads a lesson's authored steps and items, stress marks and recordings included", async () => {
    const api = fakeApi(routes);
    const client = createHttpClient({ fetch: api.fetch });
    await client.getSession();
    const read = await client.getLesson("l2");
    expect(read).toMatchObject({
      id: "l2",
      unitNumber: 1,
      canDo: "Greet somebody",
      language: "ru",
      status: "in_progress",
      currentStepId: "l2-b",
    });
    expect(read.steps[0]).toEqual({
      id: "l2-a",
      kind: "hear",
      title: "Hear it first",
      prompt: "Listen first.",
      items: [
        {
          id: "poka",
          text: "пока́",
          meaning: "bye",
          grammar: "f.",
          audioUrl: "https://audio.example/poka.ogg",
        },
      ],
    });
    expect(read.steps[1]).toMatchObject({
      kind: "use",
      title: "Say goodbye",
      options: ["пока́", "да"],
      answer: "пока́",
    });
  });

  it("records a step, and says when finishing left words to sync", async () => {
    const api = fakeApi({
      ...routes,
      "PUT /api/v1/learning/courses/russian-zero/versions/2/lessons/l2/progress":
        { progress: {} },
      "POST /api/v1/learning/courses/russian-zero/versions/2/lessons/l2/complete":
        () =>
          Response.json(
            {
              completion: {
                lexiconSync: { status: "pending", pendingItems: 1 },
              },
            },
            { status: 202 },
          ),
    });
    const client = createHttpClient({ fetch: api.fetch });
    await client.getSession();
    await client.completeLessonStep("l2", "l2-b");
    const put = api.requests.find((request) => request.method === "PUT")!;
    expect(await put.json()).toEqual({ stepId: "l2-b" });
    expect(await client.completeLesson("l2")).toEqual({ lexicon: "pending" });
  });

  it("reads letters from the alphabet references", async () => {
    const api = fakeApi({
      ...routes,
      "GET /api/v1/learning/references": {
        references: [
          {
            id: "a",
            position: 1,
            title: "А",
            body: { letter: "А", sound: "a", sameAsLatin: true },
            introducedUnitId: null,
            unlockLessonId: null,
            contentItemId: null,
            locked: false,
          },
          {
            id: "v",
            position: 2,
            title: "В",
            body: { upper: "В", lower: "в", sound: "v", looksLike: "B" },
            introducedUnitId: null,
            unlockLessonId: null,
            contentItemId: null,
            locked: false,
          },
        ],
        nextCursor: null,
      },
    });
    const client = createHttpClient({ fetch: api.fetch });
    await client.getSession();
    expect(await client.getAlphabet()).toEqual([
      { upper: "А", lower: "а", sound: "a", trap: null, sameAsLatin: true },
      {
        upper: "В",
        lower: "в",
        sound: "v",
        trap: "looks like B",
        sameAsLatin: false,
      },
    ]);
  });
});
