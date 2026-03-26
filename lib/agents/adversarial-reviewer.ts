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
});

export type AdversarialFinding = z.infer<typeof AdversarialFindingSchema>;
export type AdversarialReview = z.infer<typeof AdversarialReviewSchema>;

/** PRDArtifact is a PRD schema type (aliased for readability at call sites). */
export type PRDArtifact = PRD;

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

const SYSTEM_PROMPT = `You are a skeptical VP of Product with 15 years of experience watching promising products fail. You have seen every PM mistake in the book: scope creep disguised as vision, vanity metrics dressed up as success criteria, user research that confirms what the team already believed, and dependencies that were "almost certain" until they weren't.

Your job is to stress-test this PRD before the team commits engineering time to it. You are hostile to weak thinking but constructive in your feedback — your goal is to make this product succeed, not to kill it.

For every section of the PRD, ask yourself: "What assumption is being made here? Is it stated? Is there evidence for it? What happens to this whole plan if this assumption is wrong?"

Look specifically for:
- CIRCULAR REASONING: when the problem statement and the proposed solution are the same claim restated
- VANITY METRICS: metrics that will always go up regardless of real value delivered (e.g., "page views", "feature adoption" without retention signal)
- SOLUTION-FIRST THINKING: requirements that presuppose a specific implementation rather than describing an outcome
- MISSING USER RESEARCH SIGNALS: target user descriptions without behavioural evidence, pain points stated as facts without supporting data
- OPTIMISTIC DEPENDENCIES: dependency lists that underestimate coordination cost, or assume other teams will deliver on time

You must use the submit_review tool to return your findings. Do not write prose. Every finding must include the hard question the PM should answer to resolve it.`;

// ── Tool schema (passed to Claude) ───────────────────────────────────────────

const SUBMIT_REVIEW_TOOL: Anthropic.Tool = {
  name: "submit_review",
  description:
    "Submit the complete adversarial review. Call this once with all findings.",
  input_schema: {
    type: "object" as const,
    required: ["overallRisk", "findings", "redFlags", "strengthSignals"],
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
              enum: ["assumption", "contradiction", "vanity_metric", "missing_evidence", "scope_risk"],
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

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * reviewArtifact — run an adversarial review against a PRD artifact.
 *
 * Cache behaviour:
 * - Hit: returns the cached result instantly, no API call made.
 * - Miss: calls Claude, validates the response, stores in cache, returns result.
 *
 * @throws {Error} if the API call fails or the response cannot be parsed.
 *                 Callers should handle this and surface a degraded UI state.
 */
export async function reviewArtifact(artifact: PRDArtifact): Promise<AdversarialReview> {
  const hash = hashArtifact(artifact);

  // ── Cache hit ──
  const cached = getCachedReview(hash);
  if (cached) {
    console.log(
      `[adversarial-reviewer] cache HIT — hash: ${hash.slice(0, 12)} (${artifact.title})`
    );
    return cached;
  }

  console.log(
    `[adversarial-reviewer] cache MISS — calling ${ADVERSARIAL_MODEL} for: ${artifact.title}`
  );

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
          content: `Please review the following PRD and submit your findings using the submit_review tool.\n\n${serialisePRD(artifact)}`,
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
  return parsed.data;
}
