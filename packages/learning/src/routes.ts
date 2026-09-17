import { Hono } from "hono";
import { z } from "zod";
import type { CreateLearningRoutesOptions, LearningEnv } from "./contracts";
import { all, first, parseJsonObject } from "./db";
import { errorResponse, LearningError } from "./errors";

const routeId = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const category = z.enum([
  "alphabet",
  "grammar",
  "verbs",
  "phrases",
  "intonation",
  "numbers",
  "course_vocabulary",
]);
const progressBody = z.object({ stepId: routeId }).strict();

interface LessonRow {
  lesson_id: string;
  unit_id: string;
  lesson_position: number;
  unit_position: number;
  title: string;
  progress_status: "in_progress" | "completed" | null;
  current_step_id: string | null;
}

interface StepRow {
  step_id: string;
  lesson_id: string;
  position: number;
  kind: string;
  payload_json: string;
}

interface ContentItemRow {
  item_id: string;
  kind: "word" | "expression";
  language_tag: string;
  display_text: string;
  gloss: string;
  stress_text: string | null;
  grammatical_metadata_json: string;
  license_json: string;
  provenance_json: string;
  audio_json: string | null;
}

function contentItemResponse(row: ContentItemRow) {
  return {
    id: row.item_id,
    kind: row.kind,
    languageTag: row.language_tag,
    displayText: row.display_text,
    gloss: row.gloss,
    stressText: row.stress_text,
    grammaticalMetadata: parseJsonObject(row.grammatical_metadata_json),
    license: parseJsonObject(row.license_json),
    provenance: parseJsonObject(row.provenance_json),
    audio: row.audio_json ? parseJsonObject(row.audio_json) : null,
  };
}

function parseRouteId(value: string, label: string): string {
  const result = routeId.safeParse(value);
  if (!result.success) throw new LearningError(400, "INVALID_PATH", `${label} is invalid`);
  return result.data;
}

function parseVersion(value: string): number {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new LearningError(400, "INVALID_VERSION", "Version must be a positive integer");
  }
  return version;
}

async function enrolledVersion(db: D1Database, userId: string, courseId: string): Promise<number | null> {
  const row = await first<{ course_version: number }>(
    db.prepare(
      "SELECT course_version FROM learning_user_course_progress WHERE user_id = ? AND course_id = ?",
    ).bind(userId, courseId),
  );
  return row?.course_version ?? null;
}

function versionConflict(): LearningError {
  return new LearningError(
    409,
    "COURSE_VERSION_MISMATCH",
    "Progress for this course belongs to a different content version",
  );
}

/** A published version is usable unless the user already started another version of the course. */
async function requireCourseVersion(
  db: D1Database,
  userId: string,
  courseId: string,
  version: number,
): Promise<void> {
  const row = await first<{ version: number }>(
    db.prepare(
      "SELECT version FROM learning_course_versions WHERE course_id = ? AND version = ? AND status = 'published'",
    ).bind(courseId, version),
  );
  if (!row) throw new LearningError(404, "CONTENT_NOT_FOUND", "Published content was not found");
  const enrolled = await enrolledVersion(db, userId, courseId);
  if (enrolled !== null && enrolled !== version) throw versionConflict();
}

async function requireLesson(
  db: D1Database,
  courseId: string,
  version: number,
  lessonId: string,
): Promise<void> {
  const row = await first<{ lesson_id: string }>(
    db.prepare(
      "SELECT lesson_id FROM learning_lessons WHERE course_id = ? AND course_version = ? AND lesson_id = ?",
    ).bind(courseId, version, lessonId),
  );
  if (!row) throw new LearningError(404, "LESSON_NOT_FOUND", "Lesson was not found");
}

async function prerequisitesMet(
  db: D1Database,
  userId: string,
  courseId: string,
  version: number,
  lessonId: string,
): Promise<boolean> {
  const row = await first<{ missing: number }>(
    db.prepare(
      `SELECT COUNT(*) AS missing
       FROM learning_lesson_prerequisites p
       LEFT JOIN learning_user_lesson_progress progress
         ON progress.user_id = ?
        AND progress.course_id = p.course_id
        AND progress.course_version = p.course_version
        AND progress.lesson_id = p.prerequisite_lesson_id
        AND progress.status = 'completed'
       WHERE p.course_id = ? AND p.course_version = ? AND p.lesson_id = ?
         AND progress.lesson_id IS NULL`,
    ).bind(userId, courseId, version, lessonId),
  );
  return (row?.missing ?? 0) === 0;
}

