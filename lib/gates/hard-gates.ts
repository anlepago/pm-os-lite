import type { Artifact, PRD, Brief } from "@/lib/schemas/artifact.schema";

// ── Result types ──────────────────────────────────────────────────────────────

export interface GateCheckResult {
  passed: boolean;
  gateName: string;
  reason: string;
}

/**
 * HardGateResult — a gate check result that always carries blocksSubmission: true.
 *
 * Hard gates are binary and blocking: if a gate fails, the artifact must not be
 * stored or submitted until the author fixes the issue. There is no "warn and
 * continue" path for hard gates (use soft errors in the validator for that).
 */
export interface HardGateResult extends GateCheckResult {
  readonly blocksSubmission: true;
}

// Internal shorthand
type CheckFn = (artifact: Artifact) => GateCheckResult;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wraps a raw check result into a HardGateResult (adds blocksSubmission). */
function toHardResult(check: GateCheckResult): HardGateResult {
  return { ...check, blocksSubmission: true };
}

/**
 * Returns true if the string contains at least one digit sequence.
 * Used to distinguish "increase to 4 min" (has target) from "increase satisfaction" (vague).
 */
function containsNumericTarget(text: string): boolean {
  return /\d/.test(text);
}

// ── Gate: hasProblemStatement ─────────────────────────────────────────────────

/**
 * Ensures the problem statement is substantive enough to communicate shared
 * understanding of the problem. A single sentence (< 100 chars) almost always
 * fails to include evidence, affected scope, or frequency — all of which
 * engineering and design need to make good build decisions.
 *
 * Applies to: PRD
 */
function hasProblemStatement(prd: PRD): GateCheckResult {
  const gateName = "hasProblemStatement";
  const len = prd.problemStatement.trim().length;

  if (len >= 100) {
    return {
      passed: true,
      gateName,
      reason: `Problem statement is ${len} characters — meets the 100-char minimum.`,
    };
  }

  return {
    passed: false,
    gateName,
    reason: `Problem statement is only ${len} characters (minimum 100). Add evidence, affected user count, or frequency data.`,
  };
}

// ── Gate: hasSuccessMetrics ───────────────────────────────────────────────────

/**
 * Requires at least 2 success metrics, each with a non-empty target.
 *
 * Single-metric PRDs are a failure mode — teams optimise for the one number
 * they're measured on (e.g. NPS) while ignoring countervailing signals
 * (e.g. support volume, retention). Two metrics is the practical minimum
 * for catching unintended side effects.
 *
 * Applies to: PRD
 */
function hasSuccessMetrics(prd: PRD): GateCheckResult {
  const gateName = "hasSuccessMetrics";
  const metrics = prd.successMetrics;

  const withTargets = metrics.filter((m) => m.target.trim().length > 0);

  if (withTargets.length >= 2) {
    return {
      passed: true,
      gateName,
      reason: `${withTargets.length} success metric(s) found, each with a defined target.`,
    };
  }

  if (metrics.length < 2) {
    return {
      passed: false,
      gateName,
      reason: `Only ${metrics.length} success metric(s) defined. A minimum of 2 is required to prevent single-metric optimisation.`,
    };
  }

  return {
    passed: false,
    gateName,
    reason: `${metrics.length} metric(s) listed but only ${withTargets.length} have a non-empty target. All metrics must include a specific target value.`,
  };
}

// ── Gate: hasOutOfScope ───────────────────────────────────────────────────────

/**
 * Requires at least 2 explicit out-of-scope items.
 *
 * Scope creep almost always enters through items that were never discussed
 * rather than items that were agreed upon. An explicit out-of-scope list
 * forces the PM to have the "no, we're not doing X" conversation before
 * build starts, not during it.
 *
 * Applies to: PRD
 */
function hasOutOfScope(prd: PRD): GateCheckResult {
  const gateName = "hasOutOfScope";
  const items = prd.outOfScope.filter((s) => s.trim().length > 0);

  if (items.length >= 2) {
    return {
      passed: true,
      gateName,
      reason: `${items.length} out-of-scope item(s) listed.`,
    };
  }

  return {
    passed: false,
    gateName,
    reason: `Only ${items.length} out-of-scope item(s) listed (minimum 2). Name at least 2 things this PRD explicitly does not cover.`,
  };
}

// ── Gate: hasValidationMethod ─────────────────────────────────────────────────

/**
 * Every hypothesis must carry a validation method.
 *
 * A hypothesis without a validation method is an unacknowledged bet — it
 * will never be tested because there's no trigger or owner. Requiring a
 * validation method for each assumption creates a discovery backlog alongside
 * the build backlog, making risk visible and reducible.
 *
 * Applies to: PRD
 */
function hasValidationMethod(prd: PRD): GateCheckResult {
  const gateName = "hasValidationMethod";

  const missing = prd.hypotheses
    .map((h, i) => ({ index: i, assumption: h.assumption, method: h.validationMethod }))
    .filter((h) => h.method.trim().length === 0);

  if (missing.length === 0) {
    return {
      passed: true,
      gateName,
      reason: `All ${prd.hypotheses.length} hypothesis/hypotheses have a validation method.`,
    };
  }

  const labels = missing
    .map((h) => `hypothesis[${h.index}] ("${h.assumption.slice(0, 40)}…")`)
    .join(", ");

  return {
    passed: false,
    gateName,
    reason: `${missing.length} hypothesis/hypotheses missing a validation method: ${labels}. Every assumption must have an explicit test.`,
  };
}

