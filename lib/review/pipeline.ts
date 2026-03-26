/**
 * Review pipeline — orchestrates hard gates, soft gates, and the adversarial
 * AI reviewer into a single unified ReviewReport.
 *
 * The three analysis steps are deliberately run in parallel:
 * - Hard and soft gates are synchronous and complete in microseconds.
 * - The adversarial review is the only I/O-bound step (Claude API call,
 *   or a SQLite cache hit that is also fast).
 * Wrapping all three in Promise.all makes the intent explicit and future-proofs
 * the code for a world where gate logic becomes async (e.g. DB lookups).
 */
import { db } from "@/lib/db/client";
import { runHardGates, type HardGateResult } from "@/lib/gates/hard-gates";
import { runSoftGates, computeQualityScore, type SoftGateResult } from "@/lib/gates/soft-gates";
import {
  reviewArtifact as adversarialReview,
  type AdversarialReview,
  type PRDArtifact,
} from "@/lib/agents/adversarial-reviewer";
import { PRDSchema } from "@/lib/schemas/prd.schema";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Recommendation = "approve" | "revise" | "reject";

export interface ReviewReport {
  artifactId: string | null;
  /** Human-readable artifact name stored for dashboard queries. */
  artifactName: string;
  /** "prd" | "okr" | "brief" — stored for timeline filtering. */
  artifactType: string;
  timestamp: string;
  hardGates: HardGateResult[];
  softGates: SoftGateResult[];
  adversarialReview: AdversarialReview;
  qualityScore: number;
  recommendation: Recommendation;
  blocked: boolean;
}

// ── Table init (lazy) ─────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS review_reports (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    artifact_id        TEXT,
    artifact_name      TEXT NOT NULL DEFAULT 'Unknown',
    artifact_type      TEXT NOT NULL DEFAULT 'prd',
    timestamp          TEXT NOT NULL,
    hard_gates         TEXT NOT NULL DEFAULT '[]',
    soft_gates         TEXT NOT NULL DEFAULT '[]',
    adversarial_review TEXT NOT NULL DEFAULT '{}',
    quality_score      REAL NOT NULL,
    recommendation     TEXT NOT NULL,
    blocked            INTEGER NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Migrate existing tables that pre-date these columns
for (const col of ["artifact_name TEXT NOT NULL DEFAULT 'Unknown'", "artifact_type TEXT NOT NULL DEFAULT 'prd'"]) {
  try { db.exec(`ALTER TABLE review_reports ADD COLUMN ${col}`); } catch { /* already exists */ }
}

// ── Cache ─────────────────────────────────────────────────────────────────────

const CACHE_TTL_HOURS = 24;

export function getCachedReport(artifactId: string): ReviewReport | null {
  const row = db
    .prepare(
      `SELECT * FROM review_reports
       WHERE artifact_id = ?
         AND created_at >= datetime('now', '-${CACHE_TTL_HOURS} hours')
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(artifactId) as Record<string, unknown> | undefined;

  if (!row) return null;

  try {
    return deserialiseRow(row);
  } catch {
    return null;
  }
}

function deserialiseRow(row: Record<string, unknown>): ReviewReport {
  return {
    artifactId: (row.artifact_id as string | null) ?? null,
    artifactName: (row.artifact_name as string) ?? "Unknown",
    artifactType: (row.artifact_type as string) ?? "prd",
    timestamp: row.timestamp as string,
    hardGates: JSON.parse(row.hard_gates as string) as HardGateResult[],
    softGates: JSON.parse(row.soft_gates as string) as SoftGateResult[],
    adversarialReview: JSON.parse(row.adversarial_review as string) as AdversarialReview,
    qualityScore: row.quality_score as number,
    recommendation: row.recommendation as Recommendation,
    blocked: row.blocked === 1,
  };
}

export function persistReport(report: ReviewReport): void {
  db.prepare(
    `INSERT INTO review_reports
       (artifact_id, artifact_name, artifact_type, timestamp,
        hard_gates, soft_gates, adversarial_review,
        quality_score, recommendation, blocked)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    report.artifactId ?? null,
    report.artifactName,
    report.artifactType,
    report.timestamp,
    JSON.stringify(report.hardGates),
    JSON.stringify(report.softGates),
    JSON.stringify(report.adversarialReview),
    report.qualityScore,
    report.recommendation,
    report.blocked ? 1 : 0
  );
}

// ── Artifact fetch ────────────────────────────────────────────────────────────

