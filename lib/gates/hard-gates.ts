import type { Artifact, PRD, Brief } from "@/lib/schemas/artifact.schema";

// ── Result type ────────────────────────────────────────────────────────────────

/**
 * HardGateResult — a single gate check result.
 *
 * Hard gates are binary and always blocking: a failed gate must prevent the
 * artifact from being stored or submitted until the author resolves the issue.
 * There is no "warn and continue" path — that is the job of soft gates.
 */
export interface HardGateResult {
  /** Unique identifier for this specific check (e.g. "G1-evidence-count"). */
  gateId: string;
  /** Human-readable name of the gate this check belongs to. */
  gateName: string;
  /** Which gate phase this check is part of (e.g. "Gate 1: Evidence-Grounded Problem"). */
  phase: string;
  /** Whether this check passed. */
  passed: boolean;
  /** Complete sentence explaining the outcome — failure messages must state what is wrong AND why it matters. */
  reason: string;
  /** Hard gates always block submission. */
  readonly blocksSubmission: true;
  /** Link to documentation or policy reference for this gate. */
  documentationRef: string;
}

// ── Shared constants ──────────────────────────────────────────────────────────

const VAGUE_WORDS = ["improve", "increase", "better", "good", "enhance", "optimize", "boost"] as const;
const VAGUE_PATTERN = new RegExp(VAGUE_WORDS.join("|"), "i");
const GENERIC_SEGMENTS = new Set(["users", "customers", "people", "everyone"]);

// ── Internal helpers ──────────────────────────────────────────────────────────

function pass(gateId: string, gateName: string, phase: string, reason: string, documentationRef: string): HardGateResult {
  return { gateId, gateName, phase, passed: true, reason, blocksSubmission: true, documentationRef };
}

function fail(gateId: string, gateName: string, phase: string, reason: string, documentationRef: string): HardGateResult {
  return { gateId, gateName, phase, passed: false, reason, blocksSubmission: true, documentationRef };
}

// ── Gate 1: Evidence-Grounded Problem ─────────────────────────────────────────

/**
 * Gate 1 — Evidence-Grounded Problem.
 *
 * Ensures the problem being solved is substantiated by real user/market
 * signals, not internal assumptions. Without evidence, teams build solutions
 * to problems that either don't exist at the stated scale or have already
 * been solved by existing tooling.
 *
 * Applies to: PRD
 */
export function gate1_EvidenceGroundedProblem(prd: PRD): HardGateResult[] {
  const GATE = "Gate 1: Evidence-Grounded Problem";
  const DOC = "https://pm-os.internal/gates/g1-evidence";
  const results: HardGateResult[] = [];

  // G1-problem-length
  const len = prd.problemStatement.trim().length;
  results.push(
    len >= 100
      ? pass("G1-problem-length", "Problem Statement Length", GATE,
          `Problem statement is ${len} characters — meets the 100-character minimum required to include evidence and scope.`,
          DOC)
      : fail("G1-problem-length", "Problem Statement Length", GATE,
          `Problem statement is only ${len} characters (minimum 100). A single sentence is not enough — include the affected user population, observed frequency, and at least one piece of supporting evidence so engineers and designers understand the full problem context before building.`,
          DOC)
  );

  // G1-evidence-count
  const signals = prd.evidenceSignals ?? [];
  results.push(
    signals.length >= 2
      ? pass("G1-evidence-count", "Evidence Signal Count", GATE,
          `${signals.length} evidence signal(s) provided — meets the minimum of 2.`,
          DOC)
      : fail("G1-evidence-count", "Evidence Signal Count", GATE,
          `Only ${signals.length} evidence signal(s) provided (minimum 2). A feature justified by a single data point is at high risk of confirmation bias — provide at least 2 independent signals from different source types (e.g. usage data + user research) to demonstrate the problem is real and recurring.`,
          DOC)
  );

  // G1-evidence-quantified
  const hasQuantified = signals.some((s) => s.quantifiedImpact && s.quantifiedImpact.trim().length > 0);
  results.push(
    hasQuantified
      ? pass("G1-evidence-quantified", "Quantified Evidence Signal", GATE,
          "At least one evidence signal includes a quantifiedImpact — the problem scale is measurable.",
          DOC)
      : fail("G1-evidence-quantified", "Quantified Evidence Signal", GATE,
          "None of the evidence signals include a quantifiedImpact. Without a number (e.g. '42% of users', '1,200 support tickets/month'), there is no way to prioritise this feature against others or measure whether the solution actually reduced the problem at the expected scale.",
          DOC)
  );

  // G1-user-segment
  const segment = (prd.targetUser?.segment ?? "").trim().toLowerCase();
  const isGeneric = GENERIC_SEGMENTS.has(segment);
  results.push(
    !isGeneric
      ? pass("G1-user-segment", "Target User Segment Specificity", GATE,
          `Target user segment "${prd.targetUser?.segment}" is specific enough to guide design and engineering decisions.`,
          DOC)
      : fail("G1-user-segment", "Target User Segment Specificity", GATE,
          `Target user segment "${prd.targetUser?.segment}" is too generic to be useful. Labels like "users", "customers", "people", and "everyone" tell engineers nothing about whose workflow is being optimised — replace it with a specific cohort (e.g. "SMB finance managers at companies with <50 employees who manually reconcile invoices").`,
          DOC)
  );

  return results;
}