async function requireUnlocked(
  db: D1Database,
  userId: string,
  courseId: string,
  version: number,
  lessonId: string,
): Promise<void> {
  if (!(await prerequisitesMet(db, userId, courseId, version, lessonId))) {
    throw new LearningError(403, "PREREQUISITES_NOT_MET", "Complete the required lessons first");
  }
}

async function parseJsonBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 16_384) throw new LearningError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  const text = await request.text();
  if (text.length > 16_384) throw new LearningError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LearningError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

function progressResponse(row: {
  courseId: string;
  version: number;
  lessonId: string;
  stepId: string;
  status: string;
}) {
  return {
    progress: {
      courseId: row.courseId,
      version: row.version,
      lessonId: row.lessonId,
      stepId: row.stepId,
      status: row.status,
    },
  };
}

interface SyncRow {
  course_id: string;
  course_version: number;
  item_id: string;
  lesson_id: string;
  language_tag: string;
  kind: "word" | "expression";
  display_text: string;
  gloss: string;
  stress_text: string | null;
  grammatical_metadata_json: string;
  license_json: string;
  provenance_json: string;
  audio_json: string | null;
}

async function flushLexiconSync(
  db: D1Database,
  userId: string,
  importer: CreateLearningRoutesOptions["lexiconImporter"],
  timestamp: string,
  courseId: string,
  version: number,
): Promise<number> {
  const pending = await all<SyncRow>(
    db.prepare(
      `SELECT sync.course_id, sync.course_version, sync.item_id, sync.lesson_id,
              item.language_tag, item.kind, item.display_text, item.gloss, item.stress_text,
              item.grammatical_metadata_json, item.license_json,
              item.provenance_json, item.audio_json
       FROM learning_lexicon_sync sync
       JOIN learning_content_items item
         ON item.course_id = sync.course_id
        AND item.course_version = sync.course_version
        AND item.item_id = sync.item_id
       WHERE sync.user_id = ? AND sync.course_id = ? AND sync.course_version = ?
         AND sync.status = 'pending'
       ORDER BY sync.item_id`,
    ).bind(userId, courseId, version),
  );

  for (const row of pending) {
    const license = parseJsonObject(row.license_json);
    const provenance = parseJsonObject(row.provenance_json);
    const scriptData: Record<string, unknown> = {
      ...parseJsonObject(row.grammatical_metadata_json),
      ...(row.stress_text ? { stressText: row.stress_text } : {}),
      ...(row.audio_json ? { audio: parseJsonObject(row.audio_json) } : {}),
    };
    try {
      await importer.importCourseEntry({
        ownerId: userId,
        courseId: row.course_id,
        courseVersion: String(row.course_version),
        itemId: row.item_id,
        kind: row.kind,
        provenance: { content: provenance, license },
        senses: [{
          gloss: row.gloss,
          equivalents: [{
            languageTag: row.language_tag,
            text: row.display_text,
            fit: "exact",
            status: "confirmed",
            source: "course",
            provenance: { content: provenance, license },
            scriptData,
          }],
        }],
      });
      const result = await db.prepare(
        `UPDATE learning_lexicon_sync
         SET status = 'synced', attempt_count = attempt_count + 1,
             last_attempt_at = ?, synced_at = ?
         WHERE user_id = ? AND course_id = ? AND course_version = ? AND item_id = ?
           AND status = 'pending'`,
      ).bind(timestamp, timestamp, userId, row.course_id, row.course_version, row.item_id).run();
      if (!result.success) throw new Error("Could not persist sync acknowledgement");
    } catch {
      await db.prepare(
        `UPDATE learning_lexicon_sync
         SET attempt_count = attempt_count + 1, last_attempt_at = ?
         WHERE user_id = ? AND course_id = ? AND course_version = ? AND item_id = ?
           AND status = 'pending'`,
      ).bind(timestamp, userId, row.course_id, row.course_version, row.item_id).run();
    }
  }

  const remaining = await first<{ count: number }>(
    db.prepare(
      `SELECT COUNT(*) AS count FROM learning_lexicon_sync
       WHERE user_id = ? AND course_id = ? AND course_version = ? AND status = 'pending'`,
    ).bind(userId, courseId, version),
  );
  return remaining?.count ?? 0;
}

