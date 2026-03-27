/**
 * POST /api/seed
 * Populates the DB with representative demo data for the review pipeline.
 * Idempotent — skips if artifacts already exist.
 */
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createHash } from "crypto";
import {
  db,
  saveArtifact,
  saveReview,
  setActiveOKRBaseline,
} from "@/lib/db/client";

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function isoOffset(daysAgo: number) {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString();
}

export async function POST() {
  // Idempotency check
  const existing = (db.prepare("SELECT COUNT(*) AS n FROM artifacts").get() as { n: number }).n;
  if (existing > 0) {
    return NextResponse.json({ message: "Already seeded — skipping." }, { status: 200 });
  }

  // ── OKR baseline ────────────────────────────────────────────────────────────
  const okrContent = JSON.stringify({
    objectives: [
      {
        title: "Increase user retention",
        keyResults: [
          { description: "Raise 30-day retention from 42% to 55%", target: 55 },
          { description: "Reduce churn rate by 10 pp", target: 10 },
        ],
      },
      {
        title: "Accelerate feature velocity",
        keyResults: [
          { description: "Ship 12 customer-requested features in Q1", target: 12 },
          { description: "Cut avg cycle time from 14 days to 8 days", target: 8 },
        ],
      },
    ],
  });

  setActiveOKRBaseline({
    id: randomUUID(),
    timeframe: "Q1-2026",
    content: okrContent,
    setAt: isoOffset(30),
    isActive: 1,
  });

  // ── Artifacts & Reviews ─────────────────────────────────────────────────────
  const samples: Array<{
    artifactType: string;
    title: string;
    content: object;
    qualityScore: number;
    recommendation: "approve" | "revise" | "reject";
    blocked: boolean;
    daysAgo: number;
  }> = [
    {
      artifactType: "prd",
      title: "Onboarding Flow Redesign",
      content: {
        overview: "Redesign the 5-step onboarding wizard to reduce drop-off.",
        goals: ["Improve activation rate to 70%", "Reduce time-to-value to < 3 min"],
        requirements: [
          "Single-page progressive disclosure",
          "Skip optional steps",
          "Mobile-responsive",
        ],
        successMetrics: { activationRate: 0.7, ttv: 180 },
      },
      qualityScore: 88,
      recommendation: "approve",
      blocked: false,
      daysAgo: 12,
    },
    {
      artifactType: "prd",
      title: "AI-Powered Search",
      content: {
        overview: "Replace keyword search with semantic vector search.",
        goals: ["Reduce zero-result queries by 40%"],
        requirements: ["Embedding model integration", "Fallback to BM25", "< 200 ms p99"],
        successMetrics: { zeroResultRate: 0.05, latencyP99: 200 },
      },
      qualityScore: 74,
      recommendation: "revise",
      blocked: false,
      daysAgo: 8,
    },
    {
      artifactType: "okr",
      title: "Q1 2026 OKRs — Engineering",
      content: {
        objectives: [
          {
            title: "Ship reliable infrastructure",
            keyResults: [
              { description: "99.95% uptime", target: 99.95 },
              { description: "Zero P0 incidents", target: 0 },
            ],
          },
        ],
      },
      qualityScore: 91,
      recommendation: "approve",
      blocked: false,
      daysAgo: 25,
    },
    {
      artifactType: "ticket",
      title: "DASH-210: Export to CSV",
      content: {
        description: "Users must be able to export any dashboard view to CSV.",
        acceptanceCriteria: [
          "Button visible on all chart widgets",
          "File downloads within 2 s for up to 10k rows",
        ],
      },
      qualityScore: 55,
      recommendation: "revise",
      blocked: false,
      daysAgo: 3,
    },
    {
      artifactType: "prd",
      title: "Real-Time Collaboration (Draft)",
      content: {
        overview: "Allow multiple users to edit a document simultaneously.",
        goals: [],
        requirements: [],
        successMetrics: {},
      },
      qualityScore: 28,
      recommendation: "reject",
      blocked: true,
      daysAgo: 1,
    },
  ];

  for (const s of samples) {
    const contentStr = JSON.stringify(s.content);
    const artifactId = randomUUID();
    const reviewId = randomUUID();
    const createdAt = isoOffset(s.daysAgo);

    saveArtifact({
      id: artifactId,
      artifactType: s.artifactType,
      title: s.title,
      content: contentStr,
      contentHash: sha256(contentStr),
      schemaVersion: "1.0",
      createdAt,
      updatedAt: createdAt,
    });

    const allPass = !s.blocked && s.qualityScore >= 70;
    const hardGates = [
      { gateId: "G1-problem-length", gateName: "Problem Statement Length",  phase: "Gate 1: Evidence-Grounded Problem", passed: allPass || s.qualityScore >= 85, reason: allPass ? "Problem statement meets length requirement." : "Problem statement is too short.",        blocksSubmission: true, documentationRef: "" },
      { gateId: "G1-evidence-count", gateName: "Evidence Signal Count",     phase: "Gate 1: Evidence-Grounded Problem", passed: allPass || s.qualityScore >= 80, reason: allPass ? "2 evidence signals provided." : "Only 1 evidence signal provided.",                    blocksSubmission: true, documentationRef: "" },
      { gateId: "G2-eval-missing",   gateName: "Synthetic Eval Present",    phase: "Gate 2: Synthetic Evals",           passed: allPass || s.qualityScore >= 75, reason: allPass ? "Eval section present." : "syntheticEval section missing.",                              blocksSubmission: true, documentationRef: "" },
      { gateId: "G2-groundedness",   gateName: "Groundedness Score",        phase: "Gate 2: Synthetic Evals",           passed: allPass,                          reason: allPass ? "Groundedness 94%." : "Groundedness 78% — below 90% threshold.",                       blocksSubmission: true, documentationRef: "" },
      { gateId: "G3-tco-missing",    gateName: "TCO Analysis Present",      phase: "Gate 3: ROI Moat",                  passed: allPass || s.qualityScore >= 70, reason: allPass ? "tcoAnalysis present." : "tcoAnalysis section missing.",                               blocksSubmission: true, documentationRef: "" },
      { gateId: "G3-roi-moat",       gateName: "ROI Moat Justification",    phase: "Gate 3: ROI Moat",                  passed: allPass,                          reason: allPass ? "ROI moat documented." : "roiMoat too short.",                                         blocksSubmission: true, documentationRef: "" },
      { gateId: "G4-nfr-missing",    gateName: "NFR Section Present",       phase: "Gate 4: NFR Zero Tolerance",        passed: !s.blocked,                       reason: !s.blocked ? "nonFunctionalRequirements present." : "NFR section missing.",                    blocksSubmission: true, documentationRef: "" },
      { gateId: "G4-compliance",     gateName: "Compliance Frameworks",     phase: "Gate 4: NFR Zero Tolerance",        passed: !s.blocked,                       reason: !s.blocked ? "GDPR, SOC 2 declared." : "complianceFrameworks empty.",                          blocksSubmission: true, documentationRef: "" },
      { gateId: "G5-ops-missing",    gateName: "Operability Constraints",   phase: "Gate 5: Operability Constraints",   passed: !s.blocked,                       reason: !s.blocked ? "operabilityConstraints present." : "operabilityConstraints missing.",            blocksSubmission: true, documentationRef: "" },
      { gateId: "G5-fallback",       gateName: "Fallback Plan",             phase: "Gate 5: Operability Constraints",   passed: !s.blocked,                       reason: !s.blocked ? "Fallback plan documented." : "fallbackPlan too short.",                          blocksSubmission: true, documentationRef: "" },
      { gateId: "G6-metric-count",   gateName: "Success Metric Count",      phase: "Gate 6: Quantified Success",        passed: s.qualityScore >= 55,             reason: s.qualityScore >= 55 ? "2 metrics defined." : "Only 1 metric defined.",                       blocksSubmission: true, documentationRef: "" },
      { gateId: "G6-numeric-targets",gateName: "Numeric Metric Targets",    phase: "Gate 6: Quantified Success",        passed: s.qualityScore >= 70,             reason: s.qualityScore >= 70 ? "All targets are numeric." : "Metric targets are vague.",                blocksSubmission: true, documentationRef: "" },
    ];

    const evalCredibility       = s.qualityScore >= 80 ? "credible"   : s.qualityScore >= 60 ? "questionable" : "missing";
    const economicDefensibility = s.qualityScore >= 75 ? "strong"     : s.qualityScore >= 55 ? "weak"         : "missing";
    const operabilityRealism    = s.qualityScore >= 70 ? "realistic"  : s.qualityScore >= 50 ? "optimistic"   : "missing";
    const complianceReadiness   = s.qualityScore >= 65 ? "ready"      : s.qualityScore >= 45 ? "gaps"         : "missing";

    saveReview({
      id: reviewId,
      artifactId,
      qualityScore: s.qualityScore,
      recommendation: s.recommendation,
      blocked: s.blocked ? 1 : 0,
      hardGatesJson: JSON.stringify(hardGates),
      softGatesJson: JSON.stringify([
        {
          gate: "success_metrics_defined",
          passed: s.qualityScore >= 70,
          suggestion: s.qualityScore < 70 ? "Add measurable success metrics" : null,
        },
      ]),
      adversarialJson: JSON.stringify({
        overallRisk: s.qualityScore < 50 ? "critical" : s.qualityScore < 75 ? "high" : "medium",
        findings: s.qualityScore < 70
          ? [{ findingType: "missing_evidence", description: "Insufficient supporting evidence" }]
          : [],
        aiEraAudit: { evalCredibility, economicDefensibility, operabilityRealism, complianceReadiness },
      }),
      driftJson: JSON.stringify({
        aligned: s.qualityScore >= 70,
        driftedObjectives: s.qualityScore < 70 ? ["Increase user retention"] : [],
      }),
      reviewedAt: isoOffset(s.daysAgo - 0.1),
      gate1_passed: null, gate2_passed: null, gate3_passed: null,
      gate4_passed: null, gate5_passed: null, gate6_passed: null,
      ai_era_audit_json: null, eval_credibility: null,
      economic_defensibility: null, operability_realism: null, compliance_readiness: null,
    });
  }

  return NextResponse.json(
    { message: "Seeded successfully.", artifacts: samples.length },
    { status: 201 }
  );
}