// ── Gate 2: Synthetic Evals ────────────────────────────────────────────────────

/**
 * Gate 2 — Synthetic Evals (AI Quality Gate).
 *
 * Requires a formal evaluation run before any AI-powered feature reaches
 * production. Groundedness and hallucination rates must meet minimum thresholds,
 * and the eval data must be recent enough to reflect the current model and prompt
 * configuration.
 *
 * Applies to: PRD
 */
export function gate2_SyntheticEvals(prd: PRD): HardGateResult[] {
  const GATE = "Gate 2: Synthetic Evals";
  const DOC = "https://pm-os.internal/gates/g2-evals";
  const results: HardGateResult[] = [];

  const evalData = prd.syntheticEval;

  // G2-eval-missing
  if (!evalData) {
    results.push(fail("G2-eval-missing", "Synthetic Eval Present", GATE,
      "The syntheticEval section is missing entirely. AI features must include a completed evaluation run before submission — without measured groundedness and hallucination rates, there is no evidence this feature meets the minimum quality bar for production.",
      DOC));
    return results; // no point checking sub-fields if the section is absent
  }

  results.push(pass("G2-eval-missing", "Synthetic Eval Present", GATE,
    "syntheticEval section is present.", DOC));

  // G2-groundedness
  results.push(
    evalData.groundednessScore >= 90
      ? pass("G2-groundedness", "Groundedness Score", GATE,
          `Groundedness score is ${evalData.groundednessScore}% — meets the ≥90% threshold.`,
          DOC)
      : fail("G2-groundedness", "Groundedness Score", GATE,
          `Groundedness score is ${evalData.groundednessScore}% (minimum 90%). A groundedness score below 90% means more than 1-in-10 AI outputs cannot be attributed to source context, which creates unacceptable accuracy risk in a PM workflow tool where decisions are made based on AI output. Improve prompt grounding or retrieval quality before re-running the eval.`,
          DOC)
  );

  // G2-hallucination
  results.push(
    evalData.hallucinationRate <= 5
      ? pass("G2-hallucination", "Hallucination Rate", GATE,
          `Hallucination rate is ${evalData.hallucinationRate}% — within the ≤5% threshold.`,
          DOC)
      : fail("G2-hallucination", "Hallucination Rate", GATE,
          `Hallucination rate is ${evalData.hallucinationRate}% (maximum 5%). A hallucination rate above 5% means fabricated content will appear in PM artifacts at a frequency that erodes trust and causes downstream planning errors. Reduce hallucinations via prompt constraints, temperature tuning, or retrieval augmentation before re-submitting.`,
          DOC)
  );

  // G2-confirmation
  results.push(
    evalData.passedEvalGate === true
      ? pass("G2-confirmation", "Eval Gate Confirmation", GATE,
          "passedEvalGate is explicitly set to true — the eval operator has confirmed this run meets the quality bar.",
          DOC)
      : fail("G2-confirmation", "Eval Gate Confirmation", GATE,
          "passedEvalGate must be explicitly set to true. This field requires a deliberate confirmation from the person who ran the eval — it cannot be inferred from scores alone, as the eval operator may have flagged edge cases that invalidate an otherwise passing run.",
          DOC)
  );

  // G2-eval-freshness (warn if stale — still blocks)
  const evalDate = new Date(evalData.evalRunDate);
  const daysSince = Math.floor((Date.now() - evalDate.getTime()) / (1000 * 60 * 60 * 24));
  results.push(
    daysSince <= 90
      ? pass("G2-eval-freshness", "Eval Freshness", GATE,
          `Eval was run ${daysSince} day(s) ago (${evalData.evalRunDate}) — within the 90-day freshness window.`,
          DOC)
      : fail("G2-eval-freshness", "Eval Freshness", GATE,
          `Eval was run ${daysSince} days ago (${evalData.evalRunDate}), which exceeds the 90-day freshness limit. Model behaviour changes with prompt updates, fine-tuning, and base model upgrades — an eval older than 90 days may no longer reflect the current system's quality. Re-run the eval against the latest model and prompt configuration.`,
          DOC)
  );

  return results;
}

