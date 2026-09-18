import { contentHash, validateContentPack, type ContentPack } from "./content";
import { first } from "./db";

export class ContentTransitionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ContentTransitionError";
  }
}

export interface IngestResult {
  courseId: string;
  version: number;
  contentHash: string;
  outcome: "created" | "unchanged";
}

interface CourseRow {
  course_id: string;
  language_tag: string;
}

interface VersionRow {
  status: "draft" | "published";
  content_hash: string;
}

interface MaxVersionRow {
  max_version: number | null;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

/** Validates the complete pack before issuing one atomic D1 batch. */
export async function ingestCourseVersion(
  db: D1Database,
  input: unknown,
  now = new Date(),
): Promise<IngestResult> {
  const pack = validateContentPack(input);
  const hash = await contentHash(pack);
  const existingCourse = await first<CourseRow>(
    db
      .prepare(
        "SELECT course_id, language_tag FROM learning_courses WHERE course_id = ?",
      )
      .bind(pack.course.id),
  );

  if (
    existingCourse &&
    existingCourse.language_tag !== pack.course.languageTag
  ) {
    throw new ContentTransitionError(
      "COURSE_IDENTITY_MISMATCH",
      "Existing stable course language does not match the import",
    );
  }

  const existingVersion = await first<VersionRow>(
    db
      .prepare(
        "SELECT status, content_hash FROM learning_course_versions WHERE course_id = ? AND version = ?",
      )
      .bind(pack.course.id, pack.version),
  );
  if (existingVersion) {
    if (
      existingVersion.status === "draft" &&
      existingVersion.content_hash === hash
    ) {
      return {
        courseId: pack.course.id,
        version: pack.version,
        contentHash: hash,
        outcome: "unchanged",
      };
    }
    throw new ContentTransitionError(
      existingVersion.status === "published"
        ? "PUBLISHED_VERSION_IMMUTABLE"
        : "DRAFT_VERSION_EXISTS",
      "A content version may not be replaced; discard an unpublished draft explicitly or use the next version",
    );
  }

  const maxVersion = await first<MaxVersionRow>(
    db
      .prepare(
        "SELECT MAX(version) AS max_version FROM learning_course_versions WHERE course_id = ?",
      )
      .bind(pack.course.id),
  );
  const expectedVersion = (maxVersion?.max_version ?? 0) + 1;
  if (pack.version !== expectedVersion) {
    throw new ContentTransitionError(
      "UNSUPPORTED_VERSION_TRANSITION",
      `Expected version ${expectedVersion}; versions must be created sequentially`,
    );
  }

  const timestamp = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  if (!existingCourse) {
    statements.push(
      db
        .prepare(
          "INSERT INTO learning_courses (course_id, language_tag, created_at) VALUES (?, ?, ?)",
        )
        .bind(pack.course.id, pack.course.languageTag, timestamp),
    );
  }
  statements.push(
    db
      .prepare(
        "INSERT INTO learning_course_versions (course_id, version, status, title, description, content_hash, created_at, published_at) VALUES (?, ?, 'draft', ?, ?, ?, ?, NULL)",
      )
      .bind(
        pack.course.id,
        pack.version,
        pack.course.title,
        pack.course.description,
        hash,
        timestamp,
      ),
  );

  for (const unit of pack.units) {
    statements.push(
      db
        .prepare(
          "INSERT INTO learning_units (course_id, course_version, unit_id, position, title, can_do) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(
          pack.course.id,
          pack.version,
          unit.id,
          unit.position,
          unit.title,
          unit.canDo,
        ),
    );
    for (const lesson of unit.lessons) {
      statements.push(
        db
          .prepare(
            "INSERT INTO learning_lessons (course_id, course_version, lesson_id, unit_id, position, title) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .bind(
            pack.course.id,
            pack.version,
            lesson.id,
            unit.id,
            lesson.position,
            lesson.title,
          ),
      );
      for (const step of lesson.steps) {
        statements.push(
          db
            .prepare(
              "INSERT INTO learning_steps (course_id, course_version, step_id, lesson_id, position, kind, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(
              pack.course.id,
              pack.version,
              step.id,
              lesson.id,
              step.position,
              step.kind,
              json(step.payload),
            ),
        );
      }
    }
  }

  for (const item of pack.items) {
    statements.push(
      db
        .prepare(
          "INSERT INTO learning_content_items (course_id, course_version, item_id, kind, language_tag, display_text, gloss, stress_text, grammatical_metadata_json, license_json, provenance_json, audio_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          pack.course.id,
          pack.version,
          item.id,
          item.kind,
          item.languageTag,
          item.displayText,
          item.gloss,
          item.stressText ?? null,
          json(item.grammaticalMetadata),
          json(item.license),
          json(item.provenance),
          item.audio ? json(item.audio) : null,
        ),
    );
  }

  for (const unit of pack.units) {
    for (const lesson of unit.lessons) {
      for (const prerequisite of lesson.prerequisites) {
        statements.push(
          db
            .prepare(
              "INSERT INTO learning_lesson_prerequisites (course_id, course_version, lesson_id, prerequisite_lesson_id) VALUES (?, ?, ?, ?)",
            )
            .bind(pack.course.id, pack.version, lesson.id, prerequisite),
        );
      }
      for (const step of lesson.steps) {
        for (const item of step.items) {
          statements.push(
            db
              .prepare(
                "INSERT INTO learning_step_items (course_id, course_version, step_id, item_id, role, position) VALUES (?, ?, ?, ?, ?, ?)",
              )
              .bind(
                pack.course.id,
                pack.version,
                step.id,
                item.itemId,
                item.role,
                item.position,
              ),
          );
        }
      }
    }
  }

  for (const reference of pack.references) {
    statements.push(
      db
        .prepare(
          "INSERT INTO learning_reference_items (course_id, course_version, reference_id, category, position, title, body_json, introduced_unit_id, unlock_lesson_id, content_item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          pack.course.id,
          pack.version,
          reference.id,
          reference.category,
          reference.position,
          reference.title,
          json(reference.body),
          reference.introducedUnitId ?? null,
          reference.unlockLessonId ?? null,
          reference.contentItemId ?? null,
        ),
    );
  }

  const results = await db.batch(statements);
  if (results.some((result) => !result.success))
    throw new Error("Atomic content import failed");
  return {
    courseId: pack.course.id,
    version: pack.version,
    contentHash: hash,
    outcome: "created",
  };
}

export async function publishCourseVersion(
  db: D1Database,
  courseId: string,
  version: number,
  now = new Date(),
): Promise<void> {
  const current = await first<VersionRow>(
    db
      .prepare(
        "SELECT status, content_hash FROM learning_course_versions WHERE course_id = ? AND version = ?",
      )
      .bind(courseId, version),
  );
  if (!current)
    throw new ContentTransitionError(
      "VERSION_NOT_FOUND",
      "Content version does not exist",
    );
  if (current.status !== "draft") {
    throw new ContentTransitionError(
      "PUBLISHED_VERSION_IMMUTABLE",
      "Published content cannot transition again",
    );
  }
  const result = await db
    .prepare(
      "UPDATE learning_course_versions SET status = 'published', published_at = ? WHERE course_id = ? AND version = ? AND status = 'draft'",
    )
    .bind(now.toISOString(), courseId, version)
    .run();
  if (!result.success || result.meta.changes !== 1) {
    throw new ContentTransitionError(
      "PUBLISH_CONFLICT",
      "Content version could not be published",
    );
  }
}

/** Draft deletion is explicit; published versions are protected by SQL triggers. */
export async function discardDraftCourseVersion(
  db: D1Database,
  courseId: string,
  version: number,
): Promise<void> {
  const result = await db
    .prepare(
      "DELETE FROM learning_course_versions WHERE course_id = ? AND version = ? AND status = 'draft'",
    )
    .bind(courseId, version)
    .run();
  if (!result.success || result.meta.changes !== 1) {
    throw new ContentTransitionError(
      "DRAFT_NOT_FOUND",
      "Only an existing draft version may be discarded",
    );
  }
}

export type { ContentPack };
