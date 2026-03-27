import { z } from "zod";

/**
 * Semver regex — enforces versioned artifacts so reviewers always know
 * which iteration of a PRD they're reading and can track scope changes over time.
 */
const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "Must be a valid semver string (e.g. 1.0.0)");

/**
 * Risk level shared across hypotheses — forces PMs to explicitly rate
 * how dangerous each unvalidated assumption is before committing to build.
 */
export const RiskLevelSchema = z.enum(["low", "medium", "high"]);

/**
 * Target User — the most important section of any PRD.
 * Decomposing the user into segment + pain points + JTBD prevents
 * vague "our users want X" statements and forces evidence-based specificity.
 */
export const TargetUserSchema = z.object({
  /** Demographic or behavioral cohort (e.g. "SMB finance managers, <50 employees"). */
  segment: z
    .string()
    .min(1)
    .refine(
      (s) => s.split(" ").length >= 4,
      "Segment must be specific — include cohort size, role, or behavioral qualifier (e.g. 'SMB finance managers with <50 employees')"
    ),

  /**
   * Concrete frustrations or unmet needs this feature addresses.
   * Array form encourages listing multiple pains, not just the loudest one.
   */
  painPoints: z.array(z.string().min(1)).min(1, "At least one pain point required"),

  /**
   * The underlying goal the user is trying to accomplish (Jobs-to-be-Done lens).
   * Separating JTBD from pain points prevents conflating symptoms with root causes.
   */
  jobToBeDone: z.string().min(10),
});

/**
 * Gate 6 — Success Metric with degradation monitoring.
 * Each metric now requires monitoring tooling and a degradation response plan
 * to ensure AI-powered features are observable in production and actionable
 * when they regress.
 */
export const SuccessMetricSchema = z.object({
  /** Human-readable metric name (e.g. "Dashboard session time"). */
  metric: z.string().min(1),

  /** Current measured value before the feature ships. */
  baseline: z.string().min(1),

  /**
   * The specific value that constitutes success.
   * Must contain a number and must not use vague improvement language.
   */
  target: z
    .string()
    .min(1)
    .refine((t) => /\d/.test(t), "Target must contain a specific number (e.g. '95%', '< 200ms', '4.2/5')")
    .refine(
      (t) =>
        !/(improve|increase|better|good|enhance|optimize|boost)/i.test(t),
      "Target must not use vague words like improve, increase, better, good, enhance, optimize, or boost — use a specific measured value instead"
    ),

  /**
   * How and where this will be measured (tool + event name).
   * Without this, post-launch debates about measurement methodology kill accountability.
   */
  measurementMethod: z.string().min(1),

  /** The tool used to monitor this metric in production (e.g. "Datadog", "Grafana", "Mixpanel"). */
  monitoringTool: z
    .string()
    .min(3, "monitoringTool must be at least 3 characters — name the actual tool"),

  /** The threshold at which the metric is considered degraded (e.g. "below 90% for 5 min"). */
  degradationThreshold: z
    .string()
    .min(10, "degradationThreshold must be at least 10 characters — include value and duration"),

  /** What the on-call team does when the degradation threshold is crossed. */
  degradationResponsePlan: z
    .string()
    .min(20, "degradationResponsePlan must be at least 20 characters — describe the response action"),
});

/**
 * Hypothesis — makes implicit assumptions explicit and testable.
 * Every PRD contains assumptions; this schema forces them to be written down
 * along with how they'll be validated, so the team can de-risk before building.
 */
export const HypothesisSchema = z.object({
  /** The assumption being made (e.g. "Users will adopt preset saves within 2 weeks"). */
  assumption: z.string().min(10),

  /**
   * How this assumption will be tested or invalidated.
   * Without a validation method, hypotheses are just beliefs — not learnings.
   */
  validationMethod: z.string().min(10),

  /**
   * How damaging it would be to ship and discover this assumption was wrong.
   * High-risk assumptions should be validated before full build commitment.
   */
  riskLevel: RiskLevelSchema,
});

/**
 * Gate 1 — Evidence Signals.
 * Requires at least 2 user/market signals grounding the feature in real demand.
 * At least one signal must be quantified to prevent purely anecdotal justification.
 */
export const EvidenceSignalSchema = z.object({
  /** Type of evidence collected. */
  signalType: z.enum([
    "user_research",
    "support_tickets",
    "usage_data",
    "competitive",
    "customer_quote",
  ]),

  /** What the signal shows and why it's relevant to the problem statement. */
  description: z.string().min(10),

  /** Where this data came from (e.g. "UserTesting session Jan 2026", "Zendesk tag report"). */
  source: z.string().min(5),

  /** Optional: a number that quantifies the signal (e.g. "42% of users", "1,200 tickets/month"). */
  quantifiedImpact: z.string().optional(),
});

/**
 * Gate 2 — Synthetic Evaluation (AI quality gate).
 * Requires a formal eval run before shipping AI-powered features.
 * Groundedness ≥ 90%, hallucination rate ≤ 5%, and passedEvalGate must be explicitly true.
 */