// ── Gate 3: ROI Moat ──────────────────────────────────────────────────────────

/**
 * Gate 3 — ROI Moat (TCO Analysis).
 *
 * Forces an explicit build-vs-buy decision backed by financial figures and
 * a documented strategic moat. Without this gate, teams default to building
 * everything in-house — even when a vendor solution would cost less and deliver
 * faster, or when the build delivers no defensible advantage over off-the-shelf tools.
 *
 * Applies to: PRD
 */
export function gate3_ROIMoat(prd: PRD): HardGateResult[] {
  const GATE = "Gate 3: ROI Moat";
  const DOC = "https://pm-os.internal/gates/g3-tco";
  const results: HardGateResult[] = [];

  const tco = prd.tcoAnalysis;

  // G3-tco-missing
  if (!tco) {
    results.push(fail("G3-tco-missing", "TCO Analysis Present", GATE,
      "The tcoAnalysis section is missing entirely. Every PRD must include a build-vs-buy analysis with a three-year cost projection — without this, the investment decision cannot be financially evaluated against alternatives.",
      DOC));
    return results;
  }

  results.push(pass("G3-tco-missing", "TCO Analysis Present", GATE,
    "tcoAnalysis section is present.", DOC));

  // G3-tco-3year
  results.push(
    tco.threeYearTCO.trim().length > 0
      ? pass("G3-tco-3year", "Three-Year TCO", GATE,
          "Three-year TCO estimate is provided.",
          DOC)
      : fail("G3-tco-3year", "Three-Year TCO", GATE,
          "threeYearTCO is empty. A three-year cost projection is required to surface the long-term maintenance and operational burden of this feature, which is routinely underestimated in point-in-time build cost estimates.",
          DOC)
  );

  // G3-roi-moat
  results.push(
    tco.roiMoat.trim().length >= 50
      ? pass("G3-roi-moat", "ROI Moat Justification", GATE,
          `ROI moat is ${tco.roiMoat.trim().length} characters — meets the 50-character minimum.`,
          DOC)
      : fail("G3-roi-moat", "ROI Moat Justification", GATE,
          `roiMoat is ${tco.roiMoat.trim().length} characters (minimum 50). A moat description that short cannot credibly explain why building this capability in-house creates defensible value that a vendor cannot replicate — expand it to explain the specific strategic advantage.`,
          DOC)
  );

  // G3-bvb-justification
  results.push(
    tco.buildVsBuyJustification.trim().length >= 50
      ? pass("G3-bvb-justification", "Build vs Buy Justification", GATE,
          `Build-vs-buy justification is ${tco.buildVsBuyJustification.trim().length} characters — meets the 50-character minimum.`,
          DOC)
      : fail("G3-bvb-justification", "Build vs Buy Justification", GATE,
          `buildVsBuyJustification is ${tco.buildVsBuyJustification.trim().length} characters (minimum 50). The justification must explain why the chosen path (${tco.buildVsBuyDecision}) was selected over the alternatives — without this, future PMs and finance reviewers cannot audit the original decision rationale.`,
          DOC)
  );

  // G3-breakeven
  results.push(
    tco.breakEvenTimeline.trim().length > 0
      ? pass("G3-breakeven", "Break-Even Timeline", GATE,
          "Break-even timeline is provided.",
          DOC)
      : fail("G3-breakeven", "Break-Even Timeline", GATE,
          "breakEvenTimeline is empty. Without a break-even timeline, finance and leadership cannot determine whether the ROI will be realised within the planning horizon — this is the primary lever used to approve or defer investment decisions.",
          DOC)
  );

  return results;
}

