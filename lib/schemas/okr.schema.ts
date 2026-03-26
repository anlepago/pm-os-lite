import { z } from "zod";

/**
 * Quarter enum — restricts timeframe to actual planning quarters.
 * Prevents freeform "H2" or "Summer" timeframes that are hard to
 * track across teams and impossible to roll up into company-level OKR reviews.
 */
const QuarterSchema = z.enum(["Q1", "Q2", "Q3", "Q4"]);

/**
 * Timeframe — quarter + year pairing.
 * Splitting these fields (instead of a freeform string like "Q3 2026") enables
 * programmatic filtering, sorting, and grouping in dashboards.
 */
const TimeframeSchema = z.object({
  quarter: QuarterSchema,

  /**
   * Full four-digit year.
   * Min 2020 guards against typos; max 2100 is a sanity bound.
   */
  year: z
    .number()
    .int()
    .min(2020, "Year must be 2020 or later")
    .max(2100, "Year must be realistic"),
});

/**
 * Key Result — the measurable outcome that proves the Objective was achieved.
 *
 * OKR anti-pattern this schema prevents: KRs written as tasks ("Launch feature X")
 * rather than outcomes ("Increase metric Y from A to B by date Z").
 * Every field here corresponds to one component of a well-formed outcome statement.
 */
const KeyResultSchema = z.object({
  /**
   * The outcome statement in plain language.
   * Convention: "Increase/Decrease/Maintain [metric] from [baseline] to [target] by [date]."
   */
  kr: z.string().min(10, "Key result must be a meaningful outcome statement"),

  /**
   * The specific metric being moved (e.g. "weekly_active_users").
   * Storing this separately from the text enables programmatic tracking
   * and prevents the same metric being tracked inconsistently across KRs.
   */
  metric: z.string().min(1),

  /**
   * The metric's value at the start of the OKR period.
   * Without a baseline, "increase by 20%" is unmeasurable and unverifiable.
   */
  currentValue: z.number(),

  /**
   * The value that constitutes 100% completion of this KR.
   * Stored as a number so progress percentage can be computed automatically.
   */
  targetValue: z.number(),

  /**
   * ISO 8601 date string — when this KR must be achieved.
   * Due dates per KR (not just per quarter) allow mid-quarter check-ins
   * and catch KRs that require early completion to unblock dependent work.
   */
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be an ISO date string (YYYY-MM-DD)"),
});

/**
 * OKR Schema — Objective + Key Results.
 *
 * OKRs answer "where are we going and how will we know we got there?"
 * This schema enforces the structural discipline that makes OKRs useful
 * rather than just aspirational slide deck content.
 */
export const OKRSchema = z.object({
  /** artifactType discriminator for the unified ArtifactSchema union. */
  artifactType: z.literal("okr"),

  /**
   * The qualitative, inspirational goal — what does "winning" look like?
   * Objectives should be memorable and motivating, not metric-heavy
   * (metrics belong in Key Results).
   */
  objective: z.string().min(10, "Objective must be meaningful — avoid one-liners"),

  /**
   * The measurable outcomes that define success for this Objective.
   * 2–5 KRs is the standard range: fewer risks missing important dimensions,
   * more risks diluting focus and overwhelming the team.
   */
  keyResults: z
    .array(KeyResultSchema)
    .min(2, "At least 2 key results required")
    .max(5, "No more than 5 key results — keep focus"),

  /**
   * The planning period this OKR belongs to.
   * Structured timeframe enables cross-team OKR aggregation and quarterly reviews.
   */
  timeframe: TimeframeSchema,

  /**
   * The person or team accountable for this OKR.
   * Without a named owner, OKRs diffuse accountability across "everyone" and get ignored.
   */
  owner: z.string().min(1, "Owner is required — OKRs without owners get forgotten"),
});

export type OKR = z.infer<typeof OKRSchema>;
export type KeyResult = z.infer<typeof KeyResultSchema>;
export type Timeframe = z.infer<typeof TimeframeSchema>;
export type Quarter = z.infer<typeof QuarterSchema>;
