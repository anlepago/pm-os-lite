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

    saveReview({
      id: reviewId,
      artifactId,
      qualityScore: s.qualityScore,
      recommendation: s.recommendation,
      blocked: s.blocked ? 1 : 0,
      hardGatesJson: JSON.stringify(
        s.blocked
          ? [{ gate: "minimum_content", passed: false, reason: "Required sections are empty" }]
          : [{ gate: "minimum_content", passed: true }]
      ),
      softGatesJson: JSON.stringify([
        {
          gate: "success_metrics_defined",
          passed: s.qualityScore >= 70,
          suggestion: s.qualityScore < 70 ? "Add measurable success metrics" : null,
        },
      ]),
      adversarialJson: JSON.stringify({
        riskLevel: s.qualityScore < 50 ? "high" : s.qualityScore < 75 ? "medium" : "low",
        concerns:
          s.qualityScore < 50
            ? ["Insufficient detail to assess feasibility", "Missing acceptance criteria"]
            : [],
      }),
      driftJson: JSON.stringify({
        aligned: s.qualityScore >= 70,
        driftedObjectives:
          s.qualityScore < 70 ? ["Increase user retention"] : [],
      }),
      reviewedAt: isoOffset(s.daysAgo - 0.1),
    });
  }

  return NextResponse.json(
    { message: "Seeded successfully.", artifacts: samples.length },
    { status: 201 }
  );
}
