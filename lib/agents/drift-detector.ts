/**
 * Strategic Drift Detector — a two-step Claude pipeline that:
 *
 * Step 1 — Signal extraction: asks Claude to distill each artifact into four
 *   semantic signals (user problem, business outcome, assumptions, strategic bets).
 *   Signals are cached by content hash so extraction never runs twice on the
 *   same artifact.
 *
 * Step 2 — Drift comparison: asks Claude to compare the signal sets and
 *   identify where the new artifact has drifted from its baseline (OKRs or
 *   previous PRDs). Uses tool_use for guaranteed structured output.
 *   Comparison results are cached by a hash pair (new ⊕ baseline).
 *
 * Two entry points:
 *   detectDrift(newArtifact, baselineOKRs)         — PRD/Brief vs OKRs
 *   detectHistoricalDrift(newArtifact, prevPRDs)   — PRD vs previous PRDs
 */
import { createHash } from "crypto";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./client";
import { db } from "@/lib/db/client";
import type { PRD as PRDArtifact } from "@/lib/schemas/prd.schema";
import type { OKR } from "@/lib/schemas/okr.schema";
import type { Brief } from "@/lib/schemas/brief.schema";

// ── Model ─────────────────────────────────────────────────────────────────────

const DRIFT_MODEL = "claude-sonnet-4-20250514";

// ── Output schemas ────────────────────────────────────────────────────────────

/**
 * StrategicSignals — the semantic distillation of any artifact.
 * Four dimensions chosen because they cover the main ways two artifacts can
 * appear to agree on the surface but diverge in intent underneath.
 */
const StrategicSignalsSchema = z.object({
  /** The specific user pain or unmet need at the center of this artifact. */
  coreUserProblem: z.string(),
  /** The measurable business result the artifact is designed to produce. */
  primaryBusinessOutcome: z.string(),
  /**
   * Beliefs about users or the market that must be true for this to succeed.
   * Extracted as discrete statements to enable assumption-level comparison.
   */
  keyAssumptions: z.union([z.array(z.string()), z.string()]).transform((v) =>
    typeof v === "string" ? v.split(/\n|;\s*/).map((s) => s.trim()).filter(Boolean) : v
  ),
  /**
   * Directional bets: "we believe that X approach will outperform Y approach."
   * Distinct from assumptions (beliefs about the world) vs. bets (choices about strategy).
   */
  strategicBets: z.union([z.array(z.string()), z.string()]).transform((v) =>
    typeof v === "string" ? v.split(/\n|;\s*/).map((s) => s.trim()).filter(Boolean) : v
  ),
});

export type StrategicSignals = z.infer<typeof StrategicSignalsSchema>;

const DriftSeveritySchema = z.enum(["low", "medium", "high"]);

const DriftSignalSchema = z.object({
  /** The semantic dimension where drift was detected (e.g. "target user", "success metric"). */
  dimension: z.string(),
  /** What the baseline artifact says about this dimension. */
  baselineSignal: z.string(),
  /** What the new artifact says about this dimension. */
  newSignal: z.string(),
  driftSeverity: DriftSeveritySchema,
});

const DriftTypeSchema = z.enum([
  "objective_drift",  // the business objective has shifted
  "user_drift",       // the target user or their problem has changed
  "metric_drift",     // how success is measured has changed
  "scope_drift",      // what is in / out of scope has shifted
]);

export const DriftResultSchema = z.object({
  /** 0 = perfectly aligned, 100 = completely misaligned. */
  driftScore: z.number().min(0).max(100),
  /** Which categories of drift were identified. */
  driftType: z.array(DriftTypeSchema),
  /** Per-dimension comparison of baseline vs. new signals. */
  driftSignals: z.array(DriftSignalSchema),
  verdict: z.enum(["aligned", "minor_drift", "significant_drift", "misaligned"]),
  /** Concrete next step for the author to resolve or acknowledge the drift. */
  recommendation: z.string(),
});

export type DriftResult = z.infer<typeof DriftResultSchema>;
export type DriftSignal = z.infer<typeof DriftSignalSchema>;
export type DriftType = z.infer<typeof DriftTypeSchema>;