export function createLearningRoutes(options: CreateLearningRoutesOptions): Hono<LearningEnv> {
  if (!options?.lexiconImporter) {
    throw new Error("Learning routes require a Lexicon importer");
  }
  const clock = options.clock ?? (() => new Date());
  const app = new Hono<LearningEnv>();

  app.use("*", async (c, next) => {
    const userId: unknown = c.get("userId");
    if (typeof userId !== "string" || userId.trim().length === 0 || userId.length > 255) {
      return c.json({ error: { code: "UNAUTHENTICATED", message: "Authentication is required" } }, 401);
    }
    await next();
  });

  app.get("/courses", async (c) => {
    const courses = await all<{
      course_id: string;
      language_tag: string;
      title: string;
      description: string;
      version: number;
      published_at: string;
    }>(
      c.env.DB.prepare(
        `SELECT course.course_id, course.language_tag, version.title, version.description,
                version.version, version.published_at
         FROM learning_courses course
         LEFT JOIN learning_user_course_progress enrollment
           ON enrollment.user_id = ? AND enrollment.course_id = course.course_id
         JOIN learning_course_versions version ON version.course_id = course.course_id
         WHERE version.status = 'published'
           AND version.version = COALESCE(enrollment.course_version, (
             SELECT MAX(latest.version) FROM learning_course_versions latest
             WHERE latest.course_id = course.course_id AND latest.status = 'published'
           ))
         ORDER BY course.course_id`,
      ).bind(c.get("userId")),
    );
    return c.json({ courses: courses.map((row) => ({
      id: row.course_id,
      languageTag: row.language_tag,
      title: row.title,
      description: row.description,
      version: row.version,
      publishedAt: row.published_at,
    })) });
  });

  app.get("/courses/:courseId/versions/:version", async (c) => {
    const courseId = parseRouteId(c.req.param("courseId"), "Course id");
    const version = parseVersion(c.req.param("version"));
    const userId = c.get("userId");
    await requireCourseVersion(c.env.DB, userId, courseId, version);
    const course = await first<{ language_tag: string; title: string; description: string; published_at: string }>(
      c.env.DB.prepare(
        `SELECT course.language_tag, version.title, version.description, version.published_at
         FROM learning_courses course
         JOIN learning_course_versions version ON version.course_id = course.course_id
         WHERE course.course_id = ? AND version.version = ? AND version.status = 'published'`,
      ).bind(courseId, version),
    );
    const units = await all<{ unit_id: string; position: number; title: string; can_do: string }>(
      c.env.DB.prepare(
        "SELECT unit_id, position, title, can_do FROM learning_units WHERE course_id = ? AND course_version = ? ORDER BY position",
      ).bind(courseId, version),
    );
    const lessons = await all<LessonRow>(
      c.env.DB.prepare(
        `SELECT lesson.lesson_id, lesson.unit_id, lesson.position AS lesson_position,
                unit.position AS unit_position, lesson.title,
                progress.status AS progress_status, progress.current_step_id
         FROM learning_lessons lesson
         JOIN learning_units unit
           ON unit.course_id = lesson.course_id AND unit.course_version = lesson.course_version
          AND unit.unit_id = lesson.unit_id
         LEFT JOIN learning_user_lesson_progress progress
           ON progress.user_id = ? AND progress.course_id = lesson.course_id
          AND progress.course_version = lesson.course_version AND progress.lesson_id = lesson.lesson_id
         WHERE lesson.course_id = ? AND lesson.course_version = ?
         ORDER BY unit.position, lesson.position`,
      ).bind(userId, courseId, version),
    );
    const prerequisites = await all<{ lesson_id: string; prerequisite_lesson_id: string }>(
      c.env.DB.prepare(
        "SELECT lesson_id, prerequisite_lesson_id FROM learning_lesson_prerequisites WHERE course_id = ? AND course_version = ? ORDER BY prerequisite_lesson_id",
      ).bind(courseId, version),
    );
    return c.json({
      course: {
        id: courseId,
        version,
        languageTag: course?.language_tag,
        title: course?.title,
        description: course?.description,
        publishedAt: course?.published_at,
        units: units.map((unit) => ({
          id: unit.unit_id,
          position: unit.position,
          title: unit.title,
          canDo: unit.can_do,
          lessons: lessons.filter((lesson) => lesson.unit_id === unit.unit_id).map((lesson) => ({
            id: lesson.lesson_id,
            position: lesson.lesson_position,
            title: lesson.title,
            status: lesson.progress_status ?? "not_started",
            currentStepId: lesson.current_step_id,
            prerequisites: prerequisites
              .filter((entry) => entry.lesson_id === lesson.lesson_id)
              .map((entry) => entry.prerequisite_lesson_id),
          })),
        })),
      },
    });
  });

  app.get("/courses/:courseId/versions/:version/lessons/:lessonId", async (c) => {
    const courseId = parseRouteId(c.req.param("courseId"), "Course id");
    const lessonId = parseRouteId(c.req.param("lessonId"), "Lesson id");
    const version = parseVersion(c.req.param("version"));
    const userId = c.get("userId");
    await requireCourseVersion(c.env.DB, userId, courseId, version);
    await requireLesson(c.env.DB, courseId, version, lessonId);
    await requireUnlocked(c.env.DB, userId, courseId, version, lessonId);
    const lesson = await first<{ title: string; unit_id: string }>(
      c.env.DB.prepare(
        "SELECT title, unit_id FROM learning_lessons WHERE course_id = ? AND course_version = ? AND lesson_id = ?",
      ).bind(courseId, version, lessonId),
    );
    const steps = await all<StepRow>(
      c.env.DB.prepare(
        "SELECT step_id, lesson_id, position, kind, payload_json FROM learning_steps WHERE course_id = ? AND course_version = ? AND lesson_id = ? ORDER BY position",
      ).bind(courseId, version, lessonId),
    );
    const links = await all<{ step_id: string; item_id: string; role: string; position: number }>(
      c.env.DB.prepare(
        `SELECT links.step_id, links.item_id, links.role, links.position
         FROM learning_step_items links
         JOIN learning_steps step
           ON step.course_id = links.course_id AND step.course_version = links.course_version
          AND step.step_id = links.step_id
         WHERE links.course_id = ? AND links.course_version = ? AND step.lesson_id = ?
         ORDER BY step.position, links.position`,
      ).bind(courseId, version, lessonId),
    );
    const contentItems = await all<ContentItemRow>(
      c.env.DB.prepare(
        `SELECT DISTINCT item.item_id, item.kind, item.language_tag, item.display_text,
                item.gloss, item.stress_text, item.grammatical_metadata_json,
                item.license_json, item.provenance_json, item.audio_json
         FROM learning_content_items item
         JOIN learning_step_items link
           ON link.course_id = item.course_id AND link.course_version = item.course_version
          AND link.item_id = item.item_id
         JOIN learning_steps step
           ON step.course_id = link.course_id AND step.course_version = link.course_version
          AND step.step_id = link.step_id
         WHERE item.course_id = ? AND item.course_version = ? AND step.lesson_id = ?
         ORDER BY item.item_id`,
      ).bind(courseId, version, lessonId),
    );
    return c.json({ lesson: {
      id: lessonId,
      unitId: lesson?.unit_id,
      title: lesson?.title,
      steps: steps.map((step) => ({
        id: step.step_id,
        position: step.position,
        kind: step.kind,
        payload: JSON.parse(step.payload_json) as unknown,
        items: links.filter((link) => link.step_id === step.step_id).map((link) => ({
          itemId: link.item_id,
          role: link.role,
          position: link.position,
        })),
      })),
      contentItems: contentItems.map(contentItemResponse),
    } });
  });

  app.get("/references", async (c) => {
    const courseId = parseRouteId(c.req.query("courseId") ?? "", "Course id");
    const version = parseVersion(c.req.query("version") ?? "");
    const parsedCategory = category.safeParse(c.req.query("category"));
    if (!parsedCategory.success) {
      throw new LearningError(400, "INVALID_CATEGORY", "Reference category is invalid");
    }
    const limit = Number(c.req.query("limit") ?? 20);
    const offset = Number(c.req.query("cursor") ?? 0);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new LearningError(400, "INVALID_LIMIT", "Limit must be between 1 and 100");
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new LearningError(400, "INVALID_CURSOR", "Cursor is invalid");
    }
    await requireCourseVersion(c.env.DB, c.get("userId"), courseId, version);
    const rows = await all<{
      reference_id: string;
      position: number;
      title: string;
      body_json: string;
      introduced_unit_id: string | null;
      unlock_lesson_id: string | null;
      content_item_id: string | null;
      unlocked: number;
    }>(
      c.env.DB.prepare(
        `SELECT reference.reference_id, reference.position, reference.title, reference.body_json,
                reference.introduced_unit_id, reference.unlock_lesson_id, reference.content_item_id,
                CASE WHEN reference.unlock_lesson_id IS NULL OR progress.status = 'completed' THEN 1 ELSE 0 END AS unlocked
         FROM learning_reference_items reference
         LEFT JOIN learning_user_lesson_progress progress
           ON progress.user_id = ? AND progress.course_id = reference.course_id
          AND progress.course_version = reference.course_version
          AND progress.lesson_id = reference.unlock_lesson_id
         WHERE reference.course_id = ? AND reference.course_version = ? AND reference.category = ?
         ORDER BY reference.position, reference.reference_id LIMIT ? OFFSET ?`,
      ).bind(c.get("userId"), courseId, version, parsedCategory.data, limit + 1, offset),
    );
    const hasMore = rows.length > limit;
    return c.json({
      references: rows.slice(0, limit).map((row) => ({
        id: row.reference_id,
        position: row.position,
        title: row.title,
        body: row.unlocked ? JSON.parse(row.body_json) as unknown : null,
        introducedUnitId: row.introduced_unit_id,
        unlockLessonId: row.unlock_lesson_id,
        contentItemId: row.content_item_id,
        locked: row.unlocked === 0,
      })),
      nextCursor: hasMore ? String(offset + limit) : null,
    });
  });

  app.get("/courses/:courseId/resume", async (c) => {
    const courseId = parseRouteId(c.req.param("courseId"), "Course id");
    const userId = c.get("userId");
    const latest = await first<{ version: number }>(
      c.env.DB.prepare(
        `SELECT version FROM learning_course_versions
         WHERE course_id = ? AND status = 'published' ORDER BY version DESC LIMIT 1`,
      ).bind(courseId),
    );
    if (!latest) throw new LearningError(404, "CONTENT_NOT_FOUND", "Published content was not found");
    const version = await enrolledVersion(c.env.DB, userId, courseId) ?? latest.version;
    const lessons = await all<LessonRow>(
      c.env.DB.prepare(
        `SELECT lesson.lesson_id, lesson.unit_id, lesson.position AS lesson_position,
                unit.position AS unit_position, lesson.title,
                progress.status AS progress_status, progress.current_step_id
         FROM learning_lessons lesson
         JOIN learning_units unit
           ON unit.course_id = lesson.course_id AND unit.course_version = lesson.course_version
          AND unit.unit_id = lesson.unit_id
         LEFT JOIN learning_user_lesson_progress progress
           ON progress.user_id = ? AND progress.course_id = lesson.course_id
          AND progress.course_version = lesson.course_version AND progress.lesson_id = lesson.lesson_id
         WHERE lesson.course_id = ? AND lesson.course_version = ?
         ORDER BY unit.position, lesson.position`,
      ).bind(userId, courseId, version),
    );
    const completed = new Set(lessons.filter((lesson) => lesson.progress_status === "completed").map((lesson) => lesson.lesson_id));
    const prerequisites = await all<{ lesson_id: string; prerequisite_lesson_id: string }>(
      c.env.DB.prepare(
        "SELECT lesson_id, prerequisite_lesson_id FROM learning_lesson_prerequisites WHERE course_id = ? AND course_version = ?",
      ).bind(courseId, version),
    );
    const nextLesson = lessons.find((lesson) =>
      lesson.progress_status !== "completed" &&
      prerequisites.filter((entry) => entry.lesson_id === lesson.lesson_id)
        .every((entry) => completed.has(entry.prerequisite_lesson_id)),
    );
    if (!nextLesson) return c.json({ resume: { courseId, version, complete: true } });
    let stepId = nextLesson.current_step_id;
    if (!stepId) {
      const firstStep = await first<{ step_id: string }>(
        c.env.DB.prepare(
          "SELECT step_id FROM learning_steps WHERE course_id = ? AND course_version = ? AND lesson_id = ? ORDER BY position LIMIT 1",
        ).bind(courseId, version, nextLesson.lesson_id),
      );
      stepId = firstStep?.step_id ?? null;
    }
    return c.json({ resume: {
      courseId,
      version,
      complete: false,
      unitId: nextLesson.unit_id,
      lessonId: nextLesson.lesson_id,
      stepId,
    } });
  });

  app.put("/courses/:courseId/versions/:version/lessons/:lessonId/progress", async (c) => {
    const courseId = parseRouteId(c.req.param("courseId"), "Course id");
    const lessonId = parseRouteId(c.req.param("lessonId"), "Lesson id");
    const version = parseVersion(c.req.param("version"));
    const userId = c.get("userId");
    const parsed = progressBody.safeParse(await parseJsonBody(c.req.raw));
    if (!parsed.success) throw new LearningError(400, "INVALID_PROGRESS", "Progress payload is invalid");
    await requireCourseVersion(c.env.DB, userId, courseId, version);
    await requireLesson(c.env.DB, courseId, version, lessonId);
    await requireUnlocked(c.env.DB, userId, courseId, version, lessonId);
    const step = await first<{ position: number }>(
      c.env.DB.prepare(
        "SELECT position FROM learning_steps WHERE course_id = ? AND course_version = ? AND lesson_id = ? AND step_id = ?",
      ).bind(courseId, version, lessonId, parsed.data.stepId),
    );
    if (!step) throw new LearningError(400, "INVALID_PROGRESS", "Step does not belong to this lesson");
    const existing = await first<{ status: string; farthest_step_position: number }>(
      c.env.DB.prepare(
        `SELECT status, farthest_step_position FROM learning_user_lesson_progress
         WHERE user_id = ? AND course_id = ? AND course_version = ? AND lesson_id = ?`,
      ).bind(userId, courseId, version, lessonId),
    );
    if (existing?.status === "completed") {
      throw new LearningError(409, "LESSON_ALREADY_COMPLETED", "Completed lesson progress cannot be changed");
    }
    const farthest = existing?.farthest_step_position ?? 0;
    if (step.position < farthest || step.position > farthest + 1) {
      throw new LearningError(409, "INVALID_PROGRESS_SEQUENCE", "Steps must be recorded in order without regression");
    }
    const timestamp = clock().toISOString();
    const lessonStatement = existing
      ? c.env.DB.prepare(
        `UPDATE learning_user_lesson_progress
         SET current_step_id = ?, farthest_step_position = MAX(farthest_step_position, ?), updated_at = ?
         WHERE user_id = ? AND course_id = ? AND course_version = ? AND lesson_id = ?`,
      ).bind(parsed.data.stepId, step.position, timestamp, userId, courseId, version, lessonId)
      : c.env.DB.prepare(
        `INSERT INTO learning_user_lesson_progress
         (user_id, course_id, course_version, lesson_id, status, current_step_id,
          farthest_step_position, started_at, completed_at, updated_at)
         VALUES (?, ?, ?, ?, 'in_progress', ?, ?, ?, NULL, ?)`,
      ).bind(userId, courseId, version, lessonId, parsed.data.stepId, step.position, timestamp, timestamp);
    const courseStatement = c.env.DB.prepare(
      `INSERT INTO learning_user_course_progress
       (user_id, course_id, course_version, current_lesson_id, current_step_id, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, course_id) DO UPDATE SET
         current_lesson_id = excluded.current_lesson_id,
         current_step_id = excluded.current_step_id,
         updated_at = excluded.updated_at
       WHERE learning_user_course_progress.course_version = excluded.course_version`,
    ).bind(userId, courseId, version, lessonId, parsed.data.stepId, timestamp, timestamp);
    let results: D1Result[];
    try {
      results = await c.env.DB.batch([courseStatement, lessonStatement]);
    } catch (error) {
      const enrolled = await enrolledVersion(c.env.DB, userId, courseId);
      if (enrolled !== null && enrolled !== version) throw versionConflict();
      throw error;
    }
    if (results.some((result) => !result.success)) throw new Error("Progress transaction failed");
    return c.json(progressResponse({ courseId, version, lessonId, stepId: parsed.data.stepId, status: "in_progress" }));
  });

  app.post("/courses/:courseId/versions/:version/lessons/:lessonId/complete", async (c) => {
    const courseId = parseRouteId(c.req.param("courseId"), "Course id");
    const lessonId = parseRouteId(c.req.param("lessonId"), "Lesson id");
    const version = parseVersion(c.req.param("version"));
    const userId = c.get("userId");
    await requireCourseVersion(c.env.DB, userId, courseId, version);
    await requireLesson(c.env.DB, courseId, version, lessonId);
    await requireUnlocked(c.env.DB, userId, courseId, version, lessonId);
    const progress = await first<{ status: "in_progress" | "completed"; farthest_step_position: number; completed_at: string | null }>(
      c.env.DB.prepare(
        `SELECT status, farthest_step_position, completed_at FROM learning_user_lesson_progress
         WHERE user_id = ? AND course_id = ? AND course_version = ? AND lesson_id = ?`,
      ).bind(userId, courseId, version, lessonId),
    );
    const last = await first<{ position: number }>(
      c.env.DB.prepare(
        "SELECT MAX(position) AS position FROM learning_steps WHERE course_id = ? AND course_version = ? AND lesson_id = ?",
      ).bind(courseId, version, lessonId),
    );
    if (!progress || !last || progress.farthest_step_position !== last.position) {
      throw new LearningError(409, "LESSON_NOT_FINISHED", "Record every lesson step before completion");
    }
    const timestamp = clock().toISOString();
    if (progress.status !== "completed") {
      const statements: D1PreparedStatement[] = [
        c.env.DB.prepare(
          `UPDATE learning_user_lesson_progress
           SET status = 'completed', completed_at = ?, updated_at = ?
           WHERE user_id = ? AND course_id = ? AND course_version = ? AND lesson_id = ?
             AND status = 'in_progress'`,
        ).bind(timestamp, timestamp, userId, courseId, version, lessonId),
      ];
      const introduced = await all<{ item_id: string }>(
        c.env.DB.prepare(
          `SELECT DISTINCT link.item_id
           FROM learning_step_items link
           JOIN learning_steps step
             ON step.course_id = link.course_id AND step.course_version = link.course_version
            AND step.step_id = link.step_id
           WHERE link.course_id = ? AND link.course_version = ? AND step.lesson_id = ?
             AND link.role = 'introduced' ORDER BY link.item_id`,
        ).bind(courseId, version, lessonId),
      );
      for (const item of introduced) {
        statements.push(
          c.env.DB.prepare(
            `INSERT INTO learning_lexicon_sync
             (user_id, course_id, course_version, item_id, lesson_id, status,
              attempt_count, last_attempt_at, synced_at)
             VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, NULL)
             ON CONFLICT(user_id, course_id, course_version, item_id) DO NOTHING`,
          ).bind(userId, courseId, version, item.item_id, lessonId),
        );
      }
      const results = await c.env.DB.batch(statements);
      if (results.some((result) => !result.success)) throw new Error("Completion transaction failed");
    }
    const pendingItems = await flushLexiconSync(
      c.env.DB,
      userId,
      options.lexiconImporter,
      timestamp,
      courseId,
      version,
    );
    return c.json({ completion: {
      courseId,
      version,
      lessonId,
      completedAt: progress.completed_at ?? timestamp,
      lexiconSync: { status: pendingItems === 0 ? "synced" : "pending", pendingItems },
    } }, pendingItems === 0 ? 200 : 202);
  });

  app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "Route was not found" } }, 404));
  app.onError((error, c) => errorResponse(c, error));
  return app;
}