// ── Gate 4: NFR Zero Tolerance ────────────────────────────────────────────────

/**
 * Gate 4 — NFR Zero Tolerance (Compliance, Privacy, Explainability).
 *
 * Compliance and privacy decisions made after build starts are 10x more
 * expensive to fix than decisions made at PRD stage. This gate ensures
 * data residency, PII handling, and explainability are explicitly decided
 * before a single line of code is written.
 *
 * Applies to: PRD
 */
export function gate4_NFRZeroTolerance(prd: PRD): HardGateResult[] {
  const GATE = "Gate 4: NFR Zero Tolerance";
  const DOC = "https://pm-os.internal/gates/g4-nfr";
  const results: HardGateResult[] = [];

  const nfr = prd.nonFunctionalRequirements;

  // G4-nfr-missing
  if (!nfr) {
    results.push(fail("G4-nfr-missing", "NFR Section Present", GATE,
      "The nonFunctionalRequirements section is missing entirely. Compliance, data residency, PII handling, and explainability requirements must be declared in the PRD — discovering these constraints after engineering begins typically causes scope-breaking rework or launch delays.",
      DOC));
    return results;
  }

  results.push(pass("G4-nfr-missing", "NFR Section Present", GATE,
    "nonFunctionalRequirements section is present.", DOC));

  // G4-data-residency
  results.push(
    nfr.dataResidency.trim().length >= 20
      ? pass("G4-data-residency", "Data Residency", GATE,
          "Data residency requirements are documented.",
          DOC)
      : fail("G4-data-residency", "Data Residency", GATE,
          `dataResidency is ${nfr.dataResidency.trim().length} characters (minimum 20). A brief statement is not sufficient — specify which regions data may be stored in, which cloud providers are permitted, and any cross-border transfer restrictions that apply to this feature.`,
          DOC)
  );

  // G4-compliance
  results.push(
    (nfr.complianceFrameworks ?? []).length >= 1
      ? pass("G4-compliance", "Compliance Frameworks", GATE,
          `${nfr.complianceFrameworks.length} compliance framework(s) declared: ${nfr.complianceFrameworks.join(", ")}.`,
          DOC)
      : fail("G4-compliance", "Compliance Frameworks", GATE,
          "complianceFrameworks is empty. Every feature that processes user data must explicitly list the regulatory frameworks it must comply with (e.g. GDPR, SOC 2, HIPAA). An empty list will block security review and legal sign-off.",
          DOC)
  );

  // G4-pii
  results.push(
    nfr.piiHandling.trim().length >= 30
      ? pass("G4-pii", "PII Handling", GATE,
          "PII handling procedure is documented.",
          DOC)
      : fail("G4-pii", "PII Handling", GATE,
          `piiHandling is ${nfr.piiHandling.trim().length} characters (minimum 30). Describe how PII is collected, stored, accessed, retained, and deleted — vague statements like "we follow GDPR" are insufficient for a security review and provide no guidance to engineers implementing the data layer.`,
          DOC)
  );

  // G4-explainability
  results.push(
    nfr.explainabilityRequirement
      ? pass("G4-explainability", "Explainability Requirement", GATE,
          `Explainability level declared as "${nfr.explainabilityRequirement}".`,
          DOC)
      : fail("G4-explainability", "Explainability Requirement", GATE,
          "explainabilityRequirement is not declared. AI features must explicitly choose a transparency level (none | audit_log | decision_rationale | full_trace) — this decision affects audit infrastructure, legal defensibility, and the user interface, and cannot be retrofitted after launch without significant rework.",
          DOC)
  );

  // G4-risk-owner
  results.push(
    nfr.riskOwnerSignoff.trim().length >= 3
      ? pass("G4-risk-owner", "Risk Owner Sign-off", GATE,
          `Risk owner is identified as "${nfr.riskOwnerSignoff}".`,
          DOC)
      : fail("G4-risk-owner", "Risk Owner Sign-off", GATE,
          "riskOwnerSignoff is too short or empty. A named risk owner (minimum 3 characters) must be identified before launch — without an accountable person, compliance gaps discovered in production have no escalation path and tend to be deprioritised indefinitely.",
          DOC)
  );

  return results;
}

