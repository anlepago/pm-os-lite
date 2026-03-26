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
const RiskLevelSchema = z.enum(["low", "medium", "high"]);

/**
 * Target User — the most important section of any PRD.
 * Decomposing the user into segment + pain points + JTBD prevents
 * vague "our users want X" statements and forces evidence-based specificity.
 */
const TargetUserSchema = z.object({
  /** Demographic or behavioral cohort (e.g. "SMB finance managers, <50 employees"). */
  segment: z.string().min(1),

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
 * Success Metric — each metric needs all four fields to be actionable.
 * Baseline prevents "increase by X%" without a denominator.
 * measurementMethod prevents disputes about whether the target was hit.
 */
const SuccessMetricSchema = z.object({
  /** Human-readable metric name (e.g. "Dashboard session time"). */
  metric: z.string().min(1),

  /** Current measured value before the feature ships. */
  baseline: z.string().min(1),

  /** The specific value that constitutes success. */
  target: z.string().min(1),

  /**
   * How and where this will be measured (tool + event name).
   * Without this, post-launch debates about measurement methodology kill accountability.
   */
  measurementMethod: z.string().min(1),
});

/**
 * Hypothesis — makes implicit assumptions explicit and testable.
 * Every PRD contains assumptions; this schema forces them to be written down
 * along with how they'll be validated, so the team can de-risk before building.
 */
const HypothesisSchema = z.object({
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
 * PRD Schema — the full product requirements document.
 *
 * Designed for rigor: every field exists to prevent a specific class of
 * PM failure (vague scope, unmeasurable success, hidden assumptions, etc.).
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
   * How success will be defined and measured.
   * Array form prevents single-metric thinking (e.g. only tracking NPS
   * while ignoring retention or support load).
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
