/**
 * Adversarial Reviewer — calls Claude acting as a hostile-but-constructive VP of Product.
 *
 * Uses tool_use (forced tool call) to guarantee structured JSON output —
 * more reliable than prompting for JSON prose and hoping the model complies.
 *
 * Results are cached in SQLite by a SHA-256 hash of the artifact content so
 * identical PRDs never trigger a redundant API call. Token usage is logged
 * on every live call for cost tracking.
 */
import { createHash } from "crypto";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./client";
import { db } from "@/lib/db/client";
import type { PRD } from "@/lib/schemas/prd.schema";
import type { HardGateResult } from "@/lib/gates/hard-gates";

// ── Model ─────────────────────────────────────────────────────────────────────

const ADVERSARIAL_MODEL = "claude-sonnet-4-20250514";

// ── Output schema (Zod) ───────────────────────────────────────────────────────

export const AdversarialFindingSchema = z.object({
  /** Which top-level section of the PRD this finding targets. */
  section: z.string(),

  findingType: z.enum([
    "assumption",       // unstated belief the whole argument rests on
    "contradiction",    // two parts of the PRD conflict with each other
    "vanity_metric",    // metric that looks good but doesn't prove value
    "missing_evidence", // claim made without supporting data or research
    "scope_risk",       // scope boundary that is likely to be violated
    "eval_integrity",   // eval dataset is unrepresentative or scores are inflated
    "tco_defensibility",// TCO figures are optimistic or ROI moat is weak
    "nfr_gap",          // compliance, PII, or explainability requirement is missing
    "operability_risk", // pilot scope, timeline, or fallback plan is unrealistic
    "monitoring_gap",   // metric cannot be measured in production or can be gamed
  ]),

  /** Plain-language description of the problem. */
  description: z.string(),

  /**
   * The specific hard question the PM must answer before this concern is resolved.
   * Framed as a question, not a command, so it lands as coaching not criticism.
   */
  suggestedQuestion: z.string(),

  /** 1 = minor note, 2 = significant concern, 3 = critical blocker. */
  severity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export const AdversarialReviewSchema = z.object({
  overallRisk: z.enum(["low", "medium", "high", "critical"]),

  findings: z.array(AdversarialFindingSchema),

  /**
   * The top 3 most critical concerns — the ones a VP would lead with
   * in a review meeting. Array is capped at 3 in the tool schema.
   */
  redFlags: z.array(z.string()).max(3),

  /** Sections or claims that are genuinely well-defined — balance the critique. */
  strengthSignals: z.array(z.string()),

  /** AI-era audit verdicts across the four dimensions most likely to cause late-stage failure. */
  aiEraAudit: z.object({
    /** Are the eval scores credible and the dataset representative? */
    evalCredibility: z.enum(["credible", "questionable", "missing"]),
    /** Is the TCO realistic and the ROI moat actually defensible? */
    economicDefensibility: z.enum(["strong", "weak", "missing"]),
    /** Is the 90-day pilot realistic and the scope mechanism enforceable? */
    operabilityRealism: z.enum(["realistic", "optimistic", "missing"]),
    /** Are compliance frameworks and PII handling real, not theoretical? */
    complianceReadiness: z.enum(["ready", "gaps", "missing"]),
  }),
});

export type AdversarialFinding = z.infer<typeof AdversarialFindingSchema>;
export type AdversarialReview = z.infer<typeof AdversarialReviewSchema>;

/** PRDArtifact is a PRD schema type (aliased for readability at call sites). */
export type PRDArtifact = PRD;

/**
 * AdversarialReviewResult — the full result returned by reviewArtifact().
 * Extends AdversarialReview with a computed recommendation and quality score.
 */
export type AdversarialReviewResult = AdversarialReview & {
  /** Overall recommendation derived by computeRecommendation(). */
  recommendation: "approve" | "revise" | "reject";
  /** 0–100 quality score computed from finding severities. */
  qualityScore: number;
};

// ── Token usage log ───────────────────────────────────────────────────────────

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

function logTokenUsage(artifactHash: string, usage: TokenUsage): void {
  const totalCost =
    // claude-sonnet-4 pricing (approximate, USD per million tokens)
    (usage.inputTokens / 1_000_000) * 3.0 +
    (usage.outputTokens / 1_000_000) * 15.0 +
    (usage.cacheReadTokens / 1_000_000) * 0.3 +
    (usage.cacheCreateTokens / 1_000_000) * 3.75;

  console.log(
    `[adversarial-reviewer] tokens — ` +
      `in: ${usage.inputTokens} | out: ${usage.outputTokens} | ` +
      `cache_read: ${usage.cacheReadTokens} | cache_create: ${usage.cacheCreateTokens} | ` +
      `est. cost: $${totalCost.toFixed(6)} | hash: ${artifactHash.slice(0, 12)}`
  );
}

// ── SQLite cache ──────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS adversarial_review_cache (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    artifact_hash   TEXT NOT NULL UNIQUE,
    result_json     TEXT NOT NULL,
    input_tokens    INTEGER NOT NULL DEFAULT 0,
    output_tokens   INTEGER NOT NULL DEFAULT 0,
    model           TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

function getCachedReview(hash: string): AdversarialReview | null {
  const row = db
    .prepare("SELECT result_json FROM adversarial_review_cache WHERE artifact_hash = ?")
    .get(hash) as { result_json: string } | undefined;

  if (!row) return null;

  try {
    return AdversarialReviewSchema.parse(JSON.parse(row.result_json));
  } catch {
    // Cached data is corrupt or schema has changed — treat as cache miss
    db.prepare("DELETE FROM adversarial_review_cache WHERE artifact_hash = ?").run(hash);
    return null;
  }
}

function cacheReview(
  hash: string,
  result: AdversarialReview,
  usage: TokenUsage
): void {
  db.prepare(
    `INSERT OR REPLACE INTO adversarial_review_cache
       (artifact_hash, result_json, input_tokens, output_tokens, model)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    hash,
    JSON.stringify(result),
    usage.inputTokens + usage.cacheReadTokens + usage.cacheCreateTokens,
    usage.outputTokens,
    ADVERSARIAL_MODEL
  );
}

// ── Artifact hash ─────────────────────────────────────────────────────────────

/**
 * Produces a stable SHA-256 hash of a PRD artifact.
 * Keys are sorted recursively before serialisation so insertion-order differences
 * in the same logical PRD produce the same hash (and hit the cache).
 */
function hashArtifact(artifact: PRDArtifact): string {
  const stable = JSON.stringify(artifact, Object.keys(artifact).sort());
  return createHash("sha256").update(stable).digest("hex");
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a skeptical VP of Product with 15 years of experience watching promising AI-era products fail. You have seen every PM mistake: scope creep disguised as vision, vanity metrics dressed up as success criteria, eval scores cherry-picked from a non-representative dataset, TCO figures that ignore ongoing model costs, and compliance sections copy-pasted from last quarter's PRD.

Your job is to stress-test this PRD across six gates before the team commits engineering time. You are hostile to weak thinking but constructive — your goal is to make this product succeed, not to kill it.

Audit across these six dimensions:

GATE 1 — EVIDENCE-GROUNDED PROBLEM
Is the problem grounded in real data, or assumed? Look for: circular reasoning (problem statement restates the solution), pain points stated as facts without supporting signals, user segments too generic to guide design. Ask: "What breaks if this assumption is wrong?"

GATE 2 — EVAL INTEGRITY
Are the AI eval scores credible? Is the dataset representative of production traffic, or cherry-picked for high scores? Is the groundedness threshold actually meaningful for this use case, or just easy to hit? Are eval runs fresh enough to reflect the current model and prompt? Flag eval_integrity when scores look good on paper but the methodology is weak.

GATE 3 — TCO DEFENSIBILITY
Is the three-year TCO realistic? Does it include ongoing model inference costs, retraining, prompt engineering maintenance, and human-in-the-loop overhead? Is the ROI moat actually defensible — i.e., would a well-funded competitor be unable to replicate this in 6 months? A "we have proprietary data" moat claim requires evidence of that data's uniqueness. Flag tco_defensibility for optimistic cost projections or thin moat arguments.

GATE 4 — COMPLIANCE REALITY
Are the compliance frameworks listed ones the team has actually been audited against, or aspirational? Is PII handling described with enough specificity for a security review, or is it theoretical ("we follow GDPR")? Is the explainability level appropriate for the regulatory environment this product will operate in? Flag nfr_gap for theoretical compliance claims.

GATE 5 — OPERABILITY REALISM
Is the 90-day pilot realistic given the stated scope? Is there a concrete mechanism to enforce scope limits, or just a stated intention? Is the fallback plan specific enough for an on-call engineer to execute at 2am, or is it a vague rollback promise? Flag operability_risk for pilots that will inevitably drift or fallbacks that won't work under pressure.

GATE 6 — METRIC MEASURABILITY
Can these metrics actually be measured in production with the named tooling? Can any of them be gamed (e.g., a "task completion rate" metric that counts button clicks, not outcomes)? Does each metric have a degradation threshold that would trigger a response before the feature causes real harm? Flag monitoring_gap for metrics that sound rigorous but cannot be operationalised.

You must use the submit_review tool to return your findings. Do not write prose. Every finding must include the hard question the PM must answer to resolve it. For aiEraAudit, rate each dimension based on what is actually present in the PRD — use "missing" when a section is absent entirely, not just when it is weak.`;

// ── Tool schema (passed to Claude) ───────────────────────────────────────────

const SUBMIT_REVIEW_TOOL: Anthropic.Tool = {
  name: "submit_review",
  description:
    "Submit the complete adversarial review. Call this once with all findings.",
  input_schema: {
    type: "object" as const,
    required: ["overallRisk", "findings", "redFlags", "strengthSignals", "aiEraAudit"],
    properties: {
      overallRisk: {
        type: "string",
        enum: ["low", "medium", "high", "critical"],
        description:
          "Overall risk rating for the PRD. 'critical' means do not proceed without major revision.",
      },
      findings: {
        type: "array",
        description: "All individual findings, one per concern identified.",
        items: {
          type: "object",
          required: ["section", "findingType", "description", "suggestedQuestion", "severity"],
          properties: {
            section: {
              type: "string",
              description: "Which section of the PRD this finding applies to (e.g. 'problemStatement', 'successMetrics[0]', 'targetUser').",
            },
            findingType: {
              type: "string",
              enum: [
                "assumption",
                "contradiction",
                "vanity_metric",
                "missing_evidence",
                "scope_risk",
                "eval_integrity",
                "tco_defensibility",
                "nfr_gap",
                "operability_risk",
                "monitoring_gap",
              ],
            },
            description: {
              type: "string",
              description: "Plain-language description of what the problem is and why it matters.",
            },
            suggestedQuestion: {
              type: "string",
              description: "The specific hard question the PM must answer to resolve this finding. Framed as a question.",
            },
            severity: {
              type: "integer",
              enum: [1, 2, 3],
              description: "1 = minor note, 2 = significant concern, 3 = critical blocker.",
            },
          },
        },
      },
      redFlags: {
        type: "array",
        description: "The top 3 most critical concerns you would lead with in a review meeting. Maximum 3 items.",
        maxItems: 3,
        items: { type: "string" },
      },
      strengthSignals: {
        type: "array",
        description: "Things in this PRD that are genuinely well-defined and should be preserved. Be honest — do not manufacture praise.",
        items: { type: "string" },
      },
      aiEraAudit: {
        type: "object",
        description: "AI-era audit verdicts. Use 'missing' only when the relevant section is entirely absent.",
        required: ["evalCredibility", "economicDefensibility", "operabilityRealism", "complianceReadiness"],
        properties: {
          evalCredibility: {
            type: "string",
            enum: ["credible", "questionable", "missing"],
            description: "Are the eval scores credible and the dataset representative?",
          },
          economicDefensibility: {
            type: "string",
            enum: ["strong", "weak", "missing"],
            description: "Is the TCO realistic and the ROI moat actually defensible?",
          },
          operabilityRealism: {
            type: "string",
            enum: ["realistic", "optimistic", "missing"],
            description: "Is the 90-day pilot realistic and the scope mechanism enforceable?",
          },
          complianceReadiness: {
            type: "string",
            enum: ["ready", "gaps", "missing"],
            description: "Are compliance frameworks and PII handling real, not theoretical?",
          },
        },
      },
    },
  },
};

// ── PRD → prompt serialiser ───────────────────────────────────────────────────

function serialisePRD(artifact: PRDArtifact): string {
  const lines: string[] = [
    `# PRD: ${artifact.title}  (v${artifact.artifactVersion})`,
    "",
    "## Problem Statement",
    artifact.problemStatement,
    "",
    "## Target User",
    `**Segment:** ${artifact.targetUser.segment}`,
    `**Job to be Done:** ${artifact.targetUser.jobToBeDone}`,
    "**Pain Points:**",
    ...artifact.targetUser.painPoints.map((p) => `- ${p}`),
    "",
    "## Success Metrics",
    ...artifact.successMetrics.map(
      (m, i) =>
        `${i + 1}. **${m.metric}** — baseline: ${m.baseline}, target: ${m.target}, measured by: ${m.measurementMethod}`
    ),
    "",
    "## Out of Scope",
    ...artifact.outOfScope.map((s) => `- ${s}`),
    "",
    "## Hypotheses",
    ...artifact.hypotheses.map(
      (h, i) =>
        `${i + 1}. **Assumption:** ${h.assumption}\n   **Validation:** ${h.validationMethod}\n   **Risk:** ${h.riskLevel}`
    ),
    "",
    "## Dependencies",
    artifact.dependencies.length > 0
      ? artifact.dependencies.map((d) => `- ${d}`).join("\n")
      : "_None listed_",
  ];

  return lines.join("\n");
}

// ── Recommendation logic ──────────────────────────────────────────────────────

/**
 * computeQualityScore — derives a 0–100 score from finding severities.
 *
 * Penalties: severity 1 = −3, severity 2 = −8, severity 3 = −20.
 * Score is clamped to [0, 100].
 */
function computeQualityScore(review: AdversarialReview): number {
  let score = 100;
  for (const f of review.findings) {
    if (f.severity === 1) score -= 3;
    else if (f.severity === 2) score -= 8;
    else if (f.severity === 3) score -= 20;
  }
  return Math.max(0, score);
}

/**
 * computeRecommendation — derives a recommendation and quality score from a review.
 *
 * Decision tree (evaluated in order):
 * - "reject"  if any hard gate failed, overallRisk=critical, evalCredibility=missing,
 *             or economicDefensibility=missing
 * - "revise"  if qualityScore < 65, criticalFindings ≥ 1, or overallRisk=high
 * - "approve" otherwise
 */
export function computeRecommendation(
  review: AdversarialReview,
  hardGateResults?: HardGateResult[]
): { recommendation: "approve" | "revise" | "reject"; qualityScore: number } {
  const qualityScore = computeQualityScore(review);
  const blocked = (hardGateResults ?? []).some((r) => !r.passed);
  const criticalFindings = review.findings.filter((f) => f.severity === 3).length;

  if (
    blocked ||
    review.overallRisk === "critical" ||
    review.aiEraAudit.evalCredibility === "missing" ||
    review.aiEraAudit.economicDefensibility === "missing"
  ) {
    return { recommendation: "reject", qualityScore };
  }

  if (qualityScore < 65 || criticalFindings >= 1 || review.overallRisk === "high") {
    return { recommendation: "revise", qualityScore };
  }

  return { recommendation: "approve", qualityScore };
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * reviewArtifact — run an adversarial review against a PRD artifact.
 *
 * Cache behaviour:
 * - Hit: returns the cached AdversarialReview instantly, no API call made.
 *        recommendation and qualityScore are always recomputed from the current hardGateResults.
 * - Miss: calls Claude, validates the response, stores in cache, returns result.
 *
 * @param artifact       The PRD to review.
 * @param hardGateResults Optional results from a prior hard-gate run. Failed gates are
 *                        included as context in the user message so the reviewer can look
 *                        beyond what the deterministic checks already caught.
 *
 * @throws {Error} if the API call fails or the response cannot be parsed.
 *                 Callers should handle this and surface a degraded UI state.
 */
export async function reviewArtifact(
  artifact: PRDArtifact,
  hardGateResults?: HardGateResult[]
): Promise<AdversarialReviewResult> {
  const hash = hashArtifact(artifact);

  // ── Cache hit ──
  const cached = getCachedReview(hash);
  if (cached) {
    console.log(
      `[adversarial-reviewer] cache HIT — hash: ${hash.slice(0, 12)} (${artifact.title})`
    );
    const { recommendation, qualityScore } = computeRecommendation(cached, hardGateResults);
    return { ...cached, recommendation, qualityScore };
  }

  console.log(
    `[adversarial-reviewer] cache MISS — calling ${ADVERSARIAL_MODEL} for: ${artifact.title}`
  );

  // ── Build user message — include failed gate context so the reviewer looks beyond them ──
  const failedGates = (hardGateResults ?? []).filter((r) => !r.passed);
  const gateContext =
    failedGates.length > 0
      ? `\n\n## Already-Failed Hard Gates\nThe following deterministic gate checks have already failed. Do not duplicate these findings — focus your adversarial review on issues the gates did not catch.\n${failedGates
          .map((g) => `- [${g.gateId}] ${g.gateName} (${g.phase}): ${g.reason}`)
          .join("\n")}`
      : "";

  const userMessage = `Please review the following PRD and submit your findings using the submit_review tool.${gateContext}\n\n${serialisePRD(artifact)}`;

  // ── API call ──
  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: ADVERSARIAL_MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: [SUBMIT_REVIEW_TOOL],
      // Force the model to always call submit_review — never produce prose
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: userMessage,
        },
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[adversarial-reviewer] API call failed: ${message}`);
  }

  // ── Log token usage ──
  const usage: TokenUsage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: (response.usage as unknown as Record<string, number>).cache_read_input_tokens ?? 0,
    cacheCreateTokens: (response.usage as unknown as Record<string, number>).cache_creation_input_tokens ?? 0,
  };
  logTokenUsage(hash, usage);

  // ── Extract tool call input ──
  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );

  if (!toolUse) {
    // Model returned text instead of a tool call — log it and fail clearly
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    throw new Error(
      `[adversarial-reviewer] Model did not call submit_review. Stop reason: ${response.stop_reason}.\nRaw response: ${text.slice(0, 500)}`
    );
  }

  // ── Validate output with Zod ──
  const parsed = AdversarialReviewSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(
      `[adversarial-reviewer] Tool output failed Zod validation: ${JSON.stringify(parsed.error.flatten())}`
    );
  }

  // ── Cache and return ──
  cacheReview(hash, parsed.data, usage);
  const { recommendation, qualityScore } = computeRecommendation(parsed.data, hardGateResults);
  return { ...parsed.data, recommendation, qualityScore };
}