// ── Gate 5: Operability Constraints ──────────────────────────────────────────

/**
 * Gate 5 — Operability Constraints (Scope & Timeline Governance).
 *
 * Prevents timeline drift and scope creep by requiring explicit deadlines,
 * pilot caps, and fallback plans before the feature enters production.
 * An AI feature without a fallback plan is an incident waiting to happen.
 *
 * Applies to: PRD
 */
export function gate5_OperabilityConstraints(prd: PRD): HardGateResult[] {
  const GATE = "Gate 5: Operability Constraints";
  const DOC = "https://pm-os.internal/gates/g5-ops";
  const results: HardGateResult[] = [];

  const ops = prd.operabilityConstraints;

  // G5-ops-missing
  if (!ops) {
    results.push(fail("G5-ops-missing", "Operability Constraints Present", GATE,
      "The operabilityConstraints section is missing entirely. Production deadlines, pilot duration caps, scope enforcement mechanisms, and fallback plans must be committed to at PRD stage — teams that defer these decisions consistently ship later than planned and with no rollback path.",
      DOC));
    return results;
  }

  results.push(pass("G5-ops-missing", "Operability Constraints Present", GATE,
    "operabilityConstraints section is present.", DOC));

  // G5-deadline
  const deadline = new Date(ops.productionDeadline);
  const isFuture = deadline > new Date();
  results.push(
    isFuture
      ? pass("G5-deadline", "Production Deadline", GATE,
          `Production deadline is set to ${ops.productionDeadline} — a future date.`,
          DOC)
      : fail("G5-deadline", "Production Deadline", GATE,
          `productionDeadline "${ops.productionDeadline}" is in the past. Update the deadline to a future date that reflects the current plan — a stale deadline provides false confidence to stakeholders tracking the roadmap.`,
          DOC)
  );

  // G5-pilot-length
  results.push(
    ops.pilotDurationDays <= 90
      ? pass("G5-pilot-length", "Pilot Duration", GATE,
          `Pilot duration is ${ops.pilotDurationDays} days — within the 90-day cap.`,
          DOC)
      : fail("G5-pilot-length", "Pilot Duration", GATE,
          `pilotDurationDays is ${ops.pilotDurationDays} (maximum 90). Pilots exceeding 90 days routinely become permanent — the feature never graduates to GA and the codebase accumulates unresolvable conditional logic. If a longer pilot is genuinely required, escalate for explicit approval rather than encoding it here.`,
          DOC)
  );

  // G5-scope-enforcement
  results.push(
    ops.scopeEnforcementMechanism.trim().length >= 30
      ? pass("G5-scope-enforcement", "Scope Enforcement Mechanism", GATE,
          "Scope enforcement mechanism is documented.",
          DOC)
      : fail("G5-scope-enforcement", "Scope Enforcement Mechanism", GATE,
          `scopeEnforcementMechanism is ${ops.scopeEnforcementMechanism.trim().length} characters (minimum 30). Describe the concrete mechanism — feature flags, a written scope sign-off, a stakeholder review gate — that will prevent scope from expanding mid-pilot. "We'll discuss it if it comes up" is not a mechanism.`,
          DOC)
  );

  // G5-fallback
  results.push(
    ops.fallbackPlan.trim().length >= 30
      ? pass("G5-fallback", "Fallback Plan", GATE,
          "Fallback plan is documented.",
          DOC)
      : fail("G5-fallback", "Fallback Plan", GATE,
          `fallbackPlan is ${ops.fallbackPlan.trim().length} characters (minimum 30). Describe exactly how this feature will be disabled or rolled back if a production incident occurs — without a documented fallback, on-call engineers will improvise under pressure, which extends incident duration and increases blast radius.`,
          DOC)
  );

  return results;
}

