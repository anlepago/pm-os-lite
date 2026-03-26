import { z } from "zod";

/**
 * Confidence enum — a lightweight forcing function for intellectual honesty.
 *
 * PMs are routinely overconfident about impact estimates. Requiring an
 * explicit confidence level surfaces uncertainty early so stakeholders
 * can calibrate how much discovery work should precede commitment.
 *
 * low    — signal-level intuition; needs validation before any build
 * medium — some qualitative evidence; worth a spike or prototype
 * high   — strong quantitative evidence; ready for scoping
 */
const ConfidenceSchema = z.enum(["low", "medium", "high"]);

/**
 * Brief Schema — a lighter-weight artifact than a PRD.
 *
 * Briefs are used early in the discovery phase, before a problem is
 * fully understood or a solution is committed to. They answer the
 * question "should we investigate this?" rather than "how do we build this?"
 *
 * A Brief graduating to a PRD is a signal that discovery is complete
 * and the team is ready to make binding scope commitments.
 */
export const BriefSchema = z.object({
  /** artifactType discriminator for the unified ArtifactSchema union. */
  artifactType: z.literal("brief"),

  /**
   * The market or user opportunity being considered.
   * Framed as an opportunity (not a solution) to keep the Brief discovery-mode.
   * A good opportunity statement references a real user pain or market gap.
   */
  opportunity: z.string().min(10, "Describe the opportunity — not the solution"),

  /**
   * An early hypothesis about how to capture the opportunity.
   * Labelled "proposed" to signal it is not a commitment — it's a starting
   * point for discovery that may change significantly.
   */
  proposedSolution: z.string().min(10, "Describe a proposed approach — it doesn't need to be final"),

  /**
   * References to OKR IDs this Brief is intended to advance.
   * Linking to OKRs prevents "orphan" work that sounds good in isolation
   * but doesn't move any needle the company actually cares about.
   * Empty array is allowed but should trigger a review question.
   */
  linkedOKRs: z.array(z.string()),

  /**
   * A narrative or quantitative description of what "winning" looks like.
   * Deliberately kept as a freeform string (not a structured metric) because
   * Briefs are pre-discovery — structured metrics come later in the PRD.
   */
  estimatedImpact: z.string().min(10, "Describe the expected impact if this succeeds"),

  /**
   * How confident the author is in the opportunity and proposed solution.
   * This is the most honest field in the artifact — it forces the PM to
   * acknowledge how much they actually know vs. are assuming.
   */
  confidence: ConfidenceSchema,
});

export type Brief = z.infer<typeof BriefSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
