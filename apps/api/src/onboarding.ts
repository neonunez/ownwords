import { Hono } from "hono";
import { z } from "zod";
import { errorResponse } from "./errors.js";
import type { AppEnv } from "./types.js";

const LEVELS = ["a0", "a1", "a2", "b1", "b2", "c1", "c2", "native"] as const;

function canonicalLanguageTag(value: string): string | null {
  try {
    const [tag] = Intl.getCanonicalLocales(value);
    return tag ?? null;
  } catch {
    return null;
  }
}

const languageSchema = z
  .object({
    tag: z.string().trim().min(2).max(35),
    kind: z.enum(["maintain", "learn"]),
    level: z.enum(LEVELS),
  })
  .strict()
  .transform((language, context) => {
    const tag = canonicalLanguageTag(language.tag);
    if (!tag) {
      context.addIssue({
        code: "custom",
        message: "Invalid BCP 47 language tag",
        path: ["tag"],
      });
      return z.NEVER;
    }
    return { ...language, tag };
  });

export const onboardingSchema = z
  .object({
    languages: z.array(languageSchema).min(1).max(12),
    preferences: z
      .object({
        explanationLanguage: z.enum(["en", "es"]),
        russianCourseAudio: z.boolean(),
        translationSuggestions: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.languages.forEach((language, index) => {
      const key = language.tag.toLowerCase();
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Each language may appear only once",
          path: ["languages", index, "tag"],
        });
      }
      seen.add(key);
    });
  });

type OnboardingInput = z.infer<typeof onboardingSchema>;

interface ProfileRow {
  explanationLanguage: "en" | "es";
  russianCourseAudio: number;
  translationSuggestions: number;
  completedAt: number;
}

interface LanguageRow {
  id: string;
  tag: string;
  kind: "maintain" | "learn";
  level: (typeof LEVELS)[number];
}

function serializeProfile(profile: ProfileRow, languages: LanguageRow[]) {
  return {
    completedAt: new Date(profile.completedAt).toISOString(),
    languages: languages.map(({ id, tag, kind, level }) => ({
      id,
      tag,
      kind,
      level,
    })),
    preferences: {
      explanationLanguage: profile.explanationLanguage,
      russianCourseAudio: Boolean(profile.russianCourseAudio),
      translationSuggestions: Boolean(profile.translationSuggestions),
    },
  };
}

async function readProfile(db: D1Database, userId: string) {
  const profile = await db
    .prepare(
      `SELECT explanation_language AS explanationLanguage,
              russian_course_audio AS russianCourseAudio,
              translation_suggestions AS translationSuggestions,
              onboarding_completed_at AS completedAt
       FROM user_profiles
       WHERE user_id = ?`,
    )
    .bind(userId)
    .first<ProfileRow>();
  if (!profile) return null;

  const languages = await db
    .prepare(
      `SELECT id, language_tag AS tag, kind, level
       FROM language_profiles
       WHERE user_id = ?
       ORDER BY order_index ASC`,
    )
    .bind(userId)
    .all<LanguageRow>();
  return serializeProfile(profile, languages.results);
}

async function replaceOnboarding(
  db: D1Database,
  userId: string,
  input: OnboardingInput,
  now: number,
): Promise<void> {
  const statements = [
    db
      .prepare(
        `INSERT INTO user_profiles
          (user_id, explanation_language, russian_course_audio,
           translation_suggestions, onboarding_completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           explanation_language = excluded.explanation_language,
           russian_course_audio = excluded.russian_course_audio,
           translation_suggestions = excluded.translation_suggestions,
           onboarding_completed_at = excluded.onboarding_completed_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        userId,
        input.preferences.explanationLanguage,
        Number(input.preferences.russianCourseAudio),
        Number(input.preferences.translationSuggestions),
        now,
        now,
        now,
      ),
    db.prepare("DELETE FROM language_profiles WHERE user_id = ?").bind(userId),
    ...input.languages.map((language, index) =>
      db
        .prepare(
          `INSERT INTO language_profiles
            (id, user_id, language_tag, kind, level, order_index, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          userId,
          language.tag,
          language.kind,
          language.level,
          index,
          now,
          now,
        ),
    ),
  ];
  const results = await db.batch(statements);
  if (results.some((result) => !result.success)) {
    throw new Error("Onboarding profile update failed");
  }
}

export function createOnboardingRoutes(
  now: () => number = Date.now,
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/profile", async (c) => {
    const profile = await readProfile(c.env.DB, c.get("userId"));
    return c.json({ data: { profile } });
  });

  routes.put("/onboarding", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(
        400,
        "invalid_request",
        "A JSON request body is required",
      );
    }
    const parsed = onboardingSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        400,
        "invalid_request",
        "The onboarding profile is invalid",
      );
    }

    const userId = c.get("userId");
    await replaceOnboarding(c.env.DB, userId, parsed.data, now());
    const profile = await readProfile(c.env.DB, userId);
    return c.json({ data: { profile } });
  });

  return routes;
}
