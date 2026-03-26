import { z } from "zod";
import { PRDSchema } from "./prd.schema";
import { OKRSchema } from "./okr.schema";
import { BriefSchema } from "./brief.schema";

/**
 * ArtifactSchema — discriminated union of all PM artifact types.
 *
 * Using a discriminated union on `artifactType` means:
 * 1. Zod can narrow the type and apply the correct schema automatically
 * 2. TypeScript narrows the type correctly in switch/if guards
 * 3. New artifact types can be added here without touching existing schemas
 *
 * Usage:
 * ```ts
 * const result = ArtifactSchema.safeParse(input);
 * if (result.success && result.data.artifactType === "prd") {
 *   // result.data is fully typed as PRD here
 * }
 * ```
 */
export const ArtifactSchema = z.discriminatedUnion("artifactType", [
  PRDSchema,
  OKRSchema,
  BriefSchema,
]);

/**
 * Union TypeScript type — narrows automatically based on `artifactType`.
 *
 * Example:
 * ```ts
 * function process(artifact: Artifact) {
 *   if (artifact.artifactType === "okr") {
 *     artifact.keyResults; // ✅ typed as KeyResult[]
 *   }
 * }
 * ```
 */
export type Artifact = z.infer<typeof ArtifactSchema>;

/** Extracts just the discriminant literal type: "prd" | "okr" | "brief" */
export type ArtifactType = Artifact["artifactType"];

// Re-export individual schemas and types for convenience
export { PRDSchema } from "./prd.schema";
export type { PRD, TargetUser, SuccessMetric, Hypothesis, RiskLevel } from "./prd.schema";

export { OKRSchema } from "./okr.schema";
export type { OKR, KeyResult, Timeframe, Quarter } from "./okr.schema";

export { BriefSchema } from "./brief.schema";
export type { Brief, Confidence } from "./brief.schema";
