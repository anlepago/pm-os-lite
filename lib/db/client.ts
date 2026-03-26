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

export function saveReview(review: Review): Review {
  db.prepare(`
    INSERT INTO reviews (id, artifactId, qualityScore, recommendation, blocked,
                         hardGatesJson, softGatesJson, adversarialJson, driftJson, reviewedAt)
    VALUES (@id, @artifactId, @qualityScore, @recommendation, @blocked,
            @hardGatesJson, @softGatesJson, @adversarialJson, @driftJson, @reviewedAt)
    ON CONFLICT(id) DO UPDATE SET
      qualityScore    = excluded.qualityScore,
      recommendation  = excluded.recommendation,
      blocked         = excluded.blocked,
      hardGatesJson   = excluded.hardGatesJson,
      softGatesJson   = excluded.softGatesJson,
      adversarialJson = excluded.adversarialJson,
      driftJson       = excluded.driftJson,
      reviewedAt      = excluded.reviewedAt
  `).run(review);
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

  return {
    totalArtifacts,
    reviewsThisWeek,
    avgQualityScore: scoreRow.avg !== null ? Math.round(scoreRow.avg) : null,
    blockedCount,
    approvedCount: rec["approve"] ?? 0,
    revisedCount:  rec["revise"]  ?? 0,
    rejectedCount: rec["reject"]  ?? 0,
  };
}