export const SyntheticEvalSchema = z.object({
  /** Percentage of outputs grounded in source context. Must be ≥ 90. */
  groundednessScore: z
    .number()
    .refine((n) => n >= 90, "groundednessScore must be ≥ 90 to pass the eval gate"),

  /** Percentage of outputs containing hallucinated content. Must be ≤ 5. */
  hallucinationRate: z
    .number()
    .refine((n) => n <= 5, "hallucinationRate must be ≤ 5% to pass the eval gate"),

  /** Description of the dataset used in the eval (size, source, diversity). */
  evalDatasetDescription: z.string().min(10),

  /** The tool or framework used to run the eval (e.g. "PromptFoo", "Braintrust", "custom"). */
  evalToolUsed: z.string().min(3),

  /** ISO date string of when the eval was run (YYYY-MM-DD). */
  evalRunDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "evalRunDate must be in YYYY-MM-DD format"),

  /** Must be explicitly set to true — prevents accidental gate bypass. */
  passedEvalGate: z.literal(true),
});

/**
 * Gate 3 — Total Cost of Ownership (TCO) Analysis.
 * Forces an explicit build-vs-buy decision with financial justification
 * and a documented moat to prevent re-litigating the same decision later.
 */
export const TCOAnalysisSchema = z.object({
  /** Estimated total cost to build this capability internally. */
  buildCostEstimate: z.string().min(1),

  /** Estimated total cost to buy or license an equivalent capability. */
  buyCostEstimate: z.string().min(1),

  /** Projected total cost of ownership over three years (whichever path is chosen). */
  threeYearTCO: z.string().min(1),

  /** Why the chosen path creates defensible value that alternatives cannot match. */
  roiMoat: z
    .string()
    .min(50, "roiMoat must be at least 50 characters — explain the strategic advantage"),

  /** When the investment is expected to pay back relative to the alternative. */
  breakEvenTimeline: z.string().min(1),

  /** The outcome of the build-vs-buy decision. */
  buildVsBuyDecision: z.enum(["build", "buy", "hybrid"]),

  /** Detailed rationale for the chosen decision. */
  buildVsBuyJustification: z
    .string()
    .min(50, "buildVsBuyJustification must be at least 50 characters — explain the reasoning"),
});

/**
 * Gate 4 — Non-Functional Requirements (compliance, privacy, explainability).
 * Ensures AI features have explicit data governance, compliance, and
 * explainability decisions made before engineering begins.
 */
export const NonFunctionalRequirementsSchema = z.object({
  /** Where user data will be stored and processed (country/region/cloud constraints). */
  dataResidency: z
    .string()
    .min(20, "dataResidency must be at least 20 characters — specify region and storage constraints"),

  /** Regulatory or standards frameworks this feature must comply with (e.g. GDPR, SOC 2). */
  complianceFrameworks: z
    .array(z.string().min(1))
    .min(1, "At least one compliance framework must be listed"),

  /** How personally identifiable information is handled, stored, and protected. */
  piiHandling: z
    .string()
    .min(30, "piiHandling must be at least 30 characters — describe data handling procedures"),

  /** The level of decision transparency required for this AI feature. */
  explainabilityRequirement: z.enum([
    "none",
    "audit_log",
    "decision_rationale",
    "full_trace",
  ]),

  /** Why the chosen explainability level is appropriate for this context. */
  explainabilityJustification: z
    .string()
    .min(20, "explainabilityJustification must be at least 20 characters"),

  /** Whether this feature requires a formal security review before launch. */
  securityReviewRequired: z.boolean(),

  /** Name or role of the person accountable for risk sign-off. */
  riskOwnerSignoff: z
    .string()
    .min(3, "riskOwnerSignoff must be at least 3 characters — name the risk owner"),
});

/**
 * Gate 5 — Operability Constraints (scope and timeline governance).
 * Prevents timeline drift and scope creep by requiring explicit deadlines,
 * pilot caps, and fallback plans before the feature enters production.
 */
export const OperabilityConstraintsSchema = z.object({
  /** The target production launch date in YYYY-MM-DD format. Must be in the future. */
  productionDeadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "productionDeadline must be in YYYY-MM-DD format")
    .refine(
      (d) => new Date(d) > new Date(),
      "productionDeadline must be a future date"
    ),

  /** How many days the pilot phase will run. Capped at 90 to prevent indefinite pilots. */
  pilotDurationDays: z
    .number()
    .max(90, "pilotDurationDays must be 90 or fewer — if you need longer, escalate for approval"),

  /** How scope will be enforced (e.g. feature flags, kill switches, stakeholder review gates). */
  scopeEnforcementMechanism: z
    .string()
    .min(30, "scopeEnforcementMechanism must be at least 30 characters — describe the mechanism"),

  /** How the team will respond if scope creep is detected during the pilot. */
  scopeCreepResponsePlan: z
    .string()
    .min(30, "scopeCreepResponsePlan must be at least 30 characters — describe the response plan"),

  /** Name or role of the person accountable for operability during rollout. */
  operabilityOwner: z
    .string()
    .min(3, "operabilityOwner must be at least 3 characters — name the owner"),

  /** What happens if the feature must be rolled back or shut down (rollback or disable plan). */
  fallbackPlan: z
    .string()
    .min(30, "fallbackPlan must be at least 30 characters — describe the rollback or disable procedure"),
});