// Inputs accepted by the two public functions
export type NewArtifact = PRDArtifact | Brief;

// ── DB cache tables (lazy init) ───────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS drift_signal_cache (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    content_hash  TEXT NOT NULL UNIQUE,
    artifact_label TEXT NOT NULL,
    signals_json  TEXT NOT NULL,
    model         TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS drift_comparison_cache (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    pair_hash     TEXT NOT NULL UNIQUE,
    result_json   TEXT NOT NULL,
    model         TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Hashing helpers ───────────────────────────────────────────────────────────

function sha256(value: unknown): string {
  const stable = JSON.stringify(value, Object.keys(value as object).sort());
  return createHash("sha256").update(stable).digest("hex");
}

function pairHash(a: string, b: string): string {
  // Order-independent: sort so detectDrift(A,B) and detectDrift(B,A) hit the same cache
  return createHash("sha256")
    .update([a, b].sort().join(":"))
    .digest("hex");
}

// ── Artifact serializers ──────────────────────────────────────────────────────

/**
 * Produce a compact human-readable summary of each artifact type.
 * These strings are what Claude actually reads, so clarity > brevity.
 */

function serialisePRD(prd: PRDArtifact): string {
  return [
    `TYPE: PRD`,
    `TITLE: ${prd.title}  (v${prd.artifactVersion})`,
    ``,
    `PROBLEM: ${prd.problemStatement}`,
    ``,
    `TARGET USER`,
    `  Segment: ${prd.targetUser.segment}`,
    `  Job-to-be-done: ${prd.targetUser.jobToBeDone}`,
    `  Pain points: ${prd.targetUser.painPoints.join(" | ")}`,
    ``,
    `BUSINESS OUTCOMES`,
    ...prd.successMetrics.map(
      (m) => `  • ${m.metric}: ${m.baseline} → ${m.target} (via ${m.measurementMethod})`
    ),
    ``,
    `KEY ASSUMPTIONS`,
    ...prd.hypotheses.map(
      (h) => `  • [${h.riskLevel} risk] ${h.assumption}`
    ),
    ``,
    `OUT OF SCOPE: ${prd.outOfScope.join(", ")}`,
  ].join("\n");
}

function serialiseOKR(okr: OKR): string {
  return [
    `TYPE: OKR`,
    `OWNER: ${okr.owner}`,
    `PERIOD: ${okr.timeframe.quarter} ${okr.timeframe.year}`,
    ``,
    `OBJECTIVE: ${okr.objective}`,
    ``,
    `KEY RESULTS`,
    ...okr.keyResults.map(
      (kr) =>
        `  • ${kr.kr}\n    metric: ${kr.metric}  ${kr.currentValue} → ${kr.targetValue}  due: ${kr.dueDate}`
    ),
  ].join("\n");
}

function serialiseBrief(brief: Brief): string {
  return [
    `TYPE: Brief`,
    ``,
    `OPPORTUNITY: ${brief.opportunity}`,
    `PROPOSED SOLUTION: ${brief.proposedSolution}`,
    `ESTIMATED IMPACT: ${brief.estimatedImpact}`,
    `CONFIDENCE: ${brief.confidence}`,
    brief.linkedOKRs.length > 0 ? `LINKED OKRs: ${brief.linkedOKRs.join(", ")}` : `LINKED OKRs: none`,
  ].join("\n");
}

function serialiseArtifact(artifact: NewArtifact | OKR | PRDArtifact): string {
  if (artifact.artifactType === "prd") return serialisePRD(artifact as PRDArtifact);
  if (artifact.artifactType === "okr") return serialiseOKR(artifact as OKR);
  if (artifact.artifactType === "brief") return serialiseBrief(artifact as Brief);
  return JSON.stringify(artifact, null, 2);
}

function artifactLabel(artifact: NewArtifact | OKR | PRDArtifact): string {
  if (artifact.artifactType === "prd") return `PRD: ${(artifact as PRDArtifact).title}`;
  if (artifact.artifactType === "okr") return `OKR: ${(artifact as OKR).objective.slice(0, 60)}`;
  if (artifact.artifactType === "brief") return `Brief: ${(artifact as Brief).opportunity.slice(0, 60)}`;
  return "Artifact";
}

// ── Step 1: Signal extraction ─────────────────────────────────────────────────

const SIGNAL_EXTRACTION_SYSTEM = `You are a senior product strategist. Your job is to extract the core strategic signals from a product artifact — what problem is really being solved, what business outcome is being chased, what assumptions the author is making, and what strategic bets are implicit in the work.

Be precise and concise. Do not paraphrase the artifact back — distil it. Each signal should be a single, specific statement that could be compared against a similar statement from another artifact to detect strategic misalignment.

Use the extract_signals tool to submit your findings.`;

const EXTRACT_SIGNALS_TOOL: Anthropic.Tool = {
  name: "extract_signals",
  description: "Submit the extracted strategic signals from the artifact.",
  input_schema: {
    type: "object" as const,
    required: ["coreUserProblem", "primaryBusinessOutcome", "keyAssumptions", "strategicBets"],
    properties: {
      coreUserProblem: {
        type: "string",
        description: "The specific user pain or unmet need at the center of this artifact. One sentence.",
      },
      primaryBusinessOutcome: {
        type: "string",
        description: "The measurable business result this artifact is designed to produce. One sentence.",
      },
      keyAssumptions: {
        type: "array",
        items: { type: "string" },
        description: "Beliefs about users or the market that must be true for this to succeed. 2–5 items.",
      },
      strategicBets: {
        type: "array",
        items: { type: "string" },
        description: "Directional choices: 'we believe X approach will outperform Y'. 1–4 items.",
      },
    },
  },
};

async function extractSignals(
  artifact: NewArtifact | OKR | PRDArtifact
): Promise<StrategicSignals> {
  const hash = sha256(artifact);
  const label = artifactLabel(artifact);

  // Cache check
  const cached = db
    .prepare("SELECT signals_json FROM drift_signal_cache WHERE content_hash = ?")
    .get(hash) as { signals_json: string } | undefined;

  if (cached) {
    console.log(`[drift-detector] signal cache HIT — ${label} (${hash.slice(0, 10)})`);
    try {
      return StrategicSignalsSchema.parse(JSON.parse(cached.signals_json));
    } catch {
      db.prepare("DELETE FROM drift_signal_cache WHERE content_hash = ?").run(hash);
    }
  }

  console.log(`[drift-detector] extracting signals — ${label}`);

  const response = await anthropic.messages.create({
    model: DRIFT_MODEL,
    max_tokens: 1024,
    system: SIGNAL_EXTRACTION_SYSTEM,
    tools: [EXTRACT_SIGNALS_TOOL],
    tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content: `Extract the strategic signals from this artifact:\n\n${serialiseArtifact(artifact)}`,
      },
    ],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  if (!toolUse) {
    throw new Error(`[drift-detector] signal extraction: model did not call extract_signals for "${label}"`);
  }

  const parsed = StrategicSignalsSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(`[drift-detector] signal schema mismatch: ${JSON.stringify(parsed.error.flatten())}`);
  }

  // Persist to cache
  db.prepare(
    `INSERT OR REPLACE INTO drift_signal_cache (content_hash, artifact_label, signals_json, model)
     VALUES (?, ?, ?, ?)`
  ).run(hash, label, JSON.stringify(parsed.data), DRIFT_MODEL);

  return parsed.data;
}

