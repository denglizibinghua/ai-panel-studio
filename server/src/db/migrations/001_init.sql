-- 001_init.sql — AI Panel Studio 9-table schema.
-- Source of truth: specs/001-panel/data-model.md (§2, §4, §6, §7).
-- Conventions: INTEGER PK AUTOINCREMENT, ISO-8601 UTC ms TEXT timestamps,
-- INTEGER 0/1 booleans, JSON stored as TEXT, every FK to discussions CASCADE.

CREATE TABLE discussions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  topic          TEXT    NOT NULL CHECK (length(topic) BETWEEN 1 AND 200),
  expert_count   INTEGER NOT NULL DEFAULT 4 CHECK (expert_count BETWEEN 1 AND 8),
  status         TEXT    NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','generating','ready','running','finished','failed','cancelled')),
  session_id     TEXT    CHECK (session_id IS NULL OR length(session_id) <= 64),
  sample         INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0,1)),
  summary_text   TEXT    CHECK (summary_text IS NULL OR length(summary_text) <= 400),
  error_code     TEXT    CHECK (error_code IS NULL OR error_code IN ('LLM_NOT_CONFIGURED','LLM_UPSTREAM_ERROR','ALL_SPEAKERS_FAILED')),
  error_message  TEXT    CHECK (error_message IS NULL OR length(error_message) <= 500),
  last_event_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_event_seq >= 0),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at     TEXT,
  finished_at    TEXT,
  CHECK (status <> 'cancelled' OR error_code IS NULL)
);

CREATE INDEX idx_discussions_updated ON discussions(updated_at DESC);
CREATE INDEX idx_discussions_status  ON discussions(status, updated_at DESC);
CREATE INDEX idx_discussions_sample  ON discussions(sample, updated_at DESC);

CREATE TABLE guests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  discussion_id  INTEGER NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  name           TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 32),
  profession     TEXT    NOT NULL CHECK (length(profession) BETWEEN 1 AND 40),
  stance         TEXT    NOT NULL CHECK (length(stance) BETWEEN 1 AND 60),
  color_id       TEXT    NOT NULL
                         CHECK (color_id IN ('amber','rose','sky','emerald','violet','orange','teal','lime','indigo','fuchsia')),
  role           TEXT    NOT NULL CHECK (role IN ('host','expert')),
  speaking_order INTEGER NOT NULL CHECK (speaking_order BETWEEN 0 AND 8),
  locked         INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX uq_guests_name        ON guests(discussion_id, name);
CREATE UNIQUE INDEX uq_guests_color       ON guests(discussion_id, color_id);
CREATE UNIQUE INDEX uq_guests_one_host    ON guests(discussion_id) WHERE role = 'host';
CREATE        INDEX idx_guests_discussion ON guests(discussion_id, role, speaking_order);

CREATE TABLE turns (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  discussion_id  INTEGER NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  guest_id       INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  turn_no        INTEGER NOT NULL CHECK (turn_no >= 1),
  speech_type    TEXT    NOT NULL
                         CHECK (speech_type IN ('opening','challenge','supplement','rebuttal','question','summary')),
  content        TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
      (speech_type IN ('challenge','supplement','rebuttal','question')
         AND length(content) BETWEEN 1 AND 120)
  OR (speech_type IN ('opening','summary')
         AND length(content) BETWEEN 1 AND 400)
)
);

CREATE UNIQUE INDEX uq_turns_turn_no    ON turns(discussion_id, turn_no);
CREATE        INDEX idx_turns_discussion ON turns(discussion_id, turn_no);
CREATE        INDEX idx_turns_guest     ON turns(guest_id, turn_no);

CREATE TABLE events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  discussion_id  INTEGER NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL CHECK (seq >= 1),
  type           TEXT    NOT NULL
                         CHECK (type LIKE 'state.%' OR type LIKE 'run.%' OR type LIKE 'agent.%'
                             OR type LIKE 'turn.%' OR type LIKE 'consensus.%' OR type LIKE 'divergence.%'),
  payload        TEXT    NOT NULL CHECK (length(payload) <= 4096 AND json_valid(payload)),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX uq_events_seq  ON events(discussion_id, seq);
CREATE        INDEX idx_events_type ON events(discussion_id, type, seq);

