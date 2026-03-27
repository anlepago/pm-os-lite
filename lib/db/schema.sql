-- ─────────────────────────────────────────────────────────────────────────────
-- Legacy / product-management tables (kept for existing API routes)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  owner       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

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

CREATE TABLE IF NOT EXISTS metrics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  metric      TEXT NOT NULL,
  value       REAL NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS review_reports (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id        TEXT,
  timestamp          TEXT NOT NULL,
  hard_gates         TEXT NOT NULL DEFAULT '[]',
  soft_gates         TEXT NOT NULL DEFAULT '[]',
  adversarial_review TEXT NOT NULL DEFAULT '{}',
  quality_score      REAL NOT NULL,
  recommendation     TEXT NOT NULL CHECK (recommendation IN ('approve','revise','reject')),
  blocked            INTEGER NOT NULL CHECK (blocked IN (0,1)),
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS review_reports_artifact_id
  ON review_reports (artifact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS validation_results (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_type      TEXT NOT NULL CHECK (artifact_type IN ('prd','okr','brief')),
  valid              INTEGER NOT NULL CHECK (valid IN (0,1)),
  completeness_score REAL NOT NULL,
  errors             TEXT NOT NULL DEFAULT '[]',
  field_coverage     TEXT NOT NULL DEFAULT '{}',
  raw_content        TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- New review-pipeline tables
-- ─────────────────────────────────────────────────────────────────────────────

-- Artifacts: versioned, content-hashed documents fed into the review pipeline
CREATE TABLE IF NOT EXISTS artifacts (
  id            TEXT PRIMARY KEY,                      -- UUID v4
  artifactType  TEXT NOT NULL,                         -- 'prd' | 'okr' | 'ticket' | 'brief' | ...
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,                         -- JSON blob
  contentHash   TEXT NOT NULL,                         -- SHA-256 of content for cache invalidation
  schemaVersion TEXT,                                  -- e.g. "1.0"
  createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS artifacts_type_idx ON artifacts (artifactType, createdAt DESC);
CREATE INDEX IF NOT EXISTS artifacts_hash_idx ON artifacts (contentHash);

-- Reviews: structured output from the full review pipeline per artifact
CREATE TABLE IF NOT EXISTS reviews (
  id              TEXT PRIMARY KEY,                    -- UUID v4
  artifactId      TEXT REFERENCES artifacts(id) ON DELETE CASCADE,
  qualityScore    INTEGER,                             -- 0–100
  recommendation  TEXT CHECK (recommendation IN ('approve','revise','reject')),
  blocked         INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0,1)),
  hardGatesJson   TEXT NOT NULL DEFAULT '[]',          -- JSON: HardGateResult[]
  softGatesJson   TEXT NOT NULL DEFAULT '[]',          -- JSON: SoftGateResult[]
  adversarialJson TEXT NOT NULL DEFAULT '{}',          -- JSON: AdversarialReview
  driftJson       TEXT NOT NULL DEFAULT '{}',          -- JSON: DriftAnalysis
  reviewedAt      TEXT NOT NULL DEFAULT (datetime('now')),
  -- Gate-level pass/fail (1=passed, 0=failed, NULL=not applicable)
  gate1_passed              INTEGER,
  gate2_passed              INTEGER,
  gate3_passed              INTEGER,
  gate4_passed              INTEGER,
  gate5_passed              INTEGER,
  gate6_passed              INTEGER,
  -- AI-era audit fields extracted from adversarialJson
  ai_era_audit_json         TEXT,                     -- JSON: aiEraAudit object
  eval_credibility          TEXT,                     -- 'credible' | 'questionable' | 'missing'
  economic_defensibility    TEXT,                     -- 'strong' | 'weak' | 'missing'
  operability_realism       TEXT,                     -- 'realistic' | 'optimistic' | 'missing'
  compliance_readiness      TEXT                      -- 'ready' | 'gaps' | 'missing'
);

CREATE INDEX IF NOT EXISTS reviews_artifact_idx ON reviews (artifactId, reviewedAt DESC);

-- Gate health summary: pass rate (0–100) per gate across all reviews with gate data
CREATE VIEW IF NOT EXISTS gate_health_summary AS
SELECT
  CAST(ROUND(100.0 * SUM(gate1_passed) / NULLIF(COUNT(gate1_passed), 0)) AS INTEGER) AS gate1_rate,
  CAST(ROUND(100.0 * SUM(gate2_passed) / NULLIF(COUNT(gate2_passed), 0)) AS INTEGER) AS gate2_rate,
  CAST(ROUND(100.0 * SUM(gate3_passed) / NULLIF(COUNT(gate3_passed), 0)) AS INTEGER) AS gate3_rate,
  CAST(ROUND(100.0 * SUM(gate4_passed) / NULLIF(COUNT(gate4_passed), 0)) AS INTEGER) AS gate4_rate,
  CAST(ROUND(100.0 * SUM(gate5_passed) / NULLIF(COUNT(gate5_passed), 0)) AS INTEGER) AS gate5_rate,
  CAST(ROUND(100.0 * SUM(gate6_passed) / NULLIF(COUNT(gate6_passed), 0)) AS INTEGER) AS gate6_rate
FROM reviews;

-- OKR baselines: one active baseline at a time used for drift detection
CREATE TABLE IF NOT EXISTS okr_baselines (
  id        TEXT PRIMARY KEY,                          -- UUID v4
  timeframe TEXT NOT NULL,                             -- e.g. "Q1-2025"
  content   TEXT NOT NULL,                             -- JSON: OKR document
  setAt     TEXT NOT NULL DEFAULT (datetime('now')),
  isActive  INTEGER NOT NULL DEFAULT 0 CHECK (isActive IN (0,1))
);

CREATE INDEX IF NOT EXISTS okr_baselines_active_idx ON okr_baselines (isActive, setAt DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Triggers
-- ─────────────────────────────────────────────────────────────────────────────

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
    UPDATE artifacts SET updatedAt = datetime('now') WHERE id = NEW.id;
  END;

-- Drift comparison cache: stores drift detection results keyed by artifact+OKR pair
CREATE TABLE IF NOT EXISTS drift_comparison_cache (
  pair_hash      TEXT PRIMARY KEY,              -- SHA-256 of artifact+OKR content hashes
  artifact_label TEXT NOT NULL,                 -- human-readable label for lookups
  result_json    TEXT NOT NULL,                 -- JSON: DriftResult
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS drift_cache_label_idx ON drift_comparison_cache (artifact_label, created_at DESC);
CREATE INDEX IF NOT EXISTS drift_cache_created_idx ON drift_comparison_cache (created_at DESC);