// ── Step 2: Drift comparison ──────────────────────────────────────────────────

const DRIFT_COMPARISON_SYSTEM = `You are analyzing whether two product artifacts are strategically aligned. Compare their strategic signals and identify drift in intent, focus area, or success definition.

Strategic drift is NOT about wording differences — it is about substantive changes in:
  - WHO the product is for (user drift)
  - WHAT outcome the product is optimizing for (objective drift / metric drift)
  - WHAT is included or excluded (scope drift)
  - WHAT assumptions are being made (any category)

Calibration:
  driftScore 0–15   → aligned (cosmetic differences only)
  driftScore 16–40  → minor_drift (one area of concern, team should discuss)
  driftScore 41–65  → significant_drift (multiple dimensions diverging, needs PM alignment session)
  driftScore 66–100 → misaligned (fundamentally different products; recommend stopping and realigning)

Use the submit_drift_analysis tool to submit your findings.`;

const SUBMIT_DRIFT_TOOL: Anthropic.Tool = {
  name: "submit_drift_analysis",
  description: "Submit the complete strategic drift analysis between the two artifacts.",
  input_schema: {
    type: "object" as const,
    required: ["driftScore", "driftType", "driftSignals", "verdict", "recommendation"],
    properties: {
      driftScore: {
        type: "number",
        description: "0 = perfectly aligned, 100 = completely misaligned.",
        minimum: 0,
        maximum: 100,
      },
      driftType: {
        type: "array",
        items: {
          type: "string",
          enum: ["objective_drift", "user_drift", "metric_drift", "scope_drift"],
        },
        description: "Which categories of drift were detected. Empty array if aligned.",
      },
      driftSignals: {
        type: "array",
        description: "Per-dimension comparison. Only include dimensions where meaningful drift exists.",
        items: {
          type: "object",
          required: ["dimension", "baselineSignal", "newSignal", "driftSeverity"],
          properties: {
            dimension: { type: "string", description: "The semantic dimension (e.g. 'target user segment', 'primary success metric')." },
            baselineSignal: { type: "string", description: "What the baseline artifact says." },
            newSignal: { type: "string", description: "What the new artifact says." },
            driftSeverity: { type: "string", enum: ["low", "medium", "high"] },
          },
        },
      },
      verdict: {
        type: "string",
        enum: ["aligned", "minor_drift", "significant_drift", "misaligned"],
      },
      recommendation: {
        type: "string",
        description: "One concrete next step for the author to resolve or acknowledge the drift.",
      },
    },
  },
};

