/**
 * The guarded operator path for publishing one course version.
 *
 * The route never writes course SQL: it calls the Learning package's own
 * `ingestCourseVersion` / `publishCourseVersion` against this Worker's D1
 * binding, so remote publication is the same validated importer the local
 * publisher uses, in one atomic batch, and published versions stay immutable.
 *
 * Authority is a dedicated Worker secret, `CONTENT_PUBLISH_TOKEN`, held only by
 * the operator. It is absent by default, and an absent or malformed value
 * disables publication entirely rather than failing open.
 *
 * Every call is a preflight unless the caller states `dryRun: false`, and even
 * then the request must name the exact course, version and content hash it
 * expects. A pack that is not the reviewed artifact is refused before any write.
 */
import { timingSafeEqual } from "node:crypto";
import {
  contentHash,
  ContentValidationError,
  validateContentPack,
  type ContentPack,
} from "@ownwords/learning/content";
import {
  ContentTransitionError,
  ingestCourseVersion,
  publishCourseVersion,
  readCourseVersionStates,
} from "@ownwords/learning/operator";
import { bodyLimit } from "hono/body-limit";
import { Hono } from "hono";
import { z } from "zod";
import { errorResponse } from "./errors.js";
import type { AppEnv, Bindings } from "./types.js";

/** Larger than the 256 KiB app-wide cap: a full course pack is one body. */
const CONTENT_BODY_LIMIT_BYTES = 1024 * 1024;
const HEX_TOKEN = /^[a-f0-9]{64}$/;

const publishSchema = z
  .object({
    pack: z.unknown(),
    expect: z
      .object({
        courseId: z.string().min(1).max(100),
        version: z.number().int().positive().max(1_000_000),
        contentHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    /**
     * The operator's own statement of the pack's editorial status, kept in the
     * response so a publication record carries it. Nothing here decides whether
     * a course is fit to use; the note is the operator's claim, not a review.
     */
    editorial: z
      .object({
        teacherReviewed: z.boolean(),
        note: z.string().trim().min(10).max(500),
      })
      .strict(),
    /** Preflight unless the operator explicitly asks for the write. */
    dryRun: z.boolean().default(true),
  })
  .strict();

export type PublicationAction =
  "publish" | "resume-draft" | "already-published";

export interface PublicationSummary {
  courseId: string;
  version: number;
  contentHash: string;
  title: string;
  units: number;
  lessons: number;
  items: number;
  itemsWithAudio: number;
  references: number;
}

export function summarizePack(
  pack: ContentPack,
  hash: string,
): PublicationSummary {
  return {
    courseId: pack.course.id,
    version: pack.version,
    contentHash: hash,
    title: pack.course.title,
    units: pack.units.length,
    lessons: pack.units.reduce((total, unit) => total + unit.lessons.length, 0),
    items: pack.items.length,
    itemsWithAudio: pack.items.filter((item) => item.audio).length,
    references: pack.references.length,
  };
}

export function authorizedForPublication(
  env: Bindings,
  header?: string,
): boolean {
  const configured = env.CONTENT_PUBLISH_TOKEN;
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (
    !configured ||
    !HEX_TOKEN.test(configured) ||
    !HEX_TOKEN.test(supplied) ||
    !timingSafeEqual(
      new TextEncoder().encode(configured),
      new TextEncoder().encode(supplied),
    )
  ) {
    return false;
  }
  return true;
}

export function createContentPublicationAdminRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.use("*", async (c, next) => {
    if (!authorizedForPublication(c.env, c.req.header("Authorization"))) {
      return errorResponse(
        403,
        "admin_forbidden",
        "Course publication is not authorized",
      );
    }
    await next();
  });

  /** Read-only: what a course already holds, for a publication preflight. */
  routes.get("/versions", async (c) => {
    const courseId = c.req.query("courseId");
    if (!courseId || courseId.length > 100) {
      return errorResponse(400, "invalid_request", "A course id is required");
    }
    const versions = await readCourseVersionStates(c.env.DB, courseId);
    return c.json({ data: { courseId, versions } });
  });

  routes.use(
    "*",
    bodyLimit({
      maxSize: CONTENT_BODY_LIMIT_BYTES,
      onError: () =>
        errorResponse(
          413,
          "request_too_large",
          "The request body is too large",
        ),
    }),
  );

  routes.post("/publish", async (c) => {
    const parsed = publishSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return errorResponse(
        400,
        "invalid_request",
        "A course pack with its expected course, version, content hash and editorial statement is required",
      );
    }

    let pack: ContentPack;
    let hash: string;
    try {
      pack = validateContentPack(parsed.data.pack);
      hash = await contentHash(pack);
    } catch (error) {
      const detail =
        error instanceof ContentValidationError
          ? "The course pack is not valid content"
          : "The course pack could not be read";
      return errorResponse(400, "invalid_content", detail);
    }

    const { expect, editorial, dryRun } = parsed.data;
    if (
      pack.course.id !== expect.courseId ||
      pack.version !== expect.version ||
      hash !== expect.contentHash
    ) {
      return errorResponse(
        409,
        "publication_target_mismatch",
        "The course pack is not the reviewed course, version and content hash this request expects",
      );
    }

    const versions = await readCourseVersionStates(c.env.DB, pack.course.id);
    const current = versions.find((entry) => entry.version === pack.version);
    let action: PublicationAction;
    if (current?.status === "published") {
      if (current.contentHash !== hash) {
        return errorResponse(
          409,
          "published_version_immutable",
          "This course version is already published with different content; publish a new version instead",
        );
      }
      // Republishing identical content is a no-op, so an interrupted run is safe to repeat.
      action = "already-published";
    } else if (current) {
      if (current.contentHash !== hash) {
        return errorResponse(
          409,
          "draft_version_exists",
          "This course version already has a draft with different content; discard it explicitly or use the next version",
        );
      }
      action = "resume-draft";
    } else {
      const latest = Math.max(0, ...versions.map((entry) => entry.version));
      if (pack.version !== latest + 1) {
        return errorResponse(
          409,
          "unsupported_version_transition",
          `Expected version ${latest + 1}; versions must be created sequentially`,
        );
      }
      action = "publish";
    }

    const summary = summarizePack(pack, hash);
    if (dryRun) {
      return c.json({
        data: { dryRun: true, action, editorial, summary, versions },
      });
    }

    try {
      if (action !== "already-published") {
        const ingested = await ingestCourseVersion(c.env.DB, pack);
        await publishCourseVersion(
          c.env.DB,
          ingested.courseId,
          ingested.version,
        );
      }
    } catch (error) {
      if (error instanceof ContentTransitionError) {
        return errorResponse(409, error.code.toLowerCase(), error.message);
      }
      throw error;
    }

    // A confirmed request for content that is already published answers with the
    // state it found and writes nothing, so an interrupted run is safe to repeat.
    const published = (
      await readCourseVersionStates(c.env.DB, pack.course.id)
    ).find((entry) => entry.version === pack.version);
    return c.json({
      data: {
        dryRun: false,
        action,
        editorial,
        summary,
        status: published?.status ?? "published",
        publishedAt: published?.publishedAt ?? null,
      },
    });
  });

  return routes;
}
