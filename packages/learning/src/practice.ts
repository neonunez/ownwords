/**
 * Learn's own practice: the words a finished lesson introduced, and the
 * scheduling state that keeps them coming back.
 *
 * The list is derived from `learning_user_lesson_progress` and nothing else, so
 * a word a lesson introduced is practised in Learn and is never a Lexicon entry.
 * Cards are written by the carry-over rules in `carryover.ts` when a lesson is
 * completed; nothing here reads a Lexicon table.
 */

import { all, first } from "./db";
import { LearningError } from "./errors";
import { scheduleLearnReview, type LearnCardState } from "./scheduler";

export type LearnDirection = "recognize" | "produce";

export const learnDirections: readonly LearnDirection[] = [
  "recognize",
  "produce",
];

/** A card missed in a sitting comes back inside it, as it does in Maintain. */
export const WRONG_ANSWER_DELAY_MS = 5 * 60 * 1000;

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export function languageTag(raw: string | null): string {
  const value = raw?.trim() ?? "";
  if (
    value.length < 2 ||
    value.length > 35 ||
    !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/u.test(value)
  ) {
    throw new LearningError(400, "INVALID_LANGUAGE", "Language is invalid");
  }
  return value;
}

export function direction(raw: string | null): LearnDirection {
  const value = raw ?? "";
  if (!learnDirections.includes(value as LearnDirection)) {
    throw new LearningError(400, "INVALID_DIRECTION", "Direction is invalid");
  }
  return value as LearnDirection;
}

export function sessionId(raw: string | null): string {
  const value = raw?.trim() ?? "";
  if (!/^[A-Za-z0-9_.:-]{1,200}$/u.test(value)) {
    throw new LearningError(400, "INVALID_SESSION", "Session is invalid");
  }
  return value;
}

export function limit(raw: string | null): number {
  if (raw === null) return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new LearningError(
      400,
      "INVALID_LIMIT",
      `Limit must be between 1 and ${MAX_LIMIT}`,
    );
  }
  return value;
}

/* ---- the due queue ------------------------------------------------------- */

interface DueRow {
  id: string;
  language_tag: string;
  direction: LearnDirection;
  due_at: string;
  item_id: string;
  display_text: string;
  gloss: string;
  revisit: number;
}

export interface DueQueue {
  data: Record<string, unknown>[];
  nextDueAt: string | null;
}

export async function readDueQueue(
  db: D1Database,
  input: {
    userId: string;
    language: string;
    direction: LearnDirection;
    sessionId: string;
    limit: number;
    now: Date;
  },
): Promise<DueQueue> {
  const now = input.now.toISOString();
  const rows = await all<DueRow>(
    db
      .prepare(
        `SELECT card.id, card.language_tag, card.direction, card.due_at,
                item.item_id, item.display_text, item.gloss,
                CASE WHEN revisit.item_id IS NULL THEN 0 ELSE 1 END AS revisit
           FROM learning_practice_cards card
           JOIN learning_content_items item
             ON item.course_id = card.course_id
            AND item.course_version = card.course_version
            AND item.item_id = card.item_id
           LEFT JOIN learning_wrong_revisits revisit
             ON revisit.user_id = card.user_id AND revisit.session_id = ?
            AND revisit.completed_at IS NULL AND revisit.due_at <= ?
            AND revisit.course_id = card.course_id
            AND revisit.course_version = card.course_version
            AND revisit.item_id = card.item_id
            AND revisit.direction = card.direction
          WHERE card.user_id = ? AND card.language_tag = ? AND card.direction = ?
            AND (card.due_at <= ? OR revisit.item_id IS NOT NULL)
          ORDER BY revisit DESC, card.due_at, card.id
          LIMIT ?`,
      )
      .bind(
        input.sessionId,
        now,
        input.userId,
        input.language,
        input.direction,
        now,
        input.limit,
      ),
  );
  const next = await first<{ due_at: string }>(
    db
      .prepare(
        `SELECT MIN(card.due_at) AS due_at
           FROM learning_practice_cards card
          WHERE card.user_id = ? AND card.language_tag = ? AND card.direction = ?
            AND card.due_at > ?`,
      )
      .bind(input.userId, input.language, input.direction, now),
  );
  return {
    data: rows.map((row) => ({
      card: {
        id: row.id,
        languageTag: row.language_tag,
        direction: row.direction,
        dueAt: row.due_at,
      },
      // The practised word, and the meaning that asks for it. Learn cards are
      // never cloze: the course writes no gaps to complete.
      target: {
        id: row.item_id,
        text: row.display_text,
        languageTag: row.language_tag,
      },
      prompt: { type: "gloss", text: row.gloss },
      cloze: null,
      revisit: row.revisit === 1,
    })),
    nextDueAt: rows.length === 0 ? (next?.due_at ?? null) : null,
  };
}

/* ---- reviews ------------------------------------------------------------- */

interface ReviewCardRow {
  user_id: string;
  course_id: string;
  course_version: number;
  item_id: string;
  language_tag: string;
  direction: LearnDirection;
  due_at: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review_at: string | null;
  revision: number;
}

interface ReviewEventRow {
  card_id: string;
  session_id: string;
  rating: number;
  result_json: string;
}

export interface ReviewResult {
  value: Record<string, unknown>;
  replayed: boolean;
}

export type SubmitOutcome =
  { ok: ReviewResult } | { conflict: true } | { notFound: true };

/**
 * Applies one rating, exactly once per submission id. The review event row and
 * the card's new state commit in one batch, guarded by the card's revision, so a
 * repeated submission replays the stored answer instead of scheduling twice.
 */