// ── Gate 6: Quantified Success ────────────────────────────────────────────────

/**
 * Gate 6 — Quantified Success (Metrics with Degradation Monitoring).
 *
 * Success metrics that cannot be monitored in production are not success metrics —
 * they are wishful thinking. This gate requires at least 2 numeric metrics,
 * each with a monitoring tool, a degradation threshold, and a response plan
 * so the team knows immediately when the feature stops delivering value.
 *
 * Applies to: PRD
 */
export function gate6_QuantifiedSuccess(prd: PRD): HardGateResult[] {
  const GATE = "Gate 6: Quantified Success";
  const DOC = "https://pm-os.internal/gates/g6-metrics";
  const results: HardGateResult[] = [];

  const metrics = prd.successMetrics ?? [];

  // G6-metric-count
  results.push(
    metrics.length >= 2
      ? pass("G6-metric-count", "Success Metric Count", GATE,
          `${metrics.length} success metric(s) defined — meets the minimum of 2.`,
          DOC)
      : fail("G6-metric-count", "Success Metric Count", GATE,
          `Only ${metrics.length} success metric(s) defined (minimum 2). Single-metric PRDs cause teams to optimise for the one number they're tracked on while ignoring countervailing effects — provide at least 2 metrics from different categories (e.g. engagement + quality, or adoption + support volume).`,
          DOC)
  );

  // G6-numeric-targets
  const vagueTargets = metrics.filter(
    (m) => !(/\d/.test(m.target)) || VAGUE_PATTERN.test(m.target)
  );
  results.push(
    vagueTargets.length === 0
      ? pass("G6-numeric-targets", "Numeric Metric Targets", GATE,
          "All metric targets contain a specific number and no vague improvement language.",
          DOC)
      : fail("G6-numeric-targets", "Numeric Metric Targets", GATE,
          `${vagueTargets.length} metric target(s) are vague or non-numeric: ${vagueTargets.map((m) => `"${m.metric}" → "${m.target}"`).join("; ")}. Targets must contain a specific number and must not use words like improve, increase, better, good, enhance, optimize, or boost — replace with a concrete value (e.g. "≥ 4.2/5 CSAT" not "improve satisfaction").`,
          DOC)
  );

  // G6-degradation-plan
  const missingPlan = metrics.filter(
    (m) => !m.degradationResponsePlan || m.degradationResponsePlan.trim().length < 20
  );
  results.push(
    missingPlan.length === 0
      ? pass("G6-degradation-plan", "Degradation Response Plans", GATE,
          "All metrics have a degradation response plan of sufficient length.",
          DOC)
      : fail("G6-degradation-plan", "Degradation Response Plans", GATE,
          `${missingPlan.length} metric(s) are missing a sufficient degradationResponsePlan (minimum 20 characters): ${missingPlan.map((m) => `"${m.metric}"`).join(", ")}. Without a documented response plan, on-call teams will not know what to do when a metric degrades — describe the escalation path and remediation steps for each metric.`,
          DOC)
  );

  // G6-monitoring-tool
  const missingTool = metrics.filter(
    (m) => !m.monitoringTool || m.monitoringTool.trim().length < 3
  );
  results.push(
    missingTool.length === 0
      ? pass("G6-monitoring-tool", "Monitoring Tools", GATE,
          "All metrics have a named monitoring tool.",
          DOC)
      : fail("G6-monitoring-tool", "Monitoring Tools", GATE,
          `${missingTool.length} metric(s) are missing a monitoringTool (minimum 3 characters): ${missingTool.map((m) => `"${m.metric}"`).join(", ")}. A metric without a named monitoring tool will not be tracked in production — name the specific tool (e.g. "Datadog", "Mixpanel", "Grafana") so instrumentation ownership is unambiguous from day one.`,
          DOC)
  );

  return results;
}

