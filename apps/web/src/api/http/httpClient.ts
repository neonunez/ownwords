/**
 * `OwnwordsClient` answered by the Ownwords API.
 *
 * Every call carries the session cookie; the API derives the owner from the
 * verified session alone, so nothing here ever sends an owner. Recent reads are
 * reused briefly inside this verified account/profile generation, never in
 * storage or a shared cache. Writes always wait for real acknowledgement.
 */

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import {
  OwnwordsError,
  type EquivalentPatch,
  type OwnwordsClient,
} from "../client";
import type {
  AlphabetLetter,
  Course,
  DueQueue,
  Entry,
  EntryQuery,
  Language,
  LanguageLevel,
  LanguageProgress,
  Lesson,
  NewEquivalent,
  Onboarding,
  Page,
  PracticeFormat,
  PracticeScope,
  Preferences,
  ProfileLanguage,
  ReferenceTopic,
  Session,
  UpcomingItem,
} from "../types";
import { estimateFor, whenWritten } from "../../lib/time";
import { newId } from "../../lib/ids";
import { ownName } from "../../lib/languages";
import {
  byUrgency,
  directionFromWire,
  entryLanguage,
  fitToWire,
  headwordProvenance,
  headwordText,
  ratingToWire,
  readDueQueue,
  readEntry,
  readEntryPage,
  readSuggestions,
  sourceEquivalent,
  toEntry,
  toPracticeCard,
  type WireDirection,
  type WireEntry,
} from "./lexicon";
import {
  readCompletion,
  readCourses,
  readLesson,
  readLexiconWords,
  readOutline,
  readReferencePage,
  readResume,
  toCourse,
  toLesson,
  toLetter,
  toReferenceItem,
  type WireCourseSummary,
  type WireReference,
} from "./learning";
import {
  array,
  badResponse,
  boolean,
  object,
  oneOf,
  optionalString,
  string,
} from "./read";
import {
  API,
  createTransport,
  type TransportOptions,
  type RequestOptions,
} from "./request";
import { RecentReads } from "./recentReads";

export interface HttpClientOptions extends TransportOptions {
  /** The cache clock; tests can advance it without delaying real requests. */
  now?: () => number;
}

const RECENT_READ_MS = 15_000;
const COURSE_RESOLUTION_MS = 30_000;

/* ---- the profile --------------------------------------------------------- */

const LEVELS: readonly LanguageLevel[] = [
  "a0",
  "a1",
  "a2",
  "b1",
  "b2",
  "c1",
  "c2",
  "native",
];

function readProfile(value: unknown): Onboarding | null {
  const data = object(object(value, "profile").data, "profile.data");
  if (data.profile === null) return null;
  const profile = object(data.profile, "profile.profile");
  const preferences = object(profile.preferences, "profile.preferences");
  return {
    languages: array(profile.languages, "profile.languages", (item, path) => {
      const language = object(item, path);
      return {
        code: string(language.tag, `${path}.tag`),
        kind: oneOf(language.kind, `${path}.kind`, [
          "maintain",
          "learn",
        ] as const),
        level: oneOf(language.level, `${path}.level`, LEVELS),
      };
    }),
    preferences: {
      explanationsIn: oneOf(
        preferences.explanationLanguage,
        "profile.preferences.explanationLanguage",
        ["en", "es"] as const,
      ),
      audioInCourse: boolean(
        preferences.russianCourseAudio,
        "profile.preferences.russianCourseAudio",
      ),
      suggestTranslations: boolean(
        preferences.translationSuggestions,
        "profile.preferences.translationSuggestions",
      ),
    },
  };
}

function profileBody(input: Onboarding) {
  return {
    languages: input.languages.map((language) => ({
      tag: language.code,
      kind: language.kind,
      level: language.level,
    })),
    preferences: {
      explanationLanguage: input.preferences.explanationsIn,
      russianCourseAudio: input.preferences.audioInCourse,
      translationSuggestions: input.preferences.suggestTranslations,
    },
  };
}

function toLanguage(language: ProfileLanguage): Language {
  const level = language.level.toUpperCase();
  return {
    code: language.code,
    name: ownName(language.code),
    role:
      language.level === "native"
        ? "native"
        : language.kind === "learn"
          ? "learning"
          : "maintained",
    level:
      language.level === "native"
        ? "native"
        : language.kind === "learn"
          ? `learning · ${level}`
          : level,
  };
}