/**
 * PRD Schema — the full product requirements document.
 *
 * Enforces all 6 hard gates from the 2026 AI PM framework:
 *   Gate 1: evidenceSignals  — demand is grounded in real user/market data
 *   Gate 2: syntheticEval    — AI quality is formally measured before launch
 *   Gate 3: tcoAnalysis      — build-vs-buy is financially justified
 *   Gate 4: nonFunctionalRequirements — compliance/privacy/explainability decided upfront
 *   Gate 5: operabilityConstraints    — scope and timeline are governed
 *   Gate 6: successMetrics   — every metric is observable and has a degradation plan
 */
export const PRDSchema = z.object({
  /** artifactType discriminator for the unified ArtifactSchema union. */
  artifactType: z.literal("prd"),

  /**
   * The feature or initiative name.
   * Min 10 chars discourages one-word titles like "Dashboard" that provide no context.
   */
  title: z.string().min(10, "Title must be at least 10 characters — be specific"),

  /**
   * A precise description of the problem being solved.
   * Min 100 chars forces PMs to go beyond a single sentence and include
   * evidence, frequency, and affected population size.
   */
  problemStatement: z
    .string()
    .min(100, "Problem statement must be at least 100 characters — include evidence and scope"),

  /** Who exactly is affected and what they need (see TargetUserSchema). */
  targetUser: TargetUserSchema,

  /**
   * Gate 1 — Evidence Signals.
   * Minimum 2 signals required; at least one must have a quantifiedImpact.
   */
  evidenceSignals: z
    .array(EvidenceSignalSchema)
    .min(2, "At least 2 evidence signals are required to pass Gate 1")
    .refine(
      (signals) => signals.some((s) => s.quantifiedImpact !== undefined && s.quantifiedImpact.length > 0),
      "At least one evidence signal must have a quantifiedImpact to pass Gate 1"
    ),

  /**
   * Gate 2 — Synthetic Evaluation results.
   * Must show groundedness ≥ 90%, hallucination ≤ 5%, and passedEvalGate: true.
   */
  syntheticEval: SyntheticEvalSchema,

  /**
   * Gate 3 — Total Cost of Ownership analysis.
   * Requires explicit build-vs-buy decision with financial and strategic justification.
   */
  tcoAnalysis: TCOAnalysisSchema,

  /**
   * Gate 4 — Non-Functional Requirements.
   * Compliance, data residency, PII handling, and explainability must be decided before build.
   */
  nonFunctionalRequirements: NonFunctionalRequirementsSchema,

  /**
   * Gate 5 — Operability Constraints.
   * Production deadline, pilot cap, scope governance, and fallback plan required.
   */
  operabilityConstraints: OperabilityConstraintsSchema,

  /**
   * Gate 6 — Success Metrics with degradation monitoring.
   * Each metric must have a specific numeric target, a monitoring tool,
   * a degradation threshold, and a response plan.
   */
  successMetrics: z
    .array(SuccessMetricSchema)
    .min(1, "At least one success metric is required"),

  /**
   * What this PRD explicitly does NOT cover.
   * Min 2 items forces PMs to think about scope boundaries.
   * The most common PRD failure mode is scope creep from unstated inclusions.
   */
  outOfScope: z
    .array(z.string().min(1))
    .min(2, "List at least 2 out-of-scope items to prevent scope creep"),

  /**
   * Assumptions that must be true for this PRD to deliver value.
   * Making hypotheses explicit creates a learning backlog alongside the build backlog.
   */
  hypotheses: z.array(HypothesisSchema).min(1, "At least one hypothesis required"),

  /**
   * External teams, systems, or decisions this work depends on.
   * Empty arrays are allowed but PMs are encouraged to be thorough —
   * untracked dependencies are a leading cause of delivery delays.
   */
  dependencies: z.array(z.string()),

  /**
   * Semver version of this PRD document.
   * Enables reviewers to detect whether they're reading a stale version
   * and allows diffing scope changes between major/minor revisions.
   */
  artifactVersion: SemverSchema,
});

export type PRD = z.infer<typeof PRDSchema>;
export type TargetUser = z.infer<typeof TargetUserSchema>;
export type SuccessMetric = z.infer<typeof SuccessMetricSchema>;
export type Hypothesis = z.infer<typeof HypothesisSchema>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export type EvidenceSignal = z.infer<typeof EvidenceSignalSchema>;
export type SyntheticEval = z.infer<typeof SyntheticEvalSchema>;
export type TCOAnalysis = z.infer<typeof TCOAnalysisSchema>;
export type NonFunctionalRequirements = z.infer<typeof NonFunctionalRequirementsSchema>;
export type OperabilityConstraints = z.infer<typeof OperabilityConstraintsSchema>;
