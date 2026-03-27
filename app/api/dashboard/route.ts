import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";

// ── Types ─────────────────────────────────────────────────────────────────────

const GATE_DEFS = [
  { prefix: "Gate 1", name: "Context Engineering" },
  { prefix: "Gate 2", name: "Synthetic Evals" },
  { prefix: "Gate 3", name: "ROI Moat" },
  { prefix: "Gate 4", name: "NFR Compliance" },
  { prefix: "Gate 5", name: "Operability" },
  { prefix: "Gate 6", name: "Success Metrics" },
];

interface HardGateResultRaw {
  phase: string;
  passed: boolean;
  reason: string;
}

interface AiEraAuditRaw {
  evalCredibility?: string;
  economicDefensibility?: string;
  operabilityRealism?: string;
  complianceReadiness?: string;
}

interface RawReviewRow {
  id: number;
  artifact_id: string | null;
  artifact_name: string;
  artifact_type: string;
  timestamp: string;
  hard_gates: string;
  soft_gates: string;
  adversarial_review: string;
  quality_score: number;
  recommendation: string;
  blocked: number;
  created_at: string;
}

interface RawDriftRow {
  pair_hash: string;
  artifact_label: string;
  result_json: string;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeParseJSON<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

function isoDateOnly(isoString: string): string {
  return isoString.slice(0, 10);
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  // Ensure migration columns exist for older DBs
  for (const col of [
    "artifact_name TEXT NOT NULL DEFAULT 'Unknown'",
    "artifact_type TEXT NOT NULL DEFAULT 'prd'",
  ]) {
    try { db.exec(`ALTER TABLE review_reports ADD COLUMN ${col}`); } catch { /* exists */ }
  }
  try { db.exec(`ALTER TABLE drift_comparison_cache ADD COLUMN artifact_label TEXT NOT NULL DEFAULT ''`); } catch { /* exists */ }

  const allReviews = db
    .prepare("SELECT * FROM review_reports ORDER BY created_at DESC LIMIT 200")
    .all() as RawReviewRow[];

  // ── Stats ──────────────────────────────────────────────────────────────────

  const totalArtifacts = allReviews.length;

  const avgQualityScore =
    totalArtifacts > 0
      ? Math.round(allReviews.reduce((s, r) => s + r.quality_score, 0) / totalArtifacts)
      : 0;

  // Trend: compare avg of last 7 days vs the 7 days before that
  const now = Date.now();
  const day = 86_400_000;
  const last7 = allReviews.filter(
    (r) => new Date(r.created_at).getTime() > now - 7 * day
  );
  const prev7 = allReviews.filter((r) => {
    const t = new Date(r.created_at).getTime();
    return t > now - 14 * day && t <= now - 7 * day;
  });
  const last7Avg = last7.length
    ? last7.reduce((s, r) => s + r.quality_score, 0) / last7.length
    : 0;
  const prev7Avg = prev7.length
    ? prev7.reduce((s, r) => s + r.quality_score, 0) / prev7.length
    : 0;
  const qualityScoreTrend = Math.round(last7Avg - prev7Avg);

  // Hard gate pass rate: % of all individual gate checks that passed
  let gateTotal = 0;
  let gatePassed = 0;
  for (const row of allReviews) {
    const gates = safeParseJSON<{ passed: boolean }[]>(row.hard_gates, []);
    gateTotal += gates.length;
    gatePassed += gates.filter((g) => g.passed).length;
  }
  const hardGatePassRate =
    gateTotal > 0 ? Math.round((gatePassed / gateTotal) * 100) : 0;

  // Drift incidents this month: from drift_comparison_cache
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const driftRows = db
    .prepare(
      `SELECT result_json FROM drift_comparison_cache
       WHERE created_at >= ? AND json_extract(result_json, '$.driftScore') > 40`
    )
    .all(monthStart.toISOString()) as { result_json: string }[];
  const driftIncidentsThisMonth = driftRows.length;

  // ── Quality timeline ───────────────────────────────────────────────────────

  // Up to 60 most recent reviews, grouped for the chart
  const timeline = allReviews
    .slice(0, 60)
    .reverse() // oldest first for chart
    .map((r, i) => ({
      index: i + 1,
      date: isoDateOnly(r.timestamp),
      artifactName: r.artifact_name,
      artifactType: r.artifact_type,
      qualityScore: r.quality_score,
      recommendation: r.recommendation,
      id: r.id,
    }));

  // ── Gate breakdown ─────────────────────────────────────────────────────────

  const gateMap = new Map<string, { passed: number; failed: number }>();
  for (const row of allReviews) {
    const gates = safeParseJSON<{ gateName: string; passed: boolean }[]>(
      row.hard_gates,
      []
    );
    for (const g of gates) {
      const entry = gateMap.get(g.gateName) ?? { passed: 0, failed: 0 };
      g.passed ? entry.passed++ : entry.failed++;
      gateMap.set(g.gateName, entry);
    }
  }
  const gateBreakdown = Array.from(gateMap.entries())
    .map(([gateName, counts]) => ({
      gateName: gateName.replace(/([A-Z])/g, " $1").trim(), // camelCase → words
      passed: counts.passed,
      failed: counts.failed,
      total: counts.passed + counts.failed,
      passRate: Math.round((counts.passed / (counts.passed + counts.failed)) * 100),
    }))
    .sort((a, b) => a.passRate - b.passRate); // worst gates first

  // ── Recent reviews ─────────────────────────────────────────────────────────

  // For drift verdict, look up by artifact_id in drift cache
  const driftLookup = new Map<string, { verdict: string; score: number }>();
  const allDrift = db
    .prepare("SELECT artifact_label, result_json FROM drift_comparison_cache ORDER BY created_at DESC")
    .all() as Pick<RawDriftRow, "artifact_label" | "result_json">[];

  for (const d of allDrift) {
    const parsed = safeParseJSON<{ verdict?: string; driftScore?: number }>(
      d.result_json,
      {}
    );
    if (!driftLookup.has(d.artifact_label)) {
      driftLookup.set(d.artifact_label, {
        verdict: parsed.verdict ?? "unknown",
        score: parsed.driftScore ?? 0,
      });
    }
  }

  const recentReviews = allReviews.slice(0, 10).map((r) => {
    const drift =
      driftLookup.get(r.artifact_name) ??
      driftLookup.get(`PRD: ${r.artifact_name}`) ??
      null;
    const gates = safeParseJSON<HardGateResultRaw[]>(r.hard_gates, []);
    const gateStatuses = GATE_DEFS.map(({ prefix }) => {
      const forGate = gates.filter((g) => g.phase.startsWith(prefix));
      return forGate.length === 0 || forGate.every((g) => g.passed);
    });
    return {
      id: r.id,
      artifactId: r.artifact_id,
      artifactName: r.artifact_name,
      artifactType: r.artifact_type,
      timestamp: r.timestamp,
      qualityScore: r.quality_score,
      recommendation: r.recommendation,
      blocked: r.blocked === 1,
      driftVerdict: drift?.verdict ?? null,
      driftScore: drift?.score ?? null,
      gateStatuses,
    };
  });

  // ── Gate health panel ──────────────────────────────────────────────────────

  const gateHealthPanel = GATE_DEFS.map(({ prefix, name }) => {
    let passed = 0, failed = 0;
    const failReasonCounts = new Map<string, number>();

    for (const row of allReviews) {
      const gates = safeParseJSON<HardGateResultRaw[]>(row.hard_gates, []);
      const forGate = gates.filter((g) => g.phase.startsWith(prefix));
      if (forGate.length === 0) continue;

      if (forGate.every((g) => g.passed)) {
        passed++;
      } else {
        failed++;
        for (const g of forGate.filter((g) => !g.passed)) {
          failReasonCounts.set(g.reason, (failReasonCounts.get(g.reason) ?? 0) + 1);
        }
      }
    }

    const total = passed + failed;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

    let topFailureReason: string | null = null;
    let maxCount = 0;
    for (const [reason, count] of failReasonCounts) {
      if (count > maxCount) { maxCount = count; topFailureReason = reason; }
    }
    if (topFailureReason && topFailureReason.length > 120) {
      topFailureReason = topFailureReason.slice(0, 117) + "…";
    }

    return { prefix, name, passed, failed, total, passRate, topFailureReason };
  });

  // ── Findings aggregate ─────────────────────────────────────────────────────

  const findingMap = new Map<string, number>();
  for (const row of allReviews) {
    const review = safeParseJSON<{
      findings?: { findingType: string }[];
    }>(row.adversarial_review, {});
    for (const f of review.findings ?? []) {
      findingMap.set(f.findingType, (findingMap.get(f.findingType) ?? 0) + 1);
    }
  }
  const findingsAggregate = Array.from(findingMap.entries())
    .map(([findingType, count]) => ({ findingType, count }))
    .sort((a, b) => b.count - a.count);

  // ── AI-era audit aggregate ─────────────────────────────────────────────────

  const aiEraAuditAggregate = {
    evalCredibility: { credible: 0, questionable: 0, missing: 0 },
    economicDefensibility: { strong: 0, weak: 0, missing: 0 },
    operabilityRealism: { realistic: 0, optimistic: 0, missing: 0 },
    complianceReadiness: { ready: 0, gaps: 0, missing: 0 },
  };

  for (const row of allReviews) {
    const review = safeParseJSON<{ aiEraAudit?: AiEraAuditRaw }>(row.adversarial_review, {});
    const audit = review.aiEraAudit;
    if (!audit) continue;

    const ec = audit.evalCredibility;
    if (ec === "credible" || ec === "questionable" || ec === "missing") aiEraAuditAggregate.evalCredibility[ec]++;
    else aiEraAuditAggregate.evalCredibility.missing++;

    const ed = audit.economicDefensibility;
    if (ed === "strong" || ed === "weak" || ed === "missing") aiEraAuditAggregate.economicDefensibility[ed]++;
    else aiEraAuditAggregate.economicDefensibility.missing++;

    const or_ = audit.operabilityRealism;
    if (or_ === "realistic" || or_ === "optimistic" || or_ === "missing") aiEraAuditAggregate.operabilityRealism[or_]++;
    else aiEraAuditAggregate.operabilityRealism.missing++;

    const cr = audit.complianceReadiness;
    if (cr === "ready" || cr === "gaps" || cr === "missing") aiEraAuditAggregate.complianceReadiness[cr]++;
    else aiEraAuditAggregate.complianceReadiness.missing++;
  }

  // ── Drift heatmap ──────────────────────────────────────────────────────────

  const allDriftFull = db
    .prepare(
      "SELECT artifact_label, result_json, created_at FROM drift_comparison_cache ORDER BY created_at DESC LIMIT 100"
    )
    .all() as Pick<RawDriftRow, "artifact_label" | "result_json" | "created_at">[];

  const driftHeatmap = allDriftFull.map((d) => {
    const parsed = safeParseJSON<{ driftScore?: number; verdict?: string }>(
      d.result_json,
      {}
    );
    return {
      artifactLabel: d.artifact_label,
      date: isoDateOnly(d.created_at),
      driftScore: parsed.driftScore ?? 0,
      verdict: parsed.verdict ?? "unknown",
    };
  });

  return NextResponse.json({
    stats: {
      totalArtifacts,
      avgQualityScore,
      qualityScoreTrend,
      hardGatePassRate,
      driftIncidentsThisMonth,
    },
    timeline,
    gateBreakdown,
    gateHealthPanel,
    recentReviews,
    findingsAggregate,
    driftHeatmap,
    aiEraAuditAggregate,
  });
}