/** What the server verifies; the browser's extension results stay on the device. */
function withoutExtensions<T extends { clientExtensionResults?: unknown }>(
  response: T,
): Omit<T, "clientExtensionResults"> {
  const copy: Partial<T> = { ...response };
  delete copy.clientExtensionResults;
  return copy as Omit<T, "clientExtensionResults">;
}

const sameLanguage = (left: string, right: string) =>
  left.split("-")[0]?.toLowerCase() === right.split("-")[0]?.toLowerCase();

/* ---- the client ---------------------------------------------------------- */

export function createHttpClient(
  options: HttpClientOptions = {},
): OwnwordsClient {
  const transport = createTransport(options);
  const lexicon = `${API.v1}/lexicon`;
  const learning = `${API.v1}/learning`;

  let profile: Promise<Onboarding | null> | null = null;
  let accountId: string | null = null;
  let identityGeneration = 0;
  let profileGeneration = 0;
  let verifying: {
    generation: number;
    accountId: string | null;
    noticed: Set<string>;
  } | null = null;
  const recent = new RecentReads(options.now);
  const clearAccount = () => {
    identityGeneration += 1;
    profileGeneration += 1;
    accountId = null;
    profile = null;
    recent.clear();
  };
  const signedOutListeners = new Set<() => void>();
  // Same-origin tabs learn about app-managed account/profile changes. Nothing
  // here is persisted; a notice can only clear data, never grant an identity.
  const channel =
    typeof window !== "undefined" &&
    typeof window.BroadcastChannel === "function"
      ? new window.BroadcastChannel("ownwords-account")
      : null;
  const announceSignedOut = () => {
    clearAccount();
    for (const listener of signedOutListeners) listener();
  };
  if (channel)
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const notice = event.data;
      if (!notice || typeof notice !== "object") return;
      const message = notice as { type?: string; accountId?: string };
      if (
        message.type === "signed-out" ||
        (message.type === "session" &&
          accountId !== null &&
          typeof message.accountId === "string" &&
          message.accountId !== accountId)
      )
        announceSignedOut();
      else if (
        message.type === "session" &&
        accountId === null &&
        typeof message.accountId === "string"
      ) {
        if (verifying?.generation !== identityGeneration) clearAccount();
        else if (verifying.accountId === null)
          verifying.noticed.add(message.accountId);
        else if (verifying.accountId !== message.accountId) clearAccount();
      } else if (
        message.type === "profile" &&
        typeof message.accountId === "string" &&
        (accountId === null || message.accountId === accountId)
      ) {
        profileGeneration += 1;
        profile = null;
        recent.clear();
      }
    };
  const assertIdentity = (generation: number) => {
    if (generation !== identityGeneration) {
      throw new OwnwordsError(
        "session_changed",
        "Your account changed. Try again.",
        409,
      );
    }
  };
  const cacheKey = (group: string, path: string) =>
    `${group}:${JSON.stringify([accountId, profileGeneration, path])}`;
  const invalidateWrite = (path: string) => {
    // Step/completion writes cannot change the pinned enrollment's resolution.
    // Keep that small metadata read; clear every personalized course/list/progress answer.
    if (path.startsWith(learning))
      recent.clear((key) => !key.startsWith("resolution:"));
    else recent.clear();
  };
  const json = async (
    method: string,
    path: string,
    requestOptions?: RequestOptions,
  ): Promise<unknown> => {
    const generation = identityGeneration;
    const writing = method !== "GET";
    if (writing) invalidateWrite(path);
    const load = async () => {
      const value = await transport.json(method, path, requestOptions);
      assertIdentity(generation);
      return value;
    };
    try {
      // No account identity yet: reads remain uncached until getSession verifies it.
      if (!writing && accountId !== null) {
        if (path === `${learning}/courses`)
          return await recent.read(
            cacheKey("resolution", path),
            COURSE_RESOLUTION_MS,
            load,
          );
        if (path.startsWith(`${learning}/`))
          return await recent.read(
            cacheKey("learning", path),
            RECENT_READ_MS,
            load,
          );
        if (path.startsWith(`${lexicon}/entries?`))
          return await recent.read(
            cacheKey("entries", path),
            RECENT_READ_MS,
            load,
          );
      }
      return await load();
    } catch (error) {
      if (
        error instanceof OwnwordsError &&
        error.status === 401 &&
        !requestOptions?.quietWhenSignedOut &&
        generation === identityGeneration
      )
        announceSignedOut();
      if (
        error instanceof OwnwordsError &&
        error.code === "COURSE_VERSION_MISMATCH"
      )
        recent.clear();
      throw error;
    } finally {
      // Failed writes may have committed, or equivalent writes may have succeeded part-way.
      // Also evict reads that started while a write was pending.
      if (writing && generation === identityGeneration) invalidateWrite(path);
    }
  };

  /** The profile, read once and shared until something changes it. */
  const readOnboarding = (): Promise<Onboarding | null> => {
    if (!profile) {
      const generation = profileGeneration;
      const reading = json("GET", `${API.v1}/profile`).then((answer) => {
        if (generation !== profileGeneration)
          throw new OwnwordsError(
            "profile_changed",
            "Your languages changed. Try again.",
            409,
          );
        return readProfile(answer);
      });
      profile = reading;
      // A failed read is not kept: the next call asks again.
      reading.catch(() => {
        if (profile === reading) profile = null;
      });
    }
    return profile.then((current) =>
      current === null ? null : structuredClone(current),
    );
  };

  const requireOnboarding = async (): Promise<Onboarding> => {
    const current = await readOnboarding();
    if (!current) {
      throw new OwnwordsError(
        "onboarding_required",
        "Choose your languages first.",
        409,
      );
    }
    return current;
  };

  const saveProfile = async (input: Onboarding): Promise<Onboarding> => {
    profile = null;
    const generation = ++profileGeneration;
    recent.clear();
    const saved = readProfile(
      await json("PUT", `${API.v1}/onboarding`, { body: profileBody(input) }),
    );
    if (!saved)
      throw new OwnwordsError("bad_response", "The profile was not saved.");
    if (generation !== profileGeneration)
      throw new OwnwordsError(
        "profile_changed",
        "Your languages changed. Try again.",
        409,
      );
    profile = Promise.resolve(saved);
    if (accountId !== null)
      channel?.postMessage({ type: "profile", accountId });
    return structuredClone(saved);
  };

  const natives = async (): Promise<Set<string>> =>
    new Set(
      (await requireOnboarding()).languages
        .filter((language) => language.level === "native")
        .map((language) => language.code),
    );

  const readRawEntry = async (entryId: string): Promise<WireEntry> =>
    readEntry(
      object(
        await json("GET", `${lexicon}/entries/${encodeURIComponent(entryId)}`),
        "entry",
      ).data,
    );

  const entry = async (entryId: string): Promise<Entry> =>
    toEntry(await readRawEntry(entryId), await natives());

  const findEquivalent = (raw: WireEntry, senseId: string, id: string) => {
    const equivalent = raw.senses
      .find((sense) => sense.id === senseId)
      ?.equivalents.find((candidate) => candidate.id === id);
    if (!equivalent) {
      throw new OwnwordsError(
        "not_found",
        "That equivalent is no longer on this entry.",
        404,
      );
    }
    return equivalent;
  };

  const suggestFor = async (
    raw: WireEntry,
    senseId: string,
    targetLanguage: string,
    signal?: AbortSignal,
  ) => {
    const source = sourceEquivalent(raw, senseId);
    if (!source) {
      throw new OwnwordsError(
        "no_source",
        "This sense has nothing written to translate from.",
      );
    }
    const suggestions = readSuggestions(
      await json(
        "POST",
        `${lexicon}/entries/${encodeURIComponent(raw.id)}/senses/${encodeURIComponent(senseId)}/suggestions`,
        { body: { sourceEquivalentId: source.id, targetLanguage }, signal },
      ),
    );
    const first = suggestions[0];
    if (!first) {
      throw new OwnwordsError(
        "no_suggestion",
        "No suggestion came back. Type it yourself instead.",
      );
    }
    return first;
  };

  /* ---- practice ---- */

  /** The languages a mode practises, and in which directions. */
  const practiceLanes = async (
    mode: PracticeScope["mode"],
    format: PracticeFormat,
  ) => {
    const { languages } = await requireOnboarding();
    const tags =
      mode === "learn"
        ? languages.filter((language) => language.kind === "learn")
        : languages.filter((language) => language.level !== "native");
    // A phrase is completed by producing the missing word.
    const directions: WireDirection[] =
      format === "cloze" ? ["produce"] : ["recognize", "produce"];
    return tags.flatMap((language) =>
      directions.map((direction) => ({ language: language.code, direction })),
    );
  };

  const dueQueue = async (
    scope: PracticeScope,
  ): Promise<{ queue: DueQueue; dueLanes: Set<string> }> => {
    const lanes = await practiceLanes(scope.mode, scope.format);
    const answers = await Promise.all(
      lanes.map(async (lane) => {
        const query = new URLSearchParams({
          language: lane.language,
          direction: lane.direction,
          format: scope.format,
          sessionId: scope.sessionId,
          limit: "20",
        });
        // Learn practises the vocabulary of finished lessons, which the
        // Learning package schedules on its own; Maintain practises the
        // personal collection the Lexicon package schedules.
        const queue = readDueQueue(
          await json(
            "GET",
            `${scope.mode === "learn" ? learning : lexicon}/practice/due?${query}`,
          ),
        );
        return { lane, queue };
      }),
    );
    const now = Date.now();
    const cards = answers
      .flatMap((answer) => answer.queue.cards)
      .sort(byUrgency)
      .slice(0, 20)
      .map((card) => toPracticeCard(card, scope.format));
    const comingUp: UpcomingItem[] = answers
      .flatMap(({ lane, queue }) => {
        const at = queue.nextDueAt ? Date.parse(queue.nextDueAt) : NaN;
        return Number.isNaN(at) || at <= now ? [] : [{ at, lane }];
      })
      .sort((left, right) => left.at - right.at)
      .map(({ at, lane }) => ({
        when: whenWritten(at, now),
        headword: null,
        language: lane.language,
        direction: directionFromWire(lane.direction),
      }));
    const dueLanes = new Set(
      answers
        .filter(({ queue }) => queue.cards.length > 0)
        .map(
          ({ lane }) => `${lane.language}:${directionFromWire(lane.direction)}`,
        ),
    );
    return {
      queue: {
        cards,
        estimate: estimateFor(cards.length),
        comingUp,
        // The scheduler does not yet offer cards before they are due.
        aheadAvailable: false,
      },
      dueLanes,
    };
  };

  /* ---- the course ---- */

  /** The published course for the language being learned, if there is one. */
  const resolveCourse = async (): Promise<WireCourseSummary | null> => {
    const { languages } = await requireOnboarding();
    const learningLanguage = languages.find(
      (language) => language.kind === "learn",
    );
    if (!learningLanguage) return null;
    const courses = readCourses(await json("GET", `${learning}/courses`));
    return (
      courses.find((course) =>
        sameLanguage(course.languageTag, learningLanguage.code),
      ) ?? null
    );
  };

  const requireCourse = async (): Promise<WireCourseSummary> => {
    const course = await resolveCourse();
    if (!course) {
      throw new OwnwordsError(
        "no_course",
        "There is no course for the language you are learning yet.",
        404,
      );
    }
    return course;
  };

  const coursePath = (course: WireCourseSummary) =>
    `${learning}/courses/${encodeURIComponent(course.id)}/versions/${course.version}`;

  const lessonPath = (course: WireCourseSummary, lessonId: string) =>
    `${coursePath(course)}/lessons/${encodeURIComponent(lessonId)}`;

  const references = async (
    course: WireCourseSummary,
    category: string,
  ): Promise<WireReference[]> => {
    const all: WireReference[] = [];
    let cursor: string | null = "0";
    while (cursor !== null) {
      const query = new URLSearchParams({
        courseId: course.id,
        version: String(course.version),
        category,
        limit: "100",
        cursor,
      });
      const page = readReferencePage(
        await json("GET", `${learning}/references?${query}`),
      );
      all.push(...page.references);
      cursor = page.nextCursor;
    }
    return all;
  };

  const client: OwnwordsClient = {
    kind: "http",
    onSignedOut(listener) {
      signedOutListeners.add(listener);
      return () => signedOutListeners.delete(listener);
    },

    /* ---- the account ---- */

    async getSession(): Promise<Session> {
      clearAccount();
      const generation = identityGeneration;
      const profileVersion = profileGeneration;
      const check: NonNullable<typeof verifying> = {
        generation,
        accountId: null,
        noticed: new Set<string>(),
      };
      verifying = check;
      const session = await json("GET", `${API.auth}/get-session`, {
        quietWhenSignedOut: true,
      });
      if (session === null) {
        profile = null;
        return { status: "signed-out" };
      }
      const user = object(object(session, "session").user, "session.user");
      const verifiedAccountId = string(user.id, "session.user.id");
      check.accountId = verifiedAccountId;
      if ([...check.noticed].some((noticed) => noticed !== verifiedAccountId))
        clearAccount();
      assertIdentity(generation);
      profile = null;
      try {
        const onboarding = await json("GET", `${API.v1}/profile`, {
          quietWhenSignedOut: true,
        }).then(readProfile);
        assertIdentity(generation);
        if (profileVersion !== profileGeneration)
          throw new OwnwordsError(
            "profile_changed",
            "Your languages changed. Try again.",
            409,
          );
        accountId = verifiedAccountId;
        profile = Promise.resolve(onboarding);
        channel?.postMessage({ type: "session", accountId });
        return {
          status: "signed-in",
          account: {
            name: string(user.name, "session.user.name"),
            email: string(user.email, "session.user.email"),
          },
          onboarding: onboarding === null ? null : structuredClone(onboarding),
        };
      } catch (error) {
        assertIdentity(generation);
        // A session the API does not accept (no invitation) is no session.
        if (error instanceof OwnwordsError && error.status === 401) {
          clearAccount();
          return { status: "signed-out" };
        }
        throw error;
      }
    },

    async redeemInvitation(code, email) {
      await json("POST", `${API.v1}/invitations/redeem`, {
        body: { code: code.trim(), email: email.trim() },
      });
    },

    async startGoogleSignIn() {
      const answer = object(
        await json("POST", `${API.auth}/sign-in/social`, {
          body: {
            provider: "google",
            callbackURL: "/",
            errorCallbackURL: "/",
          },
        }),
        "signIn",
      );
      const url = string(answer.url, "signIn.url");
      // The browser is sent there next, so only a real HTTPS address will do.
      let protocol = "";
      try {
        protocol = new URL(url).protocol;
      } catch {
        // Not an address at all.
      }
      if (protocol !== "https:") throw badResponse("signIn.url");
      return url;
    },

    async signInWithPasskey() {
      if (!browserSupportsWebAuthn()) {
        throw new OwnwordsError(
          "passkey_unsupported",
          "This browser cannot use passkeys.",
        );
      }
      const optionsJSON = (await json(
        "GET",
        `${API.auth}/passkey/generate-authenticate-options`,
      )) as PublicKeyCredentialRequestOptionsJSON;
      let response;
      try {
        response = await startAuthentication({ optionsJSON });
      } catch {
        throw new OwnwordsError(
          "passkey_cancelled",
          "No passkey was used, so nothing changed.",
        );
      }
      await json("POST", `${API.auth}/passkey/verify-authentication`, {
        body: { response: withoutExtensions(response) },
      });
      clearAccount();
    },

    async addPasskey() {
      if (!browserSupportsWebAuthn()) {
        throw new OwnwordsError(
          "passkey_unsupported",
          "This browser cannot use passkeys.",
        );
      }
      const optionsJSON = (await json(
        "GET",
        `${API.auth}/passkey/generate-register-options`,
      )) as PublicKeyCredentialCreationOptionsJSON;
      let response;
      try {
        response = await startRegistration({ optionsJSON });
      } catch {
        throw new OwnwordsError(
          "passkey_cancelled",
          "No passkey was added, so nothing changed.",
        );
      }
      await json("POST", `${API.auth}/passkey/verify-registration`, {
        body: { response: withoutExtensions(response), name: "Ownwords" },
      });
    },

    async signOut() {
      // Clear immediately, even if the acknowledgement fails or old reads finish late.
      clearAccount();
      await json("POST", `${API.auth}/sign-out`, { body: {} });
      channel?.postMessage({ type: "signed-out" });
    },

    saveOnboarding: saveProfile,

    async exportAccount() {
      const response = await transport.request(
        "GET",
        `${API.v1}/account/export`,
      );
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const named = /filename="([^"]+)"/.exec(disposition)?.[1];
      return {
        filename:
          named ??
          `ownwords-export-${new Date().toISOString().slice(0, 10)}.json`,
        blob: await response.blob(),
      };
    },

    /* ---- the collection ---- */

    async listLanguages(): Promise<Language[]> {
      return (await requireOnboarding()).languages.map(toLanguage);
    },

    async listEntries(query: EntryQuery = {}): Promise<Page<Entry>> {
      const params = new URLSearchParams();
      const search = query.search?.trim().slice(0, 100);
      if (search) params.set("query", search);
      if (query.language) params.set("language", query.language);
      if (query.kind) params.set("kind", query.kind);
      if (query.unverifiedOnly) params.set("verification", "unverified");
      if (query.mastery)
        params.set("mastery", query.mastery === "weak" ? "due" : "mastered");
      if (query.cursor) params.set("cursor", query.cursor);
      if (query.limit) params.set("limit", String(query.limit));
      const [page, native] = await Promise.all([
        json("GET", `${lexicon}/entries?${params}`).then(readEntryPage),
        natives(),
      ]);
      const result: Page<Entry> = {
        items: page.entries.map((raw) => toEntry(raw, native)),
      };
      if (page.nextCursor) result.nextCursor = page.nextCursor;
      return result;
    },

    getEntry: entry,

    async createEntry(input) {
      const headword = input.headword.trim();
      const gloss = input.senseGloss?.trim();
      const created = readEntry(
        object(
          await json("POST", `${lexicon}/entries`, {
            body: {
              kind: input.kind,
              note: input.note.trim() || null,
              provenance: headwordProvenance(input.language),
              senses: [
                {
                  gloss: gloss || null,
                  equivalents: [
                    {
                      languageTag: input.language,
                      text: headword,
                      status: "manual",
                      fit: "exact",
                    },
                  ],
                },
              ],
            },
          }),
          "created",
        ).data,
      );
      return toEntry(created, await natives());
    },

    async updateEntry(entryId, patch) {
      const body: Record<string, unknown> = { version: patch.version };
      if (patch.note !== undefined) body.note = patch.note.trim() || null;
      if (patch.kind !== undefined) body.kind = patch.kind;
      const updated = readEntry(
        object(
          await json(
            "PATCH",
            `${lexicon}/entries/${encodeURIComponent(entryId)}`,
            { body },
          ),
          "updated",
        ).data,
      );
      return toEntry(updated, await natives());
    },

    async deleteEntry(entryId, version) {
      await json(
        "DELETE",
        `${lexicon}/entries/${encodeURIComponent(entryId)}`,
        {
          headers: { "If-Match": `"${version}"` },
        },
      );
    },

    async requestSuggestions(target, into, onResult, signal) {
      const raw = await readRawEntry(target.id);
      const sense = raw.senses[0];
      if (!sense) return;
      await Promise.all(
        into.map(async (language) => {
          try {
            const suggestion = await suggestFor(
              raw,
              sense.id,
              language,
              signal,
            );
            if (signal?.aborted) return;
            onResult({
              language,
              state: "suggested",
              text: suggestion.text,
              fit:
                suggestion.fit === "context_only"
                  ? "context-only"
                  : suggestion.fit,
            });
          } catch (error) {
            if (signal?.aborted) return;
            onResult({
              language,
              state: "failed",
              text: "",
              reason:
                error instanceof OwnwordsError
                  ? error.message
                  : "Translation failed. Nothing was dropped.",
            });
          }
        }),
      );
    },

    async addEquivalents(
      entryId,
      senseId,
      equivalents: readonly NewEquivalent[],
    ) {
      const path = `${lexicon}/entries/${encodeURIComponent(entryId)}/senses/${encodeURIComponent(senseId)}/equivalents`;
      // One at a time, so a failure part-way leaves the ones before it stored
      // and the entry, read again, shows exactly what was kept.
      for (const equivalent of equivalents) {
        const failed = equivalent.state === "failed";
        await json("POST", path, {
          body: {
            languageTag: equivalent.language,
            text: failed ? null : equivalent.text.trim(),
            status: equivalent.state,
            ...(equivalent.fit && !failed
              ? { fit: fitToWire(equivalent.fit) }
              : {}),
          },
        });
      }
      return entry(entryId);
    },

    async updateEquivalent(
      entryId,
      senseId,
      equivalentId,
      patch: EquivalentPatch,
    ) {
      const body: Record<string, unknown> = { version: patch.version };
      if (patch.text !== undefined) {
        body.text = patch.text.trim();
        body.status = patch.state ?? "manual";
      } else if (patch.state !== undefined) {
        body.status = patch.state;
      }
      if (patch.fit !== undefined) body.fit = fitToWire(patch.fit);
      await json(
        "PATCH",
        `${lexicon}/entries/${encodeURIComponent(entryId)}/senses/${encodeURIComponent(senseId)}/equivalents/${encodeURIComponent(equivalentId)}`,
        { body },
      );
      return entry(entryId);
    },

    async retryTranslation(entryId, senseId, equivalentId) {
      const raw = await readRawEntry(entryId);
      const target = findEquivalent(raw, senseId, equivalentId);
      const suggestion = await suggestFor(raw, senseId, target.languageTag);
      await json(
        "PATCH",
        `${lexicon}/entries/${encodeURIComponent(entryId)}/senses/${encodeURIComponent(senseId)}/equivalents/${encodeURIComponent(equivalentId)}`,
        {
          body: {
            version: target.version,
            text: suggestion.text,
            fit: suggestion.fit,
            status: "suggested",
          },
        },
      );
      return entry(entryId);
    },

    async addSense(entryId, gloss) {
      const text = gloss.trim();
      if (!text) {
        throw new OwnwordsError(
          "invalid_request",
          "A sense needs a gloss that says what it means.",
          400,
        );
      }
      const raw = await readRawEntry(entryId);
      // Every sense carries the headword, so it can be translated and practised on its own.
      await json(
        "POST",
        `${lexicon}/entries/${encodeURIComponent(entryId)}/senses`,
        {
          body: {
            gloss: text,
            equivalents: [
              {
                languageTag: entryLanguage(raw),
                text: headwordText(raw),
                status: "manual",
                fit: "exact",
              },
            ],
          },
        },
      );
      return entry(entryId);
    },

    // The backend offers no starter expressions yet, so an empty Lexicon
    // offers none rather than inventing some.
    async listStarters() {
      return [];
    },

    async addStarter() {
      throw new OwnwordsError(
        "not_available",
        "Starter expressions are not offered yet.",
        404,
      );
    },

    /* ---- practice and progress ---- */

    async getDueQueue(scope) {
      if (scope.ahead) {
        return { cards: [], estimate: "", comingUp: [], aheadAvailable: false };
      }
      return (await dueQueue(scope)).queue;
    },

    async submitReview(submission) {
      await json(
        "POST",
        `${submission.mode === "learn" ? learning : lexicon}/practice/reviews`,
        {
          body: {
            submissionId: submission.submissionId,
            cardId: submission.cardId,
            sessionId: submission.sessionId,
            rating: ratingToWire[submission.rating],
          },
        },
      );
    },

    async getProgress() {
      const load = async () => {
        const { languages } = await requireOnboarding();
        const practised = languages.filter(
          (language) => language.level !== "native",
        );
        const [rows, { queue, dueLanes }] = await Promise.all([
          Promise.all(
            practised.map(async (language) => {
              const answer = object(
                await json(
                  "GET",
                  `${lexicon}/progress?${new URLSearchParams({ language: language.code })}`,
                ),
                "progress",
              );
              return array(answer.data, "progress.data", (item, path) => {
                const row = object(item, path);
                const retention = row.retention;
                return {
                  language: language.code,
                  direction: directionFromWire(
                    oneOf(row.direction, `${path}.direction`, [
                      "recognize",
                      "produce",
                    ] as const),
                  ),
                  retention:
                    typeof retention === "number" && Number.isFinite(retention)
                      ? retention
                      : null,
                  nextDueAt: optionalString(row.nextDueAt, `${path}.nextDueAt`),
                };
              });
            }),
          ),
          // What is due is what the practice tab would ask now; a fresh session
          // id reads it without touching any sitting in progress.
          dueQueue({
            mode: "maintain",
            format: "flashcard",
            sessionId: newId(),
          }),
        ]);
        const perLanguage: LanguageProgress[] = rows.flat().map((row) => ({
          ...row,
          dueNow: dueLanes.has(`${row.language}:${row.direction}`),
        }));
        return {
          perLanguage,
          estimate: queue.estimate,
          comingUp: queue.comingUp,
        };
      };
      if (accountId === null) return load();
      return recent.read(cacheKey("progress", "summary"), RECENT_READ_MS, load);
    },

    /* ---- the course ---- */

    async getCourse(): Promise<Course | null> {
      const course = await resolveCourse();
      if (!course) return null;
      const [outline, resume] = await Promise.all([
        json("GET", coursePath(course)).then(readOutline),
        json(
          "GET",
          `${learning}/courses/${encodeURIComponent(course.id)}/resume`,
        ).then(readResume),
      ]);
      const resumeLesson = resume.complete
        ? null
        : readLesson(await json("GET", lessonPath(course, resume.lessonId)));
      return toCourse(outline, resume, resumeLesson);
    },

    async getLesson(lessonId): Promise<Lesson> {
      const course = await requireCourse();
      const [lesson, outline] = await Promise.all([
        json("GET", lessonPath(course, lessonId)).then(readLesson),
        json("GET", coursePath(course)).then(readOutline),
      ]);
      return toLesson(lesson, outline);
    },

    async completeLessonStep(lessonId, stepId) {
      const course = await requireCourse();
      await json("PUT", `${lessonPath(course, lessonId)}/progress`, {
        body: { stepId },
      });
    },

    async completeLesson(lessonId) {
      const course = await requireCourse();
      return readCompletion(
        await json("POST", `${lessonPath(course, lessonId)}/complete`),
      );
    },

    async addLessonWordsToLexicon(lessonId) {
      const course = await requireCourse();
      return readLexiconWords(
        await json("POST", `${lessonPath(course, lessonId)}/lexicon`),
      );
    },

    async getAlphabet(): Promise<AlphabetLetter[]> {
      const course = await resolveCourse();
      if (!course) return [];
      return (await references(course, "alphabet")).flatMap((reference) => {
        const letter = toLetter(reference);
        return letter ? [letter] : [];
      });
    },

    async listReferenceTopics(): Promise<ReferenceTopic[]> {
      const course = await resolveCourse();
      if (!course) return [];
      const [outline, ...categories] = await Promise.all([
        json("GET", coursePath(course)).then(readOutline),
        ...topics.map((topic) =>
          Promise.all(
            topic.categories.map((category) => references(course, category)),
          ).then((pages) => pages.flat()),
        ),
      ]);
      const unitNumber = new Map(
        outline.units.map((unit) => [unit.id, unit.position]),
      );
      return topics.map((topic, index) => {
        const items = categories[index] ?? [];
        const introduced = items
          .map((item) =>
            item.introducedUnitId
              ? unitNumber.get(item.introducedUnitId)
              : undefined,
          )
          .filter((value): value is number => value !== undefined)
          .sort((left, right) => left - right)[0];
        const open = items.filter((item) => !item.locked);
        return {
          id: topic.id,
          title: topic.title,
          icon: topic.icon,
          summary: open.length
            ? open
                .slice(0, 3)
                .map((item) => item.title)
                .join(" · ")
            : items.length
              ? "Unlocks as the course goes on"
              : "Nothing here yet",
          introducedIn: introduced === undefined ? "" : `Unit ${introduced}`,
          locked: items.length > 0 && open.length === 0,
          items: items.map(toReferenceItem),
        };
      });
    },

    /* ---- preferences ---- */

    async getPreferences(): Promise<Preferences> {
      const { preferences } = await requireOnboarding();
      // Reminders are asked for after install; nothing stores them yet.
      return { ...preferences, reminders: "after-install" };
    },

    async savePreferences(next) {
      const current = await requireOnboarding();
      const saved = await saveProfile({
        languages: current.languages,
        preferences: {
          explanationsIn: next.explanationsIn,
          audioInCourse: next.audioInCourse,
          suggestTranslations: next.suggestTranslations,
        },
      });
      return { ...saved.preferences, reminders: "after-install" };
    },
  };
  // Fence complete multi-request methods too: a late old-account response must
  // not combine with later reads or escape to a caller after account rotation.
  const reads = new Set([
    "listLanguages",
    "listEntries",
    "getEntry",
    "getDueQueue",
    "getProgress",
    "getCourse",
    "getLesson",
    "getAlphabet",
    "listReferenceTopics",
    "getPreferences",
  ]);
  for (const [name, candidate] of Object.entries(client)) {
    if (
      typeof candidate !== "function" ||
      ["onSignedOut", "getSession", "signOut", "signInWithPasskey"].includes(
        name,
      )
    )
      continue;
    const operation = candidate as (...args: unknown[]) => Promise<unknown>;
    Object.assign(client, {
      [name]: async (...args: unknown[]) => {
        const generation = identityGeneration;
        const profileVersion = profileGeneration;
        try {
          const result = await operation(...args);
          assertIdentity(generation);
          if (reads.has(name) && profileVersion !== profileGeneration)
            throw new OwnwordsError(
              "profile_changed",
              "Your languages changed. Try again.",
              409,
            );
          return result;
        } catch (error) {
          if (
            error instanceof OwnwordsError &&
            error.code === "bad_response" &&
            generation === identityGeneration
          )
            recent.clear();
          if (
            error instanceof OwnwordsError &&
            error.status === 401 &&
            generation === identityGeneration
          )
            announceSignedOut();
          throw error;
        }
      },
    });
  }
  return client;
}

/** The Reference tab's topics, and the content categories each one gathers. */
const topics = [
  {
    id: "grammar",
    title: "Grammar and verbs",
    icon: "book-open",
    categories: ["grammar", "verbs"],
  },
  {
    id: "phrases",
    title: "Phrases",
    icon: "message-circle",
    categories: ["phrases"],
  },
  {
    id: "intonation",
    title: "Intonation",
    // A text topic about how a question is written, so it takes a text icon:
    // the app ships no recordings and no waveform.
    icon: "type",
    categories: ["intonation"],
  },
  { id: "numbers", title: "Numbers", icon: "hash", categories: ["numbers"] },
  {
    id: "vocabulary",
    title: "Course vocabulary",
    icon: "library",
    categories: ["course_vocabulary"],
  },
] as const;
