-- Products
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  owner       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- PRDs (Product Requirement Documents)
CREATE TABLE IF NOT EXISTS prds (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','deprecated')),
  version    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Artifacts (tickets, specs, designs linked to a PRD)
CREATE TABLE IF NOT EXISTS artifacts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  prd_id     INTEGER NOT NULL REFERENCES prds(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('ticket','spec','design','test_plan')),
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI Review results
CREATE TABLE IF NOT EXISTS reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id INTEGER REFERENCES artifacts(id) ON DELETE SET NULL,
  prd_id      INTEGER REFERENCES prds(id) ON DELETE SET NULL,
  agent       TEXT NOT NULL CHECK (agent IN ('reviewer','drift_detector')),
  score       REAL,
  summary     TEXT NOT NULL,
  issues      TEXT NOT NULL DEFAULT '[]',   -- JSON array
  suggestions TEXT NOT NULL DEFAULT '[]',   -- JSON array
  raw_output  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Metrics (time-series data for charts)
CREATE TABLE IF NOT EXISTS metrics (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  metric     TEXT NOT NULL,
  value      REAL NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Unified review reports (from /api/review pipeline)
CREATE TABLE IF NOT EXISTS review_reports (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id        TEXT,                    -- string ID from request; NULL for inline content
  timestamp          TEXT NOT NULL,
  hard_gates         TEXT NOT NULL DEFAULT '[]',  -- JSON: HardGateResult[]
  soft_gates         TEXT NOT NULL DEFAULT '[]',  -- JSON: SoftGateResult[]
  adversarial_review TEXT NOT NULL DEFAULT '{}',  -- JSON: AdversarialReview
  quality_score      REAL NOT NULL,
  recommendation     TEXT NOT NULL CHECK (recommendation IN ('approve','revise','reject')),
  blocked            INTEGER NOT NULL CHECK (blocked IN (0,1)),
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS review_reports_artifact_id
  ON review_reports (artifact_id, created_at DESC);

-- Validation results (from /api/validate)
CREATE TABLE IF NOT EXISTS validation_results (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_type     TEXT NOT NULL CHECK (artifact_type IN ('prd','okr','brief')),
  valid             INTEGER NOT NULL CHECK (valid IN (0,1)),  -- boolean
  completeness_score REAL NOT NULL,
  errors            TEXT NOT NULL DEFAULT '[]',          -- JSON array of ValidationError
  field_coverage    TEXT NOT NULL DEFAULT '{}',          -- JSON object
  raw_content       TEXT NOT NULL,                       -- original submitted JSON
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Triggers to keep updated_at fresh
CREATE TRIGGER IF NOT EXISTS products_updated_at
  AFTER UPDATE ON products
  BEGIN
    UPDATE products SET updated_at = datetime('now') WHERE id = NEW.id;
  END;

CREATE TRIGGER IF NOT EXISTS prds_updated_at
  AFTER UPDATE ON prds
  BEGIN
    UPDATE prds SET updated_at = datetime('now') WHERE id = NEW.id;
  END;

CREATE TRIGGER IF NOT EXISTS artifacts_updated_at
  AFTER UPDATE ON artifacts
  BEGIN
    UPDATE artifacts SET updated_at = datetime('now') WHERE id = NEW.id;
  END;
