import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z][a-z0-9_-]*$/,
    "must start with a lowercase letter and contain only a-z, 0-9, _ or -",
  );
const languageTag = z
  .string()
  .min(2)
  .max(35)
  .regex(
    /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/,
    "must be a BCP 47-style language tag",
  );
const shortText = z.string().trim().min(1).max(200);
const longText = z.string().trim().min(1).max(4_000);
const safeHttpsUrl = z
  .url()
  .max(2_048)
  .superRefine((value, ctx) => {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      ctx.addIssue({ code: "custom", message: "only https URLs are allowed" });
    }
    if (url.username || url.password) {
      ctx.addIssue({
        code: "custom",
        message: "URL credentials are not allowed",
      });
    }
  });

const jsonObject = z
  .record(z.string().max(100), z.unknown())
  .superRefine((value, ctx) => {
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "must be JSON serializable" });
      return;
    }
    if (serialized.length > 32_000) {
      ctx.addIssue({ code: "custom", message: "JSON payload exceeds 32 KB" });
    }
    const unsafe = ["__proto__", "prototype", "constructor"];
    const visit = (input: unknown, depth: number): boolean => {
      if (depth > 12) return false;
      if (Array.isArray(input))
        return (
          input.length <= 100 && input.every((entry) => visit(entry, depth + 1))
        );
      if (input !== null && typeof input === "object") {
        const entries = Object.entries(input as Record<string, unknown>);
        return (
          entries.length <= 100 &&
          entries.every(
            ([key, entry]) => !unsafe.includes(key) && visit(entry, depth + 1),
          )
        );
      }
      return (
        input === null || ["string", "number", "boolean"].includes(typeof input)
      );
    };
    if (!visit(value, 0)) {
      ctx.addIssue({
        code: "custom",
        message: "contains unsafe, overly deep, or non-JSON data",
      });
    }
  });

const licenseSchema = z
  .object({
    spdxId: z.string().trim().min(1).max(80),
    sourceName: shortText,
    sourceUrl: safeHttpsUrl.optional(),
    attribution: z.string().trim().max(500).optional(),
  })
  .strict();

const provenanceSchema = z
  .object({
    sourceName: shortText,
    sourceUrl: safeHttpsUrl.optional(),
    author: z.string().trim().min(1).max(200),
    note: z.string().trim().max(1_000).optional(),
  })
  .strict();

/**
 * Optional recorded-audio metadata. Nothing in the app reads it: Ownwords
 * ships a course the learner reads and says aloud, because no commercially
 * clear, complete recording set exists for its phrases (see
 * `content/README.md`). The slot stays so a future pack of original
 * recordings can be stored without a schema or migration change; the web app
 * has no playback control and no audio preference.
 */
const audioSchema = z
  .object({
    kind: z.literal("recorded"),
    url: safeHttpsUrl,
    mediaType: z.enum(["audio/mpeg", "audio/ogg", "audio/webm", "audio/wav"]),
    license: licenseSchema,
    provenance: provenanceSchema,
    durationMs: z.number().int().positive().max(600_000).optional(),
  })
  .strict();

const itemSchema = z
  .object({
    id,
    kind: z.enum(["word", "expression"]),
    languageTag,
    displayText: shortText,
    gloss: shortText,
    stressText: z.string().trim().min(1).max(200).optional(),
    grammaticalMetadata: jsonObject.default({}),
    license: licenseSchema,
    provenance: provenanceSchema,
    audio: audioSchema.optional(),
  })
  .strict();

const stepItemSchema = z
  .object({
    itemId: id,
    role: z.enum(["introduced", "reviewed"]),
    position: z.number().int().positive(),
  })
  .strict();

const stepSchema = z
  .object({
    id,
    position: z.number().int().positive(),
    // "hear" is a legacy name for the read-aloud step: the learner looks at
    // the words and says them. The value is persisted, so it keeps its name.
    kind: z.enum(["hear", "rule", "use", "perception", "alphabet"]),
    payload: jsonObject,
    items: z.array(stepItemSchema).max(100).default([]),
  })
  .strict();

const lessonSchema = z
  .object({
    id,
    position: z.number().int().positive(),
    title: shortText,
    prerequisites: z.array(id).max(100).default([]),
    steps: z.array(stepSchema).min(1).max(100),
  })
  .strict();

const unitSchema = z
  .object({
    id,
    position: z.number().int().positive(),
    title: shortText,
    canDo: longText,
    lessons: z.array(lessonSchema).min(1).max(100),
  })
  .strict();

const referenceSchema = z
  .object({
    id,
    category: z.enum([
      "alphabet",
      "grammar",
      "verbs",
      "phrases",
      "intonation",
      "numbers",
      "course_vocabulary",
    ]),
    position: z.number().int().positive(),
    title: shortText,
    body: jsonObject,
    introducedUnitId: id.optional(),
    unlockLessonId: id.optional(),
    contentItemId: id.optional(),
  })
  .strict();

export const contentPackSchema = z
  .object({
    course: z
      .object({
        id,
        languageTag,
        title: shortText,
        description: longText,
      })
      .strict(),
    version: z.number().int().positive().max(1_000_000),
    units: z.array(unitSchema).min(1).max(100),
    items: z.array(itemSchema).min(1).max(5_000),
    references: z.array(referenceSchema).min(1).max(5_000),
  })
  .strict();

export type ContentPack = z.infer<typeof contentPackSchema>;
export type ContentItem = z.infer<typeof itemSchema>;