CREATE TABLE ledger (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  discussion_id          INTEGER NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  turn_no                INTEGER NOT NULL CHECK (turn_no >= 0),
  is_request_satisfied   INTEGER CHECK (is_request_satisfied IS NULL OR is_request_satisfied IN (0,1)),
  is_in_loop             INTEGER CHECK (is_in_loop IS NULL OR is_in_loop IN (0,1)),
  is_progress_being_made INTEGER CHECK (is_progress_being_made IS NULL OR is_progress_being_made IN (0,1)),
  next_guest_id          INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  speech_type            TEXT    CHECK (speech_type IS NULL OR speech_type IN ('challenge','supplement','rebuttal','question')),
  instruction            TEXT    CHECK (instruction IS NULL OR length(instruction) <= 200),
  parse_status           TEXT    NOT NULL CHECK (parse_status IN ('structured','json_mode','fallback')),
  stall_count            INTEGER NOT NULL DEFAULT 0 CHECK (stall_count BETWEEN 0 AND 3),
  decision               TEXT    NOT NULL CHECK (decision IN ('speak','summarize','force_stop')),
  raw_json               TEXT    CHECK (raw_json IS NULL OR (length(raw_json) <= 4096 AND json_valid(raw_json))),
  created_at             TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX uq_ledger_turn ON ledger(discussion_id, turn_no);
CREATE        INDEX idx_ledger_disc ON ledger(discussion_id, turn_no DESC);

CREATE TABLE consensus_points (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  discussion_id     INTEGER NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  text              TEXT    NOT NULL CHECK (length(text) BETWEEN 1 AND 120),
  status            TEXT    NOT NULL DEFAULT 'provisional'
                            CHECK (status IN ('provisional','final','dropped')),
  support_guest_ids TEXT    CHECK (support_guest_ids IS NULL OR json_valid(support_guest_ids)),
  round_no          INTEGER CHECK (round_no IS NULL OR round_no >= 1),
  updated_seq       INTEGER NOT NULL CHECK (updated_seq >= 1),
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX uq_consensus_text ON consensus_points(discussion_id, text);
CREATE        INDEX idx_consensus_seq ON consensus_points(discussion_id, status, updated_seq);

CREATE TABLE divergence_points (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  discussion_id     INTEGER NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  text              TEXT    NOT NULL CHECK (length(text) BETWEEN 1 AND 120),
  status            TEXT    NOT NULL DEFAULT 'provisional'
                            CHECK (status IN ('provisional','final','dropped')),
  support_guest_ids TEXT    CHECK (support_guest_ids IS NULL OR json_valid(support_guest_ids)),
  round_no          INTEGER CHECK (round_no IS NULL OR round_no >= 1),
  updated_seq       INTEGER NOT NULL CHECK (updated_seq >= 1),
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX uq_divergence_text ON divergence_points(discussion_id, text);
CREATE        INDEX idx_divergence_seq ON divergence_points(discussion_id, status, updated_seq);

CREATE TABLE agent_status (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  discussion_id  INTEGER NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  guest_id       INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  state          TEXT    NOT NULL DEFAULT 'idle' CHECK (state IN ('idle','preparing','speaking')),
  focus          TEXT    CHECK (focus IS NULL OR length(focus) <= 80),
  updated_seq    INTEGER NOT NULL DEFAULT 0 CHECK (updated_seq >= 0),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX uq_agent_status_guest ON agent_status(discussion_id, guest_id);
CREATE        INDEX idx_agent_status_state ON agent_status(discussion_id, state);

CREATE TABLE llm_calls (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  discussion_id     INTEGER REFERENCES discussions(id) ON DELETE CASCADE,
  module            TEXT    NOT NULL CHECK (module IN ('guest','ledger','turn','consensus','summary')),
  provider          TEXT    NOT NULL DEFAULT 'deepseek' CHECK (provider IN ('deepseek')),
  model             TEXT    NOT NULL CHECK (length(model) <= 64),
  duration_ms       INTEGER NOT NULL CHECK (duration_ms >= 0),
  prompt_tokens     INTEGER CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
  completion_tokens INTEGER CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
  total_tokens      INTEGER CHECK (total_tokens IS NULL OR total_tokens >= 0),
  is_retry          INTEGER NOT NULL DEFAULT 0 CHECK (is_retry IN (0,1)),
  success           INTEGER NOT NULL CHECK (success IN (0,1)),
  error_summary     TEXT    CHECK (error_summary IS NULL OR length(error_summary) <= 200),
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_llm_calls_disc   ON llm_calls(discussion_id, created_at);
CREATE INDEX idx_llm_calls_module ON llm_calls(module, created_at);
