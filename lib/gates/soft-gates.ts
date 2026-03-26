import type { Artifact, PRD, Brief } from "@/lib/schemas/artifact.schema";

// ── Result types ──────────────────────────────────────────────────────────────

/**
 * SoftGateResult — a weighted quality signal that warns but never blocks.
 *
 * Unlike hard gates, soft gates produce feedback the author can choose to act on.
 * Each gate carries a `weight` (0–1) that represents how much it contributes to
 * the overall artifact quality score. Higher weight = more important signal.
 *
 * Design principle: soft gates should teach, not shame. Every `warning` is
 * paired with a concrete `suggestion` so the author knows exactly what to do.
 */
export interface SoftGateResult {
  passed: boolean;
  gateName: string;
  /** What the gate detected and why it matters. */
  warning: string;
  /** Concrete next step to resolve the warning. */
  suggestion: string;
  /**
   * Contribution to overall quality score (0–1).
   * Passed gates earn their full weight; failed gates earn 0.
   * Weights across all registered gates for an artifact type should sum to 1.0.
   */
  weight: number;
}

// Internal gate function signature
type SoftCheckFn = (artifact: Artifact) => SoftGateResult;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Builds a passing SoftGateResult. */
function pass(gateName: string, weight: number, warning: string, suggestion: string): SoftGateResult {
  return { passed: true, gateName, warning, suggestion, weight };
}

/** Builds a failing SoftGateResult. */
function warn(gateName: string, weight: number, warning: string, suggestion: string): SoftGateResult {
  return { passed: false, gateName, warning, suggestion, weight };
}

// ── Gate: hypothesisRiskBalance ───────────────────────────────────────────────

/**
 * Warns when every hypothesis is rated "low" risk.
 *
 * All-low-risk hypotheses are almost always a calibration failure rather than
 * a genuinely low-risk PRD. PMs tend to rate assumptions as low-risk when they
 * haven't fully thought through what it would mean to be wrong. One or more
 * medium/high-risk hypotheses is a healthy sign that the author has stress-tested
 * their own assumptions.
 *
 * Weight: 0.20 — assumption quality is central to PRD rigour.
 * Applies to: PRD
 */
function hypothesisRiskBalance(prd: PRD): SoftGateResult {
  const gateName = "hypothesisRiskBalance";
  const weight = 0.20;

  if (prd.hypotheses.length === 0) {
    // Structural absence is a hard-gate concern; skip here
    return pass(gateName, weight,
      "No hypotheses to evaluate for risk balance.",
      "Add at least one hypothesis with an honest risk rating."
    );
  }

  const allLow = prd.hypotheses.every((h) => h.riskLevel === "low");

  if (!allLow) {
    return pass(gateName, weight,
      `Risk levels are balanced — not all hypotheses are rated 'low'.`,
      "Good. Continue to re-evaluate hypothesis risk as you learn more."
    );
  }

  const count = prd.hypotheses.length;
  return warn(gateName, weight,
    `All ${count} hypothesis/hypotheses are rated 'low' risk — this is a common blind spot.`,
    "Re-examine each hypothesis: what is the worst-case impact if this assumption is wrong? Promote at least one to 'medium' or 'high' if the answer is 'significant'."
  );
}

// ── Gate: metricsMeasurability ────────────────────────────────────────────────

/**
 * Warns when a measurementMethod is too vague to act on.
 *
 * "Analytics" or "check dashboard" are not measurement methods — they don't
 * specify which tool, event name, query, or team owns the measurement. Without
 * this specificity, post-launch reviews devolve into debates about whether the
 * right thing was even measured. A good method reads like an instruction:
 * "Mixpanel → session_end event → p50 duration, filtered to dashboard page."
 *
 * Threshold: < 20 characters is almost always too vague to be actionable.
 * Weight: 0.22 — measurability is the difference between a learnable and unlearnable ship.
 * Applies to: PRD
 */