export class ContentValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid content pack: ${issues.join("; ")}`);
    this.name = "ContentValidationError";
  }
}

function assertUnique(
  values: readonly string[],
  label: string,
  issues: string[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) issues.push(`${label} '${value}' is duplicated`);
    seen.add(value);
  }
}

function assertContiguous(
  positions: readonly number[],
  label: string,
  issues: string[],
): void {
  const sorted = [...positions].sort((a, b) => a - b);
  sorted.forEach((position, index) => {
    if (position !== index + 1)
      issues.push(`${label} positions must be contiguous from 1`);
  });
}

export function validateContentPack(input: unknown): ContentPack {
  const parsed = contentPackSchema.safeParse(input);
  if (!parsed.success) {
    throw new ContentValidationError(
      parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`,
      ),
    );
  }

  const pack = parsed.data;
  const issues: string[] = [];
  assertUnique(
    pack.units.map((unit) => unit.id),
    "unit id",
    issues,
  );
  assertUnique(
    pack.items.map((item) => item.id),
    "item id",
    issues,
  );
  assertUnique(
    pack.references.map((reference) => reference.id),
    "reference id",
    issues,
  );
  assertContiguous(
    pack.units.map((unit) => unit.position),
    "unit",
    issues,
  );

  const units = new Set(pack.units.map((unit) => unit.id));
  const items = new Set(pack.items.map((item) => item.id));
  const lessonOrder = new Map<string, number>();
  const lessonIds: string[] = [];
  const stepIds: string[] = [];
  const introducedBy = new Map<string, string>();
  const linkedItems = new Set<string>();
  let order = 0;

  for (const unit of [...pack.units].sort((a, b) => a.position - b.position)) {
    assertContiguous(
      unit.lessons.map((lesson) => lesson.position),
      `lessons in unit '${unit.id}'`,
      issues,
    );
    for (const lesson of [...unit.lessons].sort(
      (a, b) => a.position - b.position,
    )) {
      lessonIds.push(lesson.id);
      lessonOrder.set(lesson.id, order++);
      assertUnique(
        lesson.prerequisites,
        `prerequisite in lesson '${lesson.id}'`,
        issues,
      );
      assertContiguous(
        lesson.steps.map((step) => step.position),
        `steps in lesson '${lesson.id}'`,
        issues,
      );
      for (const step of lesson.steps) {
        stepIds.push(step.id);
        assertContiguous(
          step.items.map((item) => item.position),
          `items in step '${step.id}'`,
          issues,
        );
        assertUnique(
          step.items.map((item) => item.itemId),
          `item in step '${step.id}'`,
          issues,
        );
        for (const link of step.items) {
          linkedItems.add(link.itemId);
          if (!items.has(link.itemId)) {
            issues.push(
              `step '${step.id}' references missing item '${link.itemId}'`,
            );
          }
          if (link.role !== "introduced") continue;
          const owner = introducedBy.get(link.itemId);
          if (owner === undefined) {
            introducedBy.set(link.itemId, lesson.id);
          } else if (owner !== lesson.id) {
            issues.push(
              `item '${link.itemId}' is introduced by lessons '${owner}' and '${lesson.id}'; each item may be introduced by only one lesson`,
            );
          }
        }
      }
    }
  }
  assertUnique(lessonIds, "lesson id", issues);
  assertUnique(stepIds, "step id", issues);

  for (const item of pack.items) {
    if (
      item.languageTag.toLowerCase() !== pack.course.languageTag.toLowerCase()
    ) {
      issues.push(`item '${item.id}' language must match the course language`);
    }
  }
  // Only an introducing lesson exports an item, so an item a lesson uses but
  // none introduces would never reach the learner's Lexicon.
  for (const itemId of linkedItems) {
    if (!introducedBy.has(itemId)) {
      issues.push(
        `item '${itemId}' is used by a lesson but no lesson introduces it`,
      );
    }
  }

  for (const unit of pack.units) {
    for (const lesson of unit.lessons) {
      const currentOrder = lessonOrder.get(lesson.id);
      for (const prerequisite of lesson.prerequisites) {
        const prerequisiteOrder = lessonOrder.get(prerequisite);
        if (prerequisiteOrder === undefined) {
          issues.push(
            `lesson '${lesson.id}' references missing prerequisite '${prerequisite}'`,
          );
        } else if (
          currentOrder !== undefined &&
          prerequisiteOrder >= currentOrder
        ) {
          issues.push(
            `lesson '${lesson.id}' prerequisite '${prerequisite}' must come earlier`,
          );
        }
      }
    }
  }

  const categoryPositions = new Map<string, number[]>();
  for (const reference of pack.references) {
    const positions = categoryPositions.get(reference.category) ?? [];
    positions.push(reference.position);
    categoryPositions.set(reference.category, positions);
    if (reference.introducedUnitId && !units.has(reference.introducedUnitId)) {
      issues.push(
        `reference '${reference.id}' links missing unit '${reference.introducedUnitId}'`,
      );
    }
    if (
      reference.unlockLessonId &&
      !lessonOrder.has(reference.unlockLessonId)
    ) {
      issues.push(
        `reference '${reference.id}' links missing lesson '${reference.unlockLessonId}'`,
      );
    }
    if (reference.contentItemId && !items.has(reference.contentItemId)) {
      issues.push(
        `reference '${reference.id}' links missing item '${reference.contentItemId}'`,
      );
    }
    if (
      reference.category === "course_vocabulary" &&
      !reference.contentItemId
    ) {
      issues.push(
        `course vocabulary reference '${reference.id}' must link a content item`,
      );
    }
  }
  for (const [category, positions] of categoryPositions) {
    assertContiguous(positions, `references in category '${category}'`, issues);
  }

  if (issues.length > 0) throw new ContentValidationError([...new Set(issues)]);
  return pack;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function contentHash(pack: ContentPack): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(pack));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