async function compareDrift(
  newSignals: StrategicSignals,
  baselineSignals: StrategicSignals,
  newLabel: string,
  baselineLabel: string,
  context?: string
): Promise<DriftResult> {
  const newHash = sha256(newSignals);
  const baseHash = sha256(baselineSignals);
  const pair = pairHash(newHash, baseHash);

  // Cache check
  const cached = db
    .prepare("SELECT result_json FROM drift_comparison_cache WHERE pair_hash = ?")
    .get(pair) as { result_json: string } | undefined;

  if (cached) {
    console.log(`[drift-detector] comparison cache HIT — ${newLabel} vs ${baselineLabel}`);
    try {
      return DriftResultSchema.parse(JSON.parse(cached.result_json));
    } catch {
      db.prepare("DELETE FROM drift_comparison_cache WHERE pair_hash = ?").run(pair);
    }
  }

  console.log(`[drift-detector] comparing drift — "${newLabel}" vs "${baselineLabel}"`);

  const comparisonMessage = [
    `## Baseline artifact: ${baselineLabel}`,
    ``,
    `Core user problem: ${baselineSignals.coreUserProblem}`,
    `Primary business outcome: ${baselineSignals.primaryBusinessOutcome}`,
    `Key assumptions:`,
    ...baselineSignals.keyAssumptions.map((a) => `  - ${a}`),
    `Strategic bets:`,
    ...baselineSignals.strategicBets.map((b) => `  - ${b}`),
    ``,
    `---`,
    ``,
    `## New artifact: ${newLabel}`,
    ``,
    `Core user problem: ${newSignals.coreUserProblem}`,
    `Primary business outcome: ${newSignals.primaryBusinessOutcome}`,
    `Key assumptions:`,
    ...newSignals.keyAssumptions.map((a) => `  - ${a}`),
    `Strategic bets:`,
    ...newSignals.strategicBets.map((b) => `  - ${b}`),
    context ? `\n---\n\n## Additional context\n${context}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await anthropic.messages.create({
    model: DRIFT_MODEL,
    max_tokens: 1500,
    system: DRIFT_COMPARISON_SYSTEM,
    tools: [SUBMIT_DRIFT_TOOL],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: comparisonMessage }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  if (!toolUse) {
    throw new Error(`[drift-detector] comparison: model did not call submit_drift_analysis`);
  }

  const parsed = DriftResultSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(
      `[drift-detector] drift schema mismatch: ${JSON.stringify(parsed.error.flatten())}`
    );
  }

  // Persist
  db.prepare(
    `INSERT OR REPLACE INTO drift_comparison_cache (pair_hash, result_json, model)
     VALUES (?, ?, ?)`
  ).run(pair, JSON.stringify(parsed.data), DRIFT_MODEL);

  return parsed.data;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * detectDrift — compare a PRD or Brief against the current OKR set.
 *
 * Use this to answer: "Does this new PRD actually serve our current OKRs,
 * or has the team quietly started optimising for something else?"
 *
 * When multiple OKRs are provided, their signals are extracted individually
 * then merged into a single baseline before comparison.
 */
export async function detectDrift(
  newArtifact: NewArtifact,
  baselineOKRs: OKR[]
): Promise<DriftResult> {
  if (baselineOKRs.length === 0) {
    throw new Error("[drift-detector] detectDrift requires at least one baseline OKR");
  }

  // Extract signals from new artifact and all OKRs in parallel
  const [newSignals, ...okrSignalSets] = await Promise.all([
    extractSignals(newArtifact),
    ...baselineOKRs.map((okr) => extractSignals(okr)),
  ]);

  // Merge OKR signals into a single composite baseline.
  // Problems and outcomes are concatenated so the comparison sees all OKRs.
  // Assumptions and bets are deduplicated by content.
  const baselineSignals: StrategicSignals =
    okrSignalSets.length === 1
      ? okrSignalSets[0]
      : {
          coreUserProblem: okrSignalSets.map((s) => s.coreUserProblem).join("; "),
          primaryBusinessOutcome: okrSignalSets.map((s) => s.primaryBusinessOutcome).join("; "),
          keyAssumptions: [...new Set(okrSignalSets.flatMap((s) => s.keyAssumptions))],
          strategicBets: [...new Set(okrSignalSets.flatMap((s) => s.strategicBets))],
        };

  const baselineLabel =
    baselineOKRs.length === 1
      ? artifactLabel(baselineOKRs[0])
      : `${baselineOKRs.length} OKRs (${baselineOKRs[0].timeframe.quarter} ${baselineOKRs[0].timeframe.year})`;

  return compareDrift(newSignals, baselineSignals, artifactLabel(newArtifact), baselineLabel);
}

/**
 * detectHistoricalDrift — compare a new PRD against previous PRDs for the same area.
 *
 * Use this to answer: "Has this PRD quietly redefined the problem we thought we were
 * solving, or added scope that contradicts decisions made in earlier versions?"
 *
 * The most recent previous artifact is used as the primary baseline.
 * All historical artifacts are included as context so Claude can identify
 * whether drift is sudden (just since the last version) or gradual (accumulating
 * across multiple iterations).
 */
export async function detectHistoricalDrift(
  newArtifact: PRDArtifact,
  previousArtifacts: PRDArtifact[]
): Promise<DriftResult> {
  if (previousArtifacts.length === 0) {
    throw new Error("[drift-detector] detectHistoricalDrift requires at least one previous artifact");
  }

  // Most recent previous artifact is the primary baseline
  const primaryBaseline = previousArtifacts[0];
  const olderHistory = previousArtifacts.slice(1);

  // Extract signals from new artifact and primary baseline in parallel;
  // extract older history signals in parallel too (they'll be cached after first run)
  const [newSignals, baselineSignals, ...historicalSignalSets] = await Promise.all([
    extractSignals(newArtifact),
    extractSignals(primaryBaseline),
    ...olderHistory.map((a) => extractSignals(a)),
  ]);

  // Build optional context note about the full history for the comparison prompt
  let historyContext: string | undefined;
  if (historicalSignalSets.length > 0) {
    const lines = [
      `This PRD has ${previousArtifacts.length} prior version(s). Historical user problems for context:`,
    ];
    olderHistory.forEach((_a, i) => {
      lines.push(
        `  v${previousArtifacts.length - 1 - i}: "${historicalSignalSets[i].coreUserProblem}" ` +
          `(outcome: "${historicalSignalSets[i].primaryBusinessOutcome}")`
      );
    });
    historyContext = lines.join("\n");
  }

  return compareDrift(
    newSignals,
    baselineSignals,
    artifactLabel(newArtifact),
    `Previous: ${artifactLabel(primaryBaseline)}`,
    historyContext
  );
}