function metricsMeasurability(prd: PRD): SoftGateResult {
  const gateName = "metricsMeasurability";
  const weight = 0.22;

  const vague = prd.successMetrics.filter(
    (m) => m.measurementMethod.trim().length < 20
  );

  if (vague.length === 0) {
    return pass(gateName, weight,
      "All measurement methods are sufficiently specific.",
      "Ensure each method includes the tool name and event/query identifier."
    );
  }

  const labels = vague
    .map((m) => `"${m.metric}" (method: "${m.measurementMethod}")`)
    .join(", ");

  return warn(gateName, weight,
    `${vague.length} metric(s) have a measurement method under 20 characters: ${labels}.`,
    "Expand each method to include: the analytics tool, the specific event or query, any filters applied, and who owns the measurement. Example: 'Mixpanel → dashboard_session_end, filtered to /dashboard, p50 duration'."
  );
}

// ── Gate: userSegmentSpecificity ──────────────────────────────────────────────

/**
 * Warns when the target user segment is a generic placeholder.
 *
 * "Users" and "customers" without qualification are not segments — they describe
 * everyone who uses the product, which makes it impossible to prioritise, design,
 * or recruit research participants. A well-formed segment has at least one
 * qualifying dimension: role, company size, behaviour, lifecycle stage, or geography.
 *
 * Detection heuristic: segment is ≤ 3 words AND contains "users" or "customers"
 * as a primary noun (not as part of a longer qualified phrase like
 * "enterprise customers with >1000 seats").
 *
 * Weight: 0.18 — user clarity drives design and research decisions downstream.
 * Applies to: PRD
 */

const GENERIC_SEGMENT_WORDS = ["users", "customers", "people", "everyone", "anyone"];
const QUALIFYING_WORDS = [
  "enterprise", "smb", "b2b", "b2c", "mobile", "desktop", "admin", "manager",
  "analyst", "developer", "team", "new", "existing", "churned", "power", "casual",
  "free", "paid", "trial", "onboarding", "heavy", "light",
];

function userSegmentSpecificity(prd: PRD): SoftGateResult {
  const gateName = "userSegmentSpecificity";
  const weight = 0.18;

  const segment = prd.targetUser.segment.toLowerCase();
  const words = segment.split(/\s+/).filter(Boolean);

  const isGenericNoun = GENERIC_SEGMENT_WORDS.some((w) => words.includes(w));
  const hasQualifier = QUALIFYING_WORDS.some((q) => segment.includes(q));
  const isTooShort = words.length <= 3;

  if (!isGenericNoun || hasQualifier || !isTooShort) {
    return pass(gateName, weight,
      `Segment "${prd.targetUser.segment}" appears specific enough.`,
      "Verify the segment can be used to filter a user list in your analytics tool."
    );
  }

  return warn(gateName, weight,
    `Segment "${prd.targetUser.segment}" is too generic — it doesn't narrow the audience.`,
    "Add at least one qualifying dimension: company size (SMB, enterprise), role (finance manager, admin), lifecycle stage (new, churned), or behaviour (power user, mobile-only). Example: 'SMB finance managers at companies with <50 employees'."
  );
}

// ── Gate: dependencyRisk ──────────────────────────────────────────────────────

/**
 * Warns when the dependency count exceeds a practical coordination threshold.
 *
 * Each dependency is a potential blocking point, a cross-team coordination cost,
 * and a source of schedule risk. PRDs with > 5 dependencies are statistically
 * more likely to slip because any single dependency delay compounds the whole.
 * This gate doesn't block — some features are genuinely complex — but it prompts
 * the PM to consider whether scope can be reduced or dependencies parallelised.
 *
 * Weight: 0.12 — delivery risk signal; lower weight because complexity is sometimes unavoidable.
 * Applies to: PRD
 */
