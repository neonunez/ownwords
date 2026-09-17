PRAGMA foreign_keys = ON;

CREATE TABLE learning_courses (
  course_id TEXT PRIMARY KEY,
  language_tag TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE learning_course_versions (
  course_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  PRIMARY KEY (course_id, version),
  FOREIGN KEY (course_id) REFERENCES learning_courses(course_id) ON DELETE CASCADE,
  CHECK (
    (status = 'draft' AND published_at IS NULL) OR
    (status = 'published' AND published_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE learning_units (
  course_id TEXT NOT NULL,
  course_version INTEGER NOT NULL,
  unit_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  title TEXT NOT NULL,
  can_do TEXT NOT NULL,
  PRIMARY KEY (course_id, course_version, unit_id),
  UNIQUE (course_id, course_version, position),
  FOREIGN KEY (course_id, course_version)
    REFERENCES learning_course_versions(course_id, version) ON DELETE CASCADE
) STRICT;

CREATE TABLE learning_lessons (
  course_id TEXT NOT NULL,
  course_version INTEGER NOT NULL,
  lesson_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  title TEXT NOT NULL,
  PRIMARY KEY (course_id, course_version, lesson_id),
  UNIQUE (course_id, course_version, unit_id, position),
  FOREIGN KEY (course_id, course_version, unit_id)
    REFERENCES learning_units(course_id, course_version, unit_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE learning_lesson_prerequisites (
  course_id TEXT NOT NULL,
  course_version INTEGER NOT NULL,
  lesson_id TEXT NOT NULL,
  prerequisite_lesson_id TEXT NOT NULL,
  PRIMARY KEY (course_id, course_version, lesson_id, prerequisite_lesson_id),
  FOREIGN KEY (course_id, course_version, lesson_id)
    REFERENCES learning_lessons(course_id, course_version, lesson_id) ON DELETE CASCADE,
  FOREIGN KEY (course_id, course_version, prerequisite_lesson_id)
    REFERENCES learning_lessons(course_id, course_version, lesson_id) ON DELETE CASCADE,
  CHECK (lesson_id <> prerequisite_lesson_id)
) STRICT;

CREATE TABLE learning_steps (
  course_id TEXT NOT NULL,
  course_version INTEGER NOT NULL,
  step_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  kind TEXT NOT NULL CHECK (kind IN ('hear', 'rule', 'use', 'perception', 'practice', 'alphabet')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  PRIMARY KEY (course_id, course_version, step_id),
  UNIQUE (course_id, course_version, lesson_id, position),
  FOREIGN KEY (course_id, course_version, lesson_id)
    REFERENCES learning_lessons(course_id, course_version, lesson_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE learning_content_items (
  course_id TEXT NOT NULL,
  course_version INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('word', 'expression')),
  language_tag TEXT NOT NULL,
  display_text TEXT NOT NULL,
  gloss TEXT NOT NULL,
  stress_text TEXT,
  grammatical_metadata_json TEXT NOT NULL CHECK (json_valid(grammatical_metadata_json)),
  license_json TEXT NOT NULL CHECK (json_valid(license_json)),
  provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
  audio_json TEXT CHECK (audio_json IS NULL OR json_valid(audio_json)),
  PRIMARY KEY (course_id, course_version, item_id),
  FOREIGN KEY (course_id, course_version)
    REFERENCES learning_course_versions(course_id, version) ON DELETE CASCADE
) STRICT;

CREATE TABLE learning_step_items (
  course_id TEXT NOT NULL,
  course_version INTEGER NOT NULL,
  step_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('introduced', 'reviewed')),
  position INTEGER NOT NULL CHECK (position > 0),
  PRIMARY KEY (course_id, course_version, step_id, item_id),
  UNIQUE (course_id, course_version, step_id, position),
  FOREIGN KEY (course_id, course_version, step_id)
    REFERENCES learning_steps(course_id, course_version, step_id) ON DELETE CASCADE,
  FOREIGN KEY (course_id, course_version, item_id)
    REFERENCES learning_content_items(course_id, course_version, item_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE learning_reference_items (
  course_id TEXT NOT NULL,
  course_version INTEGER NOT NULL,
  reference_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'alphabet', 'grammar', 'verbs', 'phrases', 'intonation', 'numbers', 'course_vocabulary'
  )),
  position INTEGER NOT NULL CHECK (position > 0),
  title TEXT NOT NULL,
  body_json TEXT NOT NULL CHECK (json_valid(body_json)),
  introduced_unit_id TEXT,
  unlock_lesson_id TEXT,
  content_item_id TEXT,
  PRIMARY KEY (course_id, course_version, reference_id),
  UNIQUE (course_id, course_version, category, position),
  FOREIGN KEY (course_id, course_version)
    REFERENCES learning_course_versions(course_id, version) ON DELETE CASCADE,
  FOREIGN KEY (course_id, course_version, introduced_unit_id)
    REFERENCES learning_units(course_id, course_version, unit_id) ON DELETE CASCADE,
  FOREIGN KEY (course_id, course_version, unlock_lesson_id)
    REFERENCES learning_lessons(course_id, course_version, lesson_id) ON DELETE CASCADE,
  FOREIGN KEY (course_id, course_version, content_item_id)
    REFERENCES learning_content_items(course_id, course_version, item_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE learning_user_course_progress (
  user_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  course_version INTEGER NOT NULL,
  current_lesson_id TEXT,
  current_step_id TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, course_id),
  UNIQUE (user_id, course_id, course_version),
  FOREIGN KEY (course_id, course_version)
    REFERENCES learning_course_versions(course_id, version) ON DELETE RESTRICT,
  FOREIGN KEY (course_id, course_version, current_lesson_id)
    REFERENCES learning_lessons(course_id, course_version, lesson_id) ON DELETE RESTRICT,
  FOREIGN KEY (course_id, course_version, current_step_id)
    REFERENCES learning_steps(course_id, course_version, step_id) ON DELETE RESTRICT,
  CHECK (length(user_id) BETWEEN 1 AND 255),
  CHECK (current_step_id IS NULL OR current_lesson_id IS NOT NULL)
) STRICT;

CREATE TABLE learning_user_lesson_progress (
  user_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  course_version INTEGER NOT NULL,
  lesson_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
  current_step_id TEXT,
  farthest_step_position INTEGER NOT NULL DEFAULT 0 CHECK (farthest_step_position >= 0),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, course_id, course_version, lesson_id),
  FOREIGN KEY (user_id, course_id, course_version)
    REFERENCES learning_user_course_progress(user_id, course_id, course_version) ON DELETE RESTRICT,
  FOREIGN KEY (course_id, course_version, lesson_id)
    REFERENCES learning_lessons(course_id, course_version, lesson_id) ON DELETE RESTRICT,
  FOREIGN KEY (course_id, course_version, current_step_id)
    REFERENCES learning_steps(course_id, course_version, step_id) ON DELETE RESTRICT,
  CHECK (length(user_id) BETWEEN 1 AND 255),
  CHECK (
    (status = 'in_progress' AND completed_at IS NULL) OR
    (status = 'completed' AND completed_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE learning_lexicon_sync (
  user_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  course_version INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'synced')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at TEXT,
  synced_at TEXT,
  PRIMARY KEY (user_id, course_id, course_version, item_id),
  FOREIGN KEY (user_id, course_id, course_version)
    REFERENCES learning_user_course_progress(user_id, course_id, course_version) ON DELETE RESTRICT,
  FOREIGN KEY (course_id, course_version, item_id)
    REFERENCES learning_content_items(course_id, course_version, item_id) ON DELETE RESTRICT,
  FOREIGN KEY (course_id, course_version, lesson_id)
    REFERENCES learning_lessons(course_id, course_version, lesson_id) ON DELETE RESTRICT,
  CHECK (length(user_id) BETWEEN 1 AND 255),
  CHECK (
    (status = 'pending' AND synced_at IS NULL) OR
    (status = 'synced' AND synced_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX learning_lessons_order
  ON learning_lessons(course_id, course_version, unit_id, position);
CREATE INDEX learning_steps_order
  ON learning_steps(course_id, course_version, lesson_id, position);
CREATE INDEX learning_reference_order
  ON learning_reference_items(course_id, course_version, category, position, reference_id);
CREATE INDEX learning_user_completion_lookup
  ON learning_user_lesson_progress(user_id, course_id, course_version, status, lesson_id);
CREATE INDEX learning_pending_lexicon_sync
  ON learning_lexicon_sync(user_id, status, course_id, course_version);

CREATE TRIGGER learning_course_delete_guard
BEFORE DELETE ON learning_courses
WHEN EXISTS (
  SELECT 1 FROM learning_course_versions
  WHERE course_id = OLD.course_id AND status = 'published'
)
BEGIN
  SELECT RAISE(ABORT, 'published course is immutable');
END;

CREATE TRIGGER learning_course_update_guard
BEFORE UPDATE ON learning_courses
WHEN EXISTS (
  SELECT 1 FROM learning_course_versions
  WHERE course_id = OLD.course_id AND status = 'published'
)
BEGIN
  SELECT RAISE(ABORT, 'published course is immutable');
END;

CREATE TRIGGER learning_version_insert_guard
BEFORE INSERT ON learning_course_versions
WHEN NEW.status <> 'draft' OR NEW.published_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'version must begin as draft');
END;

CREATE TRIGGER learning_version_transition_guard
BEFORE UPDATE ON learning_course_versions
WHEN OLD.status <> 'draft'
  OR NEW.status <> 'published'
  OR NEW.course_id <> OLD.course_id
  OR NEW.version <> OLD.version
  OR NEW.title <> OLD.title
  OR NEW.description <> OLD.description
  OR NEW.content_hash <> OLD.content_hash
  OR NEW.created_at <> OLD.created_at
  OR NEW.published_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'unsupported content version transition');
END;

CREATE TRIGGER learning_published_version_delete_guard
BEFORE DELETE ON learning_course_versions
WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published version is immutable');
END;

CREATE TRIGGER learning_course_enrollment_guard
BEFORE UPDATE ON learning_user_course_progress
WHEN NEW.user_id <> OLD.user_id
  OR NEW.course_id <> OLD.course_id
  OR NEW.course_version <> OLD.course_version
  OR NEW.started_at <> OLD.started_at
BEGIN
  SELECT RAISE(ABORT, 'course enrollment version is immutable');
END;

-- Published version content is append-, update-, and delete-protected at the
-- database boundary, including writes that bypass the TypeScript importer.
CREATE TRIGGER learning_units_insert_guard BEFORE INSERT ON learning_units
WHEN (SELECT status FROM learning_course_versions WHERE course_id = NEW.course_id AND version = NEW.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;
CREATE TRIGGER learning_units_update_guard BEFORE UPDATE ON learning_units
WHEN (SELECT status FROM learning_course_versions WHERE course_id = OLD.course_id AND version = OLD.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;
CREATE TRIGGER learning_units_delete_guard BEFORE DELETE ON learning_units
WHEN (SELECT status FROM learning_course_versions WHERE course_id = OLD.course_id AND version = OLD.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;

CREATE TRIGGER learning_lessons_insert_guard BEFORE INSERT ON learning_lessons
WHEN (SELECT status FROM learning_course_versions WHERE course_id = NEW.course_id AND version = NEW.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;
CREATE TRIGGER learning_lessons_update_guard BEFORE UPDATE ON learning_lessons
WHEN (SELECT status FROM learning_course_versions WHERE course_id = OLD.course_id AND version = OLD.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;
CREATE TRIGGER learning_lessons_delete_guard BEFORE DELETE ON learning_lessons
WHEN (SELECT status FROM learning_course_versions WHERE course_id = OLD.course_id AND version = OLD.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;

CREATE TRIGGER learning_prerequisites_insert_guard BEFORE INSERT ON learning_lesson_prerequisites
WHEN (SELECT status FROM learning_course_versions WHERE course_id = NEW.course_id AND version = NEW.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;
CREATE TRIGGER learning_prerequisites_update_guard BEFORE UPDATE ON learning_lesson_prerequisites
WHEN (SELECT status FROM learning_course_versions WHERE course_id = OLD.course_id AND version = OLD.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;
CREATE TRIGGER learning_prerequisites_delete_guard BEFORE DELETE ON learning_lesson_prerequisites
WHEN (SELECT status FROM learning_course_versions WHERE course_id = OLD.course_id AND version = OLD.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;

CREATE TRIGGER learning_steps_insert_guard BEFORE INSERT ON learning_steps
WHEN (SELECT status FROM learning_course_versions WHERE course_id = NEW.course_id AND version = NEW.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;
CREATE TRIGGER learning_steps_update_guard BEFORE UPDATE ON learning_steps
WHEN (SELECT status FROM learning_course_versions WHERE course_id = OLD.course_id AND version = OLD.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;
CREATE TRIGGER learning_steps_delete_guard BEFORE DELETE ON learning_steps
WHEN (SELECT status FROM learning_course_versions WHERE course_id = OLD.course_id AND version = OLD.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;

CREATE TRIGGER learning_items_insert_guard BEFORE INSERT ON learning_content_items
WHEN (SELECT status FROM learning_course_versions WHERE course_id = NEW.course_id AND version = NEW.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;
CREATE TRIGGER learning_items_update_guard BEFORE UPDATE ON learning_content_items
WHEN (SELECT status FROM learning_course_versions WHERE course_id = OLD.course_id AND version = OLD.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;
CREATE TRIGGER learning_items_delete_guard BEFORE DELETE ON learning_content_items
WHEN (SELECT status FROM learning_course_versions WHERE course_id = OLD.course_id AND version = OLD.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;

CREATE TRIGGER learning_step_items_insert_guard BEFORE INSERT ON learning_step_items
WHEN (SELECT status FROM learning_course_versions WHERE course_id = NEW.course_id AND version = NEW.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;
CREATE TRIGGER learning_step_items_update_guard BEFORE UPDATE ON learning_step_items
WHEN (SELECT status FROM learning_course_versions WHERE course_id = OLD.course_id AND version = OLD.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;
CREATE TRIGGER learning_step_items_delete_guard BEFORE DELETE ON learning_step_items
WHEN (SELECT status FROM learning_course_versions WHERE course_id = OLD.course_id AND version = OLD.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;

CREATE TRIGGER learning_references_insert_guard BEFORE INSERT ON learning_reference_items
WHEN (SELECT status FROM learning_course_versions WHERE course_id = NEW.course_id AND version = NEW.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;
CREATE TRIGGER learning_references_update_guard BEFORE UPDATE ON learning_reference_items
WHEN (SELECT status FROM learning_course_versions WHERE course_id = OLD.course_id AND version = OLD.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;
CREATE TRIGGER learning_references_delete_guard BEFORE DELETE ON learning_reference_items
WHEN (SELECT status FROM learning_course_versions WHERE course_id = OLD.course_id AND version = OLD.course_version) = 'published'
BEGIN SELECT RAISE(ABORT, 'published version is immutable'); END;
