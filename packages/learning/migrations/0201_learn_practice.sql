PRAGMA foreign_keys = ON;

-- Learn owns its own practice state. One card is one direction of one course
-- word a finished lesson introduced; the word stays out of the Lexicon unless
-- the learner asks for it there, so these tables are the only place Learn
-- scheduling lives and nothing here joins back to a Lexicon entry.
--
-- Materialising a card is derived from `learning_user_lesson_progress`, so a
-- lesson finished before this migration still feeds Learn practice: the route
-- writes the cards it is missing, keyed by the item, and never duplicates one.
CREATE TABLE learning_practice_cards (
  user_id TEXT NOT NULL,
  -- Opaque handle the client reviews against; `course.version.item.direction`.
  id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  course_version INTEGER NOT NULL CHECK (course_version > 0),
  item_id TEXT NOT NULL,
  language_tag TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('recognize', 'produce')),
  due_at TEXT NOT NULL,
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  elapsed_days INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  state INTEGER NOT NULL DEFAULT 0 CHECK (state BETWEEN 0 AND 3),
  last_review_at TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, course_id, course_version, item_id, direction),
  UNIQUE (user_id, id),
  FOREIGN KEY (course_id, course_version, item_id)
    REFERENCES learning_content_items(course_id, course_version, item_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, course_id, course_version)
    REFERENCES learning_user_course_progress(user_id, course_id, course_version) ON DELETE RESTRICT,
  CHECK (length(user_id) BETWEEN 1 AND 255)
) STRICT;

CREATE TABLE learning_review_events (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  course_version INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('recognize', 'produce')),
  session_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  reviewed_at TEXT NOT NULL,
  prior_revision INTEGER NOT NULL,
  resulting_revision INTEGER NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  UNIQUE (user_id, submission_id),
  FOREIGN KEY (user_id, course_id, course_version, item_id, direction)
    REFERENCES learning_practice_cards(user_id, course_id, course_version, item_id, direction) ON DELETE RESTRICT
) STRICT;

CREATE TABLE learning_wrong_revisits (
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  course_version INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('recognize', 'produce')),
  due_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (user_id, session_id, course_id, course_version, item_id, direction),
  FOREIGN KEY (user_id, course_id, course_version, item_id, direction)
    REFERENCES learning_practice_cards(user_id, course_id, course_version, item_id, direction) ON DELETE RESTRICT
) STRICT;

CREATE INDEX learning_practice_cards_due
  ON learning_practice_cards(user_id, language_tag, direction, due_at);
CREATE INDEX learning_review_history
  ON learning_review_events(user_id, reviewed_at);
CREATE INDEX learning_wrong_revisits_due
  ON learning_wrong_revisits(user_id, session_id, completed_at, due_at);