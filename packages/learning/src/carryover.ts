/**
 * The one set of rules that writes Learn cards for finished lessons.
 *
 * Every completed lesson gets the cards it is missing, one per introduced word
 * and direction. A word the learner already practised as their own
 * course-imported Lexicon card keeps that card's scheduling state; every other
 * card starts fresh and due now. Each Lexicon lookup is keyed by the learner's
 * own owner id, and `INSERT OR IGNORE` on the card key leaves existing cards
 * untouched, so running the rules again writes nothing twice.
 *
 * Migration `0202_learn_practice_carryover.sql` is these rules over every
 * learner, rendered by `carryoverMigrationSql`; lesson completion runs them for
 * one learner's lesson, so a lesson completed by an earlier release after the
 * migration ran still gains its cards when it is completed again. The Learn
 * queue read never runs them.
 */

function carryoverInsert(now: string, scope: string): string {
  return `INSERT OR IGNORE INTO learning_practice_cards
  (user_id, id, course_id, course_version, item_id, language_tag, direction,
   due_at, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
   reps, lapses, state, last_review_at, revision, created_at, updated_at)
SELECT progress.user_id,
       progress.course_id || '.' || progress.course_version || '.' || item.item_id
         || '.' || ways.direction,
       progress.course_id, progress.course_version, item.item_id, item.language_tag,
       ways.direction,
       COALESCE(card.due_at, ${now}),
       COALESCE(card.stability, 0), COALESCE(card.difficulty, 0),
       COALESCE(card.elapsed_days, 0), COALESCE(card.scheduled_days, 0),
       COALESCE(card.learning_steps, 0), COALESCE(card.reps, 0),
       COALESCE(card.lapses, 0), COALESCE(card.state, 0), card.last_review_at,
       COALESCE(card.revision, 0),
       ${now}, ${now}
  FROM learning_user_lesson_progress progress
  JOIN learning_steps step
    ON step.course_id = progress.course_id
   AND step.course_version = progress.course_version
   AND step.lesson_id = progress.lesson_id
  JOIN learning_step_items link
    ON link.course_id = step.course_id
   AND link.course_version = step.course_version
   AND link.step_id = step.step_id AND link.role = 'introduced'
  JOIN learning_content_items item
    ON item.course_id = link.course_id
   AND item.course_version = link.course_version
   AND item.item_id = link.item_id
 CROSS JOIN (SELECT 'recognize' AS direction UNION ALL SELECT 'produce') AS ways
  LEFT JOIN lexicon_course_imports imported
    ON imported.owner_id = progress.user_id
   AND imported.course_id = progress.course_id
   AND imported.course_version = CAST(progress.course_version AS TEXT)
   AND imported.item_id = item.item_id
  LEFT JOIN lexicon_senses sense
    ON sense.owner_id = imported.owner_id AND sense.entry_id = imported.entry_id
  LEFT JOIN lexicon_equivalents equivalent
    ON equivalent.owner_id = sense.owner_id AND equivalent.sense_id = sense.id
   AND equivalent.language_tag = item.language_tag
  LEFT JOIN lexicon_practice_cards card
    ON card.owner_id = equivalent.owner_id AND card.equivalent_id = equivalent.id
   AND card.direction = ways.direction
 WHERE progress.status = 'completed'${scope}
 ORDER BY progress.user_id, progress.course_id, progress.course_version, item.item_id,
          ways.direction, card.revision DESC;
`;
}

/** The exact contents of migration `0202_learn_practice_carryover.sql`. */
export function carryoverMigrationSql(): string {
  return `PRAGMA foreign_keys = ON;

-- One-off carry-over for lessons finished before Learn owned its own practice
-- list, generated from packages/learning/src/carryover.ts (the rules lesson
-- completion also runs) by \`npm run migration:carryover\`. Do not edit by hand.
${carryoverInsert("strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", "")}`;
}

/** The same rules for one learner's one finished lesson. */
export function lessonCarryoverStatement(
  db: D1Database,
  input: {
    userId: string;
    courseId: string;
    version: number;
    lessonId: string;
    now: Date;
  },
): D1PreparedStatement {
  const now = input.now.toISOString();
  return db
    .prepare(
      carryoverInsert(
        "?1",
        `
   AND progress.user_id = ?2 AND progress.course_id = ?3
   AND progress.course_version = ?4 AND progress.lesson_id = ?5`,
      ),
    )
    .bind(now, input.userId, input.courseId, input.version, input.lessonId);
}
