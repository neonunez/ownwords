PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS lexicon_entries (
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('word', 'expression')),
  note TEXT,
  source TEXT,
  provenance_json TEXT,
  human_edited INTEGER NOT NULL DEFAULT 0 CHECK (human_edited IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (id),
  UNIQUE (id, owner_id)
);

CREATE TABLE IF NOT EXISTS lexicon_senses (
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  gloss TEXT,
  note TEXT,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  human_edited INTEGER NOT NULL DEFAULT 0 CHECK (human_edited IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (id),
  UNIQUE (id, owner_id),
  FOREIGN KEY (entry_id, owner_id) REFERENCES lexicon_entries(id, owner_id)
);

CREATE TABLE IF NOT EXISTS lexicon_equivalents (
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  sense_id TEXT NOT NULL,
  language_tag TEXT NOT NULL,
  text TEXT,
  search_text TEXT,
  fit TEXT NOT NULL CHECK (fit IN ('exact', 'broader', 'narrower', 'context_only', 'false_friend')),
  status TEXT NOT NULL CHECK (status IN ('suggested', 'confirmed', 'waiting', 'failed', 'manual')),
  note TEXT,
  source TEXT,
  provenance_json TEXT,
  script_data_json TEXT,
  human_edited INTEGER NOT NULL DEFAULT 0 CHECK (human_edited IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (id),
  UNIQUE (id, owner_id),
  FOREIGN KEY (sense_id, owner_id) REFERENCES lexicon_senses(id, owner_id),
  CHECK (
    (status IN ('waiting', 'failed') AND text IS NULL AND search_text IS NULL)
    OR
    (status IN ('suggested', 'confirmed', 'manual') AND length(text) BETWEEN 1 AND 500 AND search_text IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS lexicon_cloze_items (
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  equivalent_id TEXT NOT NULL,
  language_tag TEXT NOT NULL,
  template TEXT NOT NULL,
  answer TEXT NOT NULL,
  accepted_answers_json TEXT NOT NULL DEFAULT '[]',
  hint TEXT,
  provenance_json TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (id),
  UNIQUE (id, owner_id),
  FOREIGN KEY (equivalent_id, owner_id) REFERENCES lexicon_equivalents(id, owner_id),
  CHECK (length(template) BETWEEN 1 AND 1000),
  CHECK (length(answer) BETWEEN 1 AND 500)
);

CREATE TABLE IF NOT EXISTS lexicon_practice_cards (
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  equivalent_id TEXT NOT NULL,
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
  PRIMARY KEY (id),
  UNIQUE (owner_id, equivalent_id, direction),
  UNIQUE (id, owner_id),
  FOREIGN KEY (equivalent_id, owner_id) REFERENCES lexicon_equivalents(id, owner_id)
);

CREATE TABLE IF NOT EXISTS lexicon_review_events (
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  reviewed_at TEXT NOT NULL,
  prior_revision INTEGER NOT NULL,
  resulting_revision INTEGER NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (owner_id, submission_id),
  FOREIGN KEY (card_id, owner_id) REFERENCES lexicon_practice_cards(id, owner_id)
);

CREATE TABLE IF NOT EXISTS lexicon_wrong_revisits (
  owner_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  due_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (owner_id, session_id, card_id),
  FOREIGN KEY (card_id, owner_id) REFERENCES lexicon_practice_cards(id, owner_id)
);

CREATE TABLE IF NOT EXISTS lexicon_translation_cache (
  owner_id TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  provider_version TEXT NOT NULL,
  source_language TEXT NOT NULL,
  target_language TEXT NOT NULL,
  sense_version INTEGER NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, cache_key)
);

CREATE TABLE IF NOT EXISTS lexicon_course_imports (
  owner_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  course_version TEXT NOT NULL,
  item_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, course_id, course_version, item_id),
  FOREIGN KEY (entry_id, owner_id) REFERENCES lexicon_entries(id, owner_id)
);

CREATE INDEX IF NOT EXISTS idx_lexicon_senses_entry
  ON lexicon_senses(owner_id, entry_id, position) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lexicon_equivalents_sense
  ON lexicon_equivalents(owner_id, sense_id, language_tag) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lexicon_equivalents_search
  ON lexicon_equivalents(owner_id, search_text) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lexicon_cards_due
  ON lexicon_practice_cards(owner_id, language_tag, direction, due_at);
CREATE INDEX IF NOT EXISTS idx_lexicon_review_history
  ON lexicon_review_events(owner_id, card_id, reviewed_at);
CREATE INDEX IF NOT EXISTS idx_lexicon_revisits_due
  ON lexicon_wrong_revisits(owner_id, session_id, completed_at, due_at);