// ── Orchestration ─────────────────────────────────────────────────────────────

/**
 * runHardGates — executes all applicable hard gates against an artifact.
 *
 * Only PRD artifacts run all 6 AI-era gates. Brief artifacts run the OKR
 * linkage gate. OKR artifacts have no additional hard gates beyond Zod validation.
 *
 * If any result has `passed: false`, the artifact must be blocked from storage.
 *
 * @example
 * ```ts
 * const results = runHardGates(artifact);
 * if (isBlocked(results)) {
 *   // surface results to the user before allowing submission
 * }
 * ```
 */
export function runHardGates(artifact: Artifact): HardGateResult[] {
  if (artifact.artifactType === "prd") {
    const prd = artifact as PRD;
    return [
      ...gate1_EvidenceGroundedProblem(prd),
      ...gate2_SyntheticEvals(prd),
      ...gate3_ROIMoat(prd),
      ...gate4_NFRZeroTolerance(prd),
      ...gate5_OperabilityConstraints(prd),
      ...gate6_QuantifiedSuccess(prd),
    ];
  }

  if (artifact.artifactType === "brief") {
    const brief = artifact as Brief;
    const linked = brief.linkedOKRs.filter((id) => id.trim().length > 0);
    return [
      linked.length >= 1
        ? pass("B1-linked-okrs", "Linked OKRs", "Gate B1: OKR Linkage",
            `Brief is linked to ${linked.length} OKR(s): ${linked.join(", ")}.`,
            "https://pm-os.internal/gates/b1-okrs")
        : fail("B1-linked-okrs", "Linked OKRs", "Gate B1: OKR Linkage",
            "Brief has no linked OKRs. A brief with no OKR connection cannot be prioritised against other discovery work — link it to at least one strategic OKR to justify the investment.",
            "https://pm-os.internal/gates/b1-okrs"),
    ];
  }

  // OKR artifacts: structural validation is handled entirely by Zod
  return [];
}

/**
 * isBlocked — returns true if any gate failed (i.e. submission should be prevented).
 */
export function isBlocked(results: HardGateResult[]): boolean {
  return results.some((r) => !r.passed);
}

/**
 * gatesSummary — aggregates gate results into a summary object.
 *
 * `byGate` groups results by phase so callers can surface per-gate status
 * in a UI without re-processing the flat results array.
 */
export function gatesSummary(results: HardGateResult[]): {
  total: number;
  passed: number;
  failed: number;
  blocked: boolean;
  byGate: Record<string, { passed: number; failed: number; checks: HardGateResult[] }>;
} {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

  const byGate: Record<string, { passed: number; failed: number; checks: HardGateResult[] }> = {};
  for (const result of results) {
    if (!byGate[result.phase]) {
      byGate[result.phase] = { passed: 0, failed: 0, checks: [] };
    }
    byGate[result.phase].checks.push(result);
    if (result.passed) {
      byGate[result.phase].passed++;
    } else {
      byGate[result.phase].failed++;
    }
  }

  return { total, passed, failed, blocked: failed > 0, byGate };
}

// ── Legacy compatibility ───────────────────────────────────────────────────────

/**
 * @deprecated Use runHardGates() + isBlocked() instead.
 * Retained to avoid breaking existing callers that instantiate HardGateRunner directly.
 */
export class HardGateRunner {
  run(artifact: Artifact): HardGateResult[] {
    return runHardGates(artifact);
  }
  allPassed(artifact: Artifact): boolean {
    return !isBlocked(this.run(artifact));
  }
}