/**
 * Fetches an artifact from the `artifacts` table and parses its content field
 * as a PRDArtifact (expects JSON with artifactType: "prd").
 *
 * Throws if the artifact is not found or the content is not a valid PRDArtifact.
 */
export function fetchArtifactById(artifactId: string): PRDArtifact {
  const row = db
    .prepare("SELECT * FROM artifacts WHERE id = ?")
    .get(artifactId) as Record<string, unknown> | undefined;

  if (!row) {
    throw new Error(`Artifact "${artifactId}" not found in database`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.content as string);
  } catch {
    throw new Error(
      `Artifact "${artifactId}" content is not valid JSON. ` +
        `The review pipeline requires artifacts stored as JSON PRDArtifacts.`
    );
  }

  const result = PRDSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Artifact "${artifactId}" content does not match PRD schema: ` +
        JSON.stringify(result.error.flatten().fieldErrors)
    );
  }

  return result.data;
}

// ── Quality score ─────────────────────────────────────────────────────────────

/**
 * Composite quality score (0–100):
 *
 * Components and weights:
 *   40% — Soft gate score   (process quality: measurement, specificity, scope hygiene)
 *   40% — AI risk score     (strategic quality: assumptions, evidence, reasoning)
 *   20% — Hard gate score   (structural completeness: 100 if all pass, 0 if any fail)
 *
 * The AI risk score maps overallRisk → number so the composite reflects
 * Claude's holistic judgement alongside the deterministic gate checks.
 */
const RISK_SCORE: Record<AdversarialReview["overallRisk"], number> = {
  low: 100,
  medium: 70,
  high: 35,
  critical: 0,
};

export function computeCompositeScore(
  hardResults: HardGateResult[],
  softResults: SoftGateResult[],
  aiReview: AdversarialReview
): number {
  const hardScore = hardResults.every((r) => r.passed) ? 100 : 0;
  const softScore = computeQualityScore(softResults);
  const aiScore = RISK_SCORE[aiReview.overallRisk];

  return Math.round(hardScore * 0.2 + softScore * 0.4 + aiScore * 0.4);
}

// ── Recommendation ────────────────────────────────────────────────────────────

/**
 * Derives the recommendation from gate results and AI review output.
 *
 * reject  — overallRisk is critical OR any hard gate failed
 *           (the artifact has fundamental structural or strategic problems)
 * revise  — qualityScore < 65 OR more than 3 severity-2/3 findings
 *           (the artifact needs meaningful work before approval)
 * approve — all other cases
 */
export function deriveRecommendation(
  hardResults: HardGateResult[],
  aiReview: AdversarialReview,
  qualityScore: number
): Recommendation {
  const anyHardFail = hardResults.some((r) => !r.passed);
  if (aiReview.overallRisk === "critical" || anyHardFail) return "reject";

  const significantFindings = aiReview.findings.filter((f) => f.severity >= 2).length;
  if (qualityScore < 65 || significantFindings > 3) return "revise";

  return "approve";
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

/**
 * runReviewPipeline — the core orchestration function.
 *
 * Runs hard gates, soft gates, and the adversarial AI reviewer in parallel.
 * Composes results into a unified ReviewReport and persists it to SQLite.
 *
 * @param artifact  The PRD artifact to review (already validated by the caller).
 * @param artifactId  Optional stable ID for cache keying and report association.
 * @returns         The complete ReviewReport.
 */
export async function runReviewPipeline(
  artifact: PRDArtifact,
  artifactId: string | null = null,
  artifactName?: string,
  artifactType?: string
): Promise<ReviewReport> {
  // Run all three analyses in parallel.
  // Gates are sync but wrapped in Promise.resolve so Promise.all handles them uniformly.
  const [hardResults, softResults, aiReview] = await Promise.all([
    Promise.resolve(runHardGates(artifact)),
    Promise.resolve(runSoftGates(artifact)),
    adversarialReview(artifact),
  ]);

  const qualityScore = computeCompositeScore(hardResults, softResults, aiReview);
  const recommendation = deriveRecommendation(hardResults, aiReview, qualityScore);
  const blocked = hardResults.some((r) => !r.passed) || recommendation === "reject";

  const report: ReviewReport = {
    artifactId,
    artifactName: artifactName ?? artifact.title,
    artifactType: artifactType ?? artifact.artifactType,
    timestamp: new Date().toISOString(),
    hardGates: hardResults,
    softGates: softResults,
    adversarialReview: aiReview,
    qualityScore,
    recommendation,
    blocked,
  };

  persistReport(report);
  return report;
}
