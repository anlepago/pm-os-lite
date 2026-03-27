import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(process.cwd(), "data", "pm-os.db");

const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Run any migrations needed before applying schema (so indexes on new columns don't fail)
try { db.exec(`ALTER TABLE drift_comparison_cache ADD COLUMN artifact_label TEXT NOT NULL DEFAULT ''`); } catch { /* column already exists */ }

// Gate-level columns added to reviews table
for (const col of [
  "gate1_passed INTEGER",
  "gate2_passed INTEGER",
  "gate3_passed INTEGER",
  "gate4_passed INTEGER",
  "gate5_passed INTEGER",
  "gate6_passed INTEGER",
  "ai_era_audit_json TEXT",
  "eval_credibility TEXT",
  "economic_defensibility TEXT",
  "operability_realism TEXT",
  "compliance_readiness TEXT",
]) {
  try { db.exec(`ALTER TABLE reviews ADD COLUMN ${col}`); } catch { /* column already exists */ }
}

// Auto-apply schema on first import
const schemaPath = path.join(process.cwd(), "lib", "db", "schema.sql");
if (fs.existsSync(schemaPath)) {
  db.exec(fs.readFileSync(schemaPath, "utf-8"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Artifact {
  id: string;
  artifactType: string;
  title: string;
  content: string;       // JSON string
  contentHash: string;
  schemaVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Review {
  id: string;
  artifactId: string | null;
  qualityScore: number | null;
  recommendation: "approve" | "revise" | "reject" | null;
  blocked: number;       // 0 | 1 (SQLite boolean)
  hardGatesJson: string;
  softGatesJson: string;
  adversarialJson: string;
  driftJson: string;
  reviewedAt: string;
  // Gate-level pass/fail (1=passed, 0=failed, null=not applicable)
  gate1_passed: number | null;
  gate2_passed: number | null;
  gate3_passed: number | null;
  gate4_passed: number | null;
  gate5_passed: number | null;
  gate6_passed: number | null;
  // AI-era audit fields
  ai_era_audit_json: string | null;
  eval_credibility: string | null;
  economic_defensibility: string | null;
  operability_realism: string | null;
  compliance_readiness: string | null;
}

export interface OKRBaseline {
  id: string;
  timeframe: string;
  content: string;       // JSON string
  setAt: string;
  isActive: number;      // 0 | 1
}

export interface DashboardStats {
  totalArtifacts: number;
  reviewsThisWeek: number;
  avgQualityScore: number | null;
  blockedCount: number;
  approvedCount: number;
  revisedCount: number;
  rejectedCount: number;
  gatePassRates: {
    gate1: number;  // 0–100
    gate2: number;
    gate3: number;
    gate4: number;
    gate5: number;
    gate6: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifact helpers
// ─────────────────────────────────────────────────────────────────────────────

export function saveArtifact(artifact: Artifact): Artifact {
  db.prepare(`
    INSERT INTO artifacts (id, artifactType, title, content, contentHash, schemaVersion, createdAt, updatedAt)
    VALUES (@id, @artifactType, @title, @content, @contentHash, @schemaVersion, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      artifactType  = excluded.artifactType,
      title         = excluded.title,
      content       = excluded.content,
      contentHash   = excluded.contentHash,
      schemaVersion = excluded.schemaVersion,
      updatedAt     = datetime('now')
  `).run(artifact);
  return getArtifact(artifact.id)!;
}

export function getArtifact(id: string): Artifact | undefined {
  return db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as Artifact | undefined;
}

export function listArtifacts(artifactType?: string): Artifact[] {
  if (artifactType) {
    return db
      .prepare("SELECT * FROM artifacts WHERE artifactType = ? ORDER BY createdAt DESC")
      .all(artifactType) as Artifact[];
  }
  return db.prepare("SELECT * FROM artifacts ORDER BY createdAt DESC").all() as Artifact[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Review helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractGatePassed(gates: { phase: string; passed: boolean }[], gateNum: number): number | null {
  const checks = gates.filter((g) => g.phase?.startsWith(`Gate ${gateNum}:`));
  if (checks.length === 0) return null;
  return checks.every((g) => g.passed) ? 1 : 0;
}

export function saveReview(review: Review): Review {
  // Derive per-gate pass/fail from hardGatesJson
  let gate1_passed: number | null = null;
  let gate2_passed: number | null = null;
  let gate3_passed: number | null = null;
  let gate4_passed: number | null = null;
  let gate5_passed: number | null = null;
  let gate6_passed: number | null = null;
  try {
    const gates: { phase: string; passed: boolean }[] = JSON.parse(review.hardGatesJson);
    gate1_passed = extractGatePassed(gates, 1);
    gate2_passed = extractGatePassed(gates, 2);
    gate3_passed = extractGatePassed(gates, 3);
    gate4_passed = extractGatePassed(gates, 4);
    gate5_passed = extractGatePassed(gates, 5);
    gate6_passed = extractGatePassed(gates, 6);
  } catch { /* malformed JSON — leave as null */ }

  // Derive AI-era audit fields from adversarialJson
  let ai_era_audit_json: string | null = null;
  let eval_credibility: string | null = null;
  let economic_defensibility: string | null = null;
  let operability_realism: string | null = null;
  let compliance_readiness: string | null = null;
  try {
    const adversarial = JSON.parse(review.adversarialJson) as { aiEraAudit?: Record<string, string> };
    const audit = adversarial.aiEraAudit;
    if (audit) {
      ai_era_audit_json      = JSON.stringify(audit);
      eval_credibility       = audit.evalCredibility       ?? null;
      economic_defensibility = audit.economicDefensibility ?? null;
      operability_realism    = audit.operabilityRealism    ?? null;
      compliance_readiness   = audit.complianceReadiness   ?? null;
    }
  } catch { /* malformed JSON — leave as null */ }

  db.prepare(`
    INSERT INTO reviews (id, artifactId, qualityScore, recommendation, blocked,
                         hardGatesJson, softGatesJson, adversarialJson, driftJson, reviewedAt,
                         gate1_passed, gate2_passed, gate3_passed, gate4_passed, gate5_passed, gate6_passed,
                         ai_era_audit_json, eval_credibility, economic_defensibility, operability_realism, compliance_readiness)
    VALUES (@id, @artifactId, @qualityScore, @recommendation, @blocked,
            @hardGatesJson, @softGatesJson, @adversarialJson, @driftJson, @reviewedAt,
            @gate1_passed, @gate2_passed, @gate3_passed, @gate4_passed, @gate5_passed, @gate6_passed,
            @ai_era_audit_json, @eval_credibility, @economic_defensibility, @operability_realism, @compliance_readiness)
    ON CONFLICT(id) DO UPDATE SET
      qualityScore           = excluded.qualityScore,
      recommendation         = excluded.recommendation,
      blocked                = excluded.blocked,
      hardGatesJson          = excluded.hardGatesJson,
      softGatesJson          = excluded.softGatesJson,
      adversarialJson        = excluded.adversarialJson,
      driftJson              = excluded.driftJson,
      reviewedAt             = excluded.reviewedAt,
      gate1_passed           = excluded.gate1_passed,
      gate2_passed           = excluded.gate2_passed,
      gate3_passed           = excluded.gate3_passed,
      gate4_passed           = excluded.gate4_passed,
      gate5_passed           = excluded.gate5_passed,
      gate6_passed           = excluded.gate6_passed,
      ai_era_audit_json      = excluded.ai_era_audit_json,
      eval_credibility       = excluded.eval_credibility,
      economic_defensibility = excluded.economic_defensibility,
      operability_realism    = excluded.operability_realism,
      compliance_readiness   = excluded.compliance_readiness
  `).run({
    ...review,
    gate1_passed, gate2_passed, gate3_passed, gate4_passed, gate5_passed, gate6_passed,
    ai_era_audit_json, eval_credibility, economic_defensibility, operability_realism, compliance_readiness,
  });
  return getReview(review.id)!;
}

export function getReview(id: string): Review | undefined {
  return db.prepare("SELECT * FROM reviews WHERE id = ?").get(id) as Review | undefined;
}

export function getReviewsForArtifact(artifactId: string): Review[] {
  return db
    .prepare("SELECT * FROM reviews WHERE artifactId = ? ORDER BY reviewedAt DESC")
    .all(artifactId) as Review[];
}

/** Latest N reviews across all artifacts — used for the dashboard timeline. */
export function getReviewHistory(limit = 20): (Review & { artifactTitle: string | null })[] {
  return db
    .prepare(`
      SELECT r.*, a.title AS artifactTitle
      FROM reviews r
      LEFT JOIN artifacts a ON a.id = r.artifactId
      ORDER BY r.reviewedAt DESC
      LIMIT ?
    `)
    .all(limit) as (Review & { artifactTitle: string | null })[];
}

// ─────────────────────────────────────────────────────────────────────────────
// OKR baseline helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Upserts the given OKR and marks it as the single active baseline. */
export function setActiveOKRBaseline(okr: OKRBaseline): OKRBaseline {
  db.transaction(() => {
    db.prepare("UPDATE okr_baselines SET isActive = 0").run();
    db.prepare(`
      INSERT INTO okr_baselines (id, timeframe, content, setAt, isActive)
      VALUES (@id, @timeframe, @content, @setAt, 1)
      ON CONFLICT(id) DO UPDATE SET
        timeframe = excluded.timeframe,
        content   = excluded.content,
        setAt     = excluded.setAt,
        isActive  = 1
    `).run({ ...okr, isActive: 1 });
  })();
  return getActiveOKRBaseline()!;
}

export function getActiveOKRBaseline(): OKRBaseline | undefined {
  return db
    .prepare("SELECT * FROM okr_baselines WHERE isActive = 1 ORDER BY setAt DESC LIMIT 1")
    .get() as OKRBaseline | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard stats
// ─────────────────────────────────────────────────────────────────────────────

export function getDashboardStats(): DashboardStats {
  const totalArtifacts = (
    db.prepare("SELECT COUNT(*) AS n FROM artifacts").get() as { n: number }
  ).n;

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const reviewsThisWeek = (
    db
      .prepare("SELECT COUNT(*) AS n FROM reviews WHERE reviewedAt >= ?")
      .get(weekAgo) as { n: number }
  ).n;

  const scoreRow = db
    .prepare("SELECT AVG(qualityScore) AS avg FROM reviews WHERE qualityScore IS NOT NULL")
    .get() as { avg: number | null };

  const blockedCount = (
    db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE blocked = 1").get() as { n: number }
  ).n;

  const countByRec = db
    .prepare(`
      SELECT recommendation, COUNT(*) AS n
      FROM reviews
      WHERE recommendation IS NOT NULL
      GROUP BY recommendation
    `)
    .all() as { recommendation: string; n: number }[];

  const rec = Object.fromEntries(countByRec.map((r) => [r.recommendation, r.n]));

  const gateRates = db
    .prepare("SELECT * FROM gate_health_summary")
    .get() as {
      gate1_rate: number | null;
      gate2_rate: number | null;
      gate3_rate: number | null;
      gate4_rate: number | null;
      gate5_rate: number | null;
      gate6_rate: number | null;
    } | undefined;

  return {
    totalArtifacts,
    reviewsThisWeek,
    avgQualityScore: scoreRow.avg !== null ? Math.round(scoreRow.avg) : null,
    blockedCount,
    approvedCount: rec["approve"] ?? 0,
    revisedCount:  rec["revise"]  ?? 0,
    rejectedCount: rec["reject"]  ?? 0,
    gatePassRates: {
      gate1: gateRates?.gate1_rate ?? 0,
      gate2: gateRates?.gate2_rate ?? 0,
      gate3: gateRates?.gate3_rate ?? 0,
      gate4: gateRates?.gate4_rate ?? 0,
      gate5: gateRates?.gate5_rate ?? 0,
      gate6: gateRates?.gate6_rate ?? 0,
    },
  };
}