export async function submitReview(
  db: D1Database,
  input: {
    userId: string;
    submissionId: string;
    cardId: string;
    sessionId: string;
    rating: 1 | 2 | 3 | 4;
    now: Date;
  },
): Promise<SubmitOutcome> {
  const reviewedAt = input.now;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const previous = await first<ReviewEventRow>(
      db
        .prepare(
          `SELECT event.course_id || '.' || event.course_version || '.' || event.item_id
                    || '.' || event.direction AS card_id,
                  event.session_id, event.rating, event.result_json
             FROM learning_review_events event
            WHERE event.user_id = ? AND event.submission_id = ?`,
        )
        .bind(input.userId, input.submissionId),
    );
    if (previous !== null) {
      if (
        previous.card_id !== input.cardId ||
        previous.session_id !== input.sessionId ||
        previous.rating !== input.rating
      ) {
        return { conflict: true };
      }
      return {
        ok: {
          value: JSON.parse(previous.result_json) as Record<string, unknown>,
          replayed: true,
        },
      };
    }
    const card = await first<ReviewCardRow>(
      db
        .prepare(
          `SELECT user_id, course_id, course_version, item_id, language_tag, direction,
                  due_at, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
                  reps, lapses, state, last_review_at, revision
             FROM learning_practice_cards WHERE user_id = ? AND id = ?`,
        )
        .bind(input.userId, input.cardId),
    );
    if (card === null) return { notFound: true };
    const scheduled = scheduleLearnReview(
      toLearnCardState(card),
      input.rating,
      reviewedAt,
    );
    const eventId = crypto.randomUUID();
    const value: Record<string, unknown> = {
      eventId,
      submissionId: input.submissionId,
      cardId: input.cardId,
      sessionId: input.sessionId,
      rating: input.rating,
      reviewedAt: reviewedAt.toISOString(),
      priorRevision: card.revision,
      resultingRevision: card.revision + 1,
      card: { ...scheduled, revision: card.revision + 1 },
    };
    const timestamp = reviewedAt.toISOString();
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO learning_review_events
             (id, user_id, submission_id, course_id, course_version, item_id, direction,
              session_id, rating, reviewed_at, prior_revision, resulting_revision, result_json)
           SELECT ?, ?, ?, course_id, course_version, item_id, direction, ?, ?, ?, ?, ?, ?
             FROM learning_practice_cards
            WHERE user_id = ? AND id = ? AND revision = ?
           ON CONFLICT(user_id, submission_id) DO NOTHING`,
        )
        .bind(
          eventId,
          input.userId,
          input.submissionId,
          input.sessionId,
          input.rating,
          timestamp,
          card.revision,
          card.revision + 1,
          JSON.stringify(value),
          input.userId,
          input.cardId,
          card.revision,
        ),
      db
        .prepare(
          `UPDATE learning_practice_cards
              SET due_at = ?, stability = ?, difficulty = ?, elapsed_days = ?,
                  scheduled_days = ?, learning_steps = ?, reps = ?, lapses = ?, state = ?,
                  last_review_at = ?, revision = revision + 1, updated_at = ?
            WHERE user_id = ? AND id = ? AND revision = ?
              AND EXISTS (SELECT 1 FROM learning_review_events
                           WHERE id = ? AND user_id = ? AND submission_id = ?)`,
        )
        .bind(
          scheduled.dueAt,
          scheduled.stability,
          scheduled.difficulty,
          scheduled.elapsedDays,
          scheduled.scheduledDays,
          scheduled.learningSteps,
          scheduled.reps,
          scheduled.lapses,
          scheduled.state,
          scheduled.lastReviewAt,
          timestamp,
          input.userId,
          input.cardId,
          card.revision,
          eventId,
          input.userId,
          input.submissionId,
        ),
      input.rating === 1
        ? db
            .prepare(
              `INSERT INTO learning_wrong_revisits
                 (user_id, session_id, course_id, course_version, item_id, direction,
                  due_at, completed_at)
               SELECT ?, ?, course_id, course_version, item_id, direction, ?, NULL
                 FROM learning_practice_cards
                WHERE user_id = ? AND id = ?
                  AND EXISTS (SELECT 1 FROM learning_review_events
                               WHERE id = ? AND user_id = ? AND submission_id = ?)
                ON CONFLICT(user_id, session_id, course_id, course_version, item_id, direction)
                DO UPDATE SET due_at = excluded.due_at, completed_at = NULL`,
            )
            .bind(
              input.userId,
              input.sessionId,
              new Date(
                reviewedAt.getTime() + WRONG_ANSWER_DELAY_MS,
              ).toISOString(),
              input.userId,
              input.cardId,
              eventId,
              input.userId,
              input.submissionId,
            )
        : db
            .prepare(
              `UPDATE learning_wrong_revisits SET completed_at = ?
                WHERE user_id = ? AND session_id = ? AND course_id = ?
                  AND course_version = ? AND item_id = ? AND direction = ?
                  AND completed_at IS NULL
                  AND EXISTS (SELECT 1 FROM learning_review_events
                               WHERE id = ? AND user_id = ?)`,
            )
            .bind(
              timestamp,
              input.userId,
              input.sessionId,
              card.course_id,
              card.course_version,
              card.item_id,
              card.direction,
              eventId,
              input.userId,
            ),
    ]);
    if (results[0]?.meta.changes !== 0 || results[1]?.meta.changes !== 0) {
      return { ok: { value, replayed: false } };
    }
  }
  throw new Error("Concurrent review retry limit exceeded");
}

function toLearnCardState(row: ReviewCardRow): LearnCardState {
  return {
    dueAt: row.due_at,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsed_days,
    scheduledDays: row.scheduled_days,
    learningSteps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    lastReviewAt: row.last_review_at,
  };
}