function dependencyRisk(prd: PRD): SoftGateResult {
  const gateName = "dependencyRisk";
  const weight = 0.12;
  const count = prd.dependencies.length;

  if (count <= 5) {
    return pass(gateName, weight,
      `${count} dependencies listed — within the manageable range (≤ 5).`,
      "Keep dependency count low as implementation progresses."
    );
  }

  return warn(gateName, weight,
    `${count} dependencies listed — above the 5-dependency complexity threshold.`,
    `Review the dependency list and ask: (1) Can any be decoupled with an API contract or feature flag? (2) Can any be deferred to a v2 scope? (3) Are all ${count} truly blocking, or are some just nice-to-haves?`
  );
}

// ── Gate: confidenceCalibration ───────────────────────────────────────────────

/**
 * Warns when a Brief claims high confidence without substantiating evidence.
 *
 * "High confidence" on a Brief should reflect strong qualitative or quantitative
 * signal — not optimism. The most common miscalibration: a PM who is excited
 * about an idea rates it as high confidence before any research is done.
 * This gate uses estimated impact length as a rough proxy for evidence depth:
 * a high-confidence claim with a short impact description suggests the author
 * hasn't articulated their evidence, which means it may not exist.
 *
 * Threshold: confidence=high AND estimatedImpact < 60 chars.
 * Weight: 0.28 — confidence calibration is the most important field on a Brief.
 * Applies to: Brief
 */
function confidenceCalibration(brief: Brief): SoftGateResult {
  const gateName = "confidenceCalibration";
  const weight = 0.28;

  if (brief.confidence !== "high") {
    return pass(gateName, weight,
      `Confidence is set to '${brief.confidence}' — no calibration concern.`,
      "Revisit confidence rating as discovery evidence accumulates."
    );
  }

  const impactLen = brief.estimatedImpact.trim().length;
  if (impactLen >= 60) {
    return pass(gateName, weight,
      "High confidence is supported by a substantive impact description.",
      "Consider linking to supporting research or data to make the case even stronger."
    );
  }

  return warn(gateName, weight,
    `Confidence is 'high' but estimatedImpact is only ${impactLen} characters — the evidence base is unclear.`,
    "Either reduce confidence to 'medium' (more honest for early discovery) or expand estimatedImpact to explain the evidence: user research findings, comparable market data, internal analytics, or prior experiments that support this claim."
  );
}

// ── Gate: scopeCreep ──────────────────────────────────────────────────────────

/**
 * Warns when out-of-scope items use future-feature language.
 *
 * "Phase 2", "v2", "later", "eventually" in an out-of-scope list signals
 * deferred scope, not excluded scope. This is a critical distinction:
 * - True out-of-scope: "We are not adding real-time streaming. Period."
 * - Deferred scope: "Real-time streaming is out of scope for v1."
 *
 * Deferred scope creates implicit pressure on the current build ("we have to
 * leave room for this later") and gives stakeholders false hope that excluded
 * features will eventually be added. This gate prompts the author to rewrite
 * deferred-scope items as true exclusions, or move them to a separate
 * "future considerations" section.
 *
 * Weight: 0.28 — scope discipline is the most common PRD failure mode.
 * Applies to: PRD
 */
const DEFERRED_SCOPE_PATTERNS = [
  /\bv[2-9]\b/i,
  /\bphase\s*[2-9]\b/i,
  /\bfuture\b/i,
  /\blater\b/i,
  /\beventually\b/i,
  /\bnext (release|quarter|sprint|version)\b/i,
  /\broadmap\b/i,
  /\bsomeday\b/i,
  /\bdown the road\b/i,
  /\bfor now\b/i,
  /\bphase one\b/i,   // implies phase two exists
  /\binitial (release|version|launch)\b/i,
];