// ── Gate: hasLinkedOKRs ───────────────────────────────────────────────────────

/**
 * A Brief must be linked to at least one OKR.
 *
 * Briefs exist to justify discovery investment. A Brief with no OKR link
 * cannot be prioritised against other work because there's no stated connection
 * to what the company is trying to achieve this quarter. This gate prevents
 * "orphan" discovery work that sounds good in isolation.
 *
 * Applies to: Brief
 */
function hasLinkedOKRs(brief: Brief): GateCheckResult {
  const gateName = "hasLinkedOKRs";
  const linked = brief.linkedOKRs.filter((id) => id.trim().length > 0);

  if (linked.length >= 1) {
    return {
      passed: true,
      gateName,
      reason: `Brief is linked to ${linked.length} OKR(s): ${linked.join(", ")}.`,
    };
  }

  return {
    passed: false,
    gateName,
    reason: "Brief has no linked OKRs. Connect this to at least one strategic OKR before submission to justify prioritisation.",
  };
}

// ── Gate: noVagueMetrics ──────────────────────────────────────────────────────

/**
 * Blocks success metrics that use improvement-language without a numeric anchor.
 *
 * "Improve user satisfaction" or "increase engagement" are not measurable.
 * This gate permits these words only when the metric or target field also
 * contains a numeric value ("increase session time to 4 min" passes;
 * "increase session time" fails). The goal is to force quantification at
 * write-time, not during post-launch retros.
 *
 * Applies to: PRD
 */
const VAGUE_WORDS = ["improve", "increase", "better", "good", "enhance"] as const;
const VAGUE_PATTERN = new RegExp(VAGUE_WORDS.join("|"), "i");

function noVagueMetrics(prd: PRD): GateCheckResult {
  const gateName = "noVagueMetrics";

  const offenders: string[] = [];

  for (const m of prd.successMetrics) {
    const metricIsVague = VAGUE_PATTERN.test(m.metric) && !containsNumericTarget(m.metric);
    const targetIsVague = VAGUE_PATTERN.test(m.target) && !containsNumericTarget(m.target);

    if (metricIsVague) {
      offenders.push(`metric name "${m.metric}" uses improvement language without a number`);
    }
    if (targetIsVague) {
      offenders.push(`target "${m.target}" for metric "${m.metric}" uses improvement language without a number`);
    }
  }

  if (offenders.length === 0) {
    return {
      passed: true,
      gateName,
      reason: "All success metrics use quantified targets — no vague improvement language detected.",
    };
  }

  return {
    passed: false,
    gateName,
    reason: `${offenders.length} vague metric(s) found: ${offenders.join("; ")}. Replace improvement language with a numeric target (e.g. "increase to 4 min" not "increase time").`,
  };
}

// ── HardGateRunner ────────────────────────────────────────────────────────────

/**
 * HardGateRunner — collects and executes all hard gates against an artifact.
 *
 * Gates are registered per artifact type. Calling `run(artifact)` executes
 * only the gates applicable to that artifact's type, so OKR artifacts are
 * never tested against PRD-specific gates.
 *
 * Usage:
 * ```ts
 * const runner = new HardGateRunner();
 * const results = runner.run(myArtifact);
 * const blocked = results.some(r => !r.passed);
 * ```
 */
export class HardGateRunner {
  /**
   * Maps each artifact type to its registered gate functions.
   * Typed as a Record so new artifact types can be added by extending both
   * the discriminated union in artifact.schema.ts and this map.
   */
  private readonly gateMap: Record<string, CheckFn[]> = {
    prd: [
      (a) => hasProblemStatement(a as PRD),
      (a) => hasSuccessMetrics(a as PRD),
      (a) => hasOutOfScope(a as PRD),
      (a) => hasValidationMethod(a as PRD),
      (a) => noVagueMetrics(a as PRD),
    ],
    okr: [
      // OKRs are structurally validated by Zod; no additional hard gates yet.
      // Add okr-specific gates here as policy evolves.
    ],
    brief: [
      (a) => hasLinkedOKRs(a as Brief),
    ],
  };

  /**
   * Runs all hard gates applicable to the artifact's type.
   * Returns one HardGateResult per gate — callers should check `passed` on each.
   */
  run(artifact: Artifact): HardGateResult[] {
    const gates = this.gateMap[artifact.artifactType] ?? [];
    return gates.map((gate) => toHardResult(gate(artifact)));
  }

  /**
   * Convenience: returns true only if every applicable gate passes.
   * Use this to guard storage/submission calls.
   */
  allPassed(artifact: Artifact): boolean {
    return this.run(artifact).every((r) => r.passed);
  }
}

// ── Standalone export ─────────────────────────────────────────────────────────

/**
 * Module-level singleton runner — avoids instantiation boilerplate for callers
 * that don't need a custom runner instance.
 */
const defaultRunner = new HardGateRunner();

/**
 * runHardGates — run all hard gates against an artifact and return results.
 *
 * If any result has `passed: false`, the artifact must be blocked from storage.
 * All results carry `blocksSubmission: true` to make the intent explicit at
 * the call site.
 *
 * @example
 * ```ts
 * const results = runHardGates(artifact);
 * if (results.some(r => !r.passed)) {
 *   // block submission, surface results to the user
 * }
 * ```
 */
export function runHardGates(artifact: Artifact): HardGateResult[] {
  return defaultRunner.run(artifact);
}
