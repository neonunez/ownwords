PRAGMA foreign_keys = ON;

-- One-off carry-over for lessons finished before Learn owned its own practice
-- list. Every completed lesson gets the Learn cards it is missing, one per
-- introduced word and direction. A word the learner already practised as a
-- course-imported Lexicon entry keeps that card's scheduling state, so months
-- of reviews are not reset; every other card starts fresh and due now.
--
-- Each Lexicon lookup is keyed by the learner's own owner id, so the backfill
-- never reads another person's rows. `INSERT OR IGNORE` on the card key makes it
-- idempotent and leaves every existing row untouched. After this runs, Learning
-- reads no Lexicon table at runtime.
INSERT OR IGNORE INTO learning_practice_cards
  (user_id, id, course_id, course_version, item_id, language_tag, direction,
   due_at, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
   reps, lapses, state, last_review_at, revision, created_at, updated_at)
SELECT progress.user_id,
       progress.course_id || '.' || progress.course_version || '.' || item.item_id
         || '.' || ways.direction,
       progress.course_id, progress.course_version, item.item_id, item.language_tag,
       ways.direction,
       COALESCE(card.due_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
       COALESCE(card.stability, 0), COALESCE(card.difficulty, 0),
       COALESCE(card.elapsed_days, 0), COALESCE(card.scheduled_days, 0),
       COALESCE(card.learning_steps, 0), COALESCE(card.reps, 0),
       COALESCE(card.lapses, 0), COALESCE(card.state, 0), card.last_review_at,
       COALESCE(card.revision, 0),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
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
 WHERE progress.status = 'completed'
 ORDER BY progress.user_id, progress.course_id, progress.course_version, item.item_id,
          ways.direction, card.revision DESC;