function scopeCreep(prd: PRD): SoftGateResult {
  const gateName = "scopeCreep";
  const weight = 0.28;

  const deferredItems = prd.outOfScope.filter((item) =>
    DEFERRED_SCOPE_PATTERNS.some((pattern) => pattern.test(item))
  );

  if (deferredItems.length === 0) {
    return pass(gateName, weight,
      "Out-of-scope items use exclusion language, not deferral language.",
      "Periodically review out-of-scope items as the project progresses to prevent scope drift."
    );
  }

  const quoted = deferredItems.map((i) => `"${i}"`).join(", ");
  return warn(gateName, weight,
    `${deferredItems.length} out-of-scope item(s) use future/phase language: ${quoted}. These are deferred scope, not excluded scope.`,
    "Rewrite each item as an unconditional exclusion (remove phase/future references), or move them to a separate 'Future Considerations' section. Deferred scope items create implicit build pressure and stakeholder expectations that are hard to walk back."
  );
}

// ── Quality score ─────────────────────────────────────────────────────────────

/**
 * computeQualityScore — converts a set of soft gate results into a 0–100 score.
 *
 * Formula:
 *   score = (sum of weights for passed gates) / (sum of all gate weights) × 100
 *
 * If there are no gates (e.g., an artifact type with no registered soft gates),
 * returns 100 — absence of gates is not a quality deficit.
 *
 * The score deliberately does not factor in hard gate results: hard gates are
 * binary blockers, not quality contributors. A score of 100 from soft gates with
 * a failing hard gate is still a blocked artifact.
 */
export function computeQualityScore(softResults: SoftGateResult[]): number {
  if (softResults.length === 0) return 100;

  const totalWeight = softResults.reduce((sum, r) => sum + r.weight, 0);
  if (totalWeight === 0) return 100;

  const earnedWeight = softResults
    .filter((r) => r.passed)
    .reduce((sum, r) => sum + r.weight, 0);

  return Math.round((earnedWeight / totalWeight) * 100);
}

// ── SoftGateRunner ────────────────────────────────────────────────────────────

/**
 * SoftGateRunner — collects and executes soft gates per artifact type.
 *
 * Soft gates warn but never block. Their results feed into `computeQualityScore`
 * and should be surfaced to authors as actionable improvement suggestions,
 * not as errors.
 *
 * Gate weights are designed to sum to 1.0 per artifact type:
 *   PRD:   hypothesisRiskBalance(0.20) + metricsMeasurability(0.22) +
 *          userSegmentSpecificity(0.18) + dependencyRisk(0.12) + scopeCreep(0.28) = 1.00
 *   Brief: confidenceCalibration(0.28) = 0.28
 *          (remaining weight assumed passed for un-gated fields → score still 0–100)
 *   OKR:   no soft gates currently → always scores 100
 */
export class SoftGateRunner {
  private readonly gateMap: Record<string, SoftCheckFn[]> = {
    prd: [
      (a) => hypothesisRiskBalance(a as PRD),
      (a) => metricsMeasurability(a as PRD),
      (a) => userSegmentSpecificity(a as PRD),
      (a) => dependencyRisk(a as PRD),
      (a) => scopeCreep(a as PRD),
    ],
    okr: [],
    brief: [
      (a) => confidenceCalibration(a as Brief),
    ],
  };

  run(artifact: Artifact): SoftGateResult[] {
    const gates = this.gateMap[artifact.artifactType] ?? [];
    return gates.map((gate) => gate(artifact));
  }

  /** Quality score for this artifact's soft gate results (0–100). */
  qualityScore(artifact: Artifact): number {
    return computeQualityScore(this.run(artifact));
  }
}

// ── Standalone export ─────────────────────────────────────────────────────────

const defaultRunner = new SoftGateRunner();

/**
 * runSoftGates — run all soft gates for an artifact and return results.
 *
 * Results are warnings, not errors. Use `computeQualityScore(results)` to
 * roll them up into a single 0–100 quality score.
 *
 * @example
 * ```ts
 * const softResults = runSoftGates(artifact);
 * const score = computeQualityScore(softResults);
 * const warnings = softResults.filter(r => !r.passed);
 * ```
 */
export function runSoftGates(artifact: Artifact): SoftGateResult[] {
  return defaultRunner.run(artifact);
}
