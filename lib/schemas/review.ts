import { z } from "zod";

export const ReviewIssueSchema = z.object({
  severity: z.enum(["critical", "major", "minor", "info"]),
  title: z.string(),
  description: z.string(),
});

export const ReviewResultSchema = z.object({
  score: z.number().min(0).max(10),
  summary: z.string(),
  issues: z.array(ReviewIssueSchema),
  suggestions: z.array(z.string()),
});

export const ReviewRequestSchema = z.object({
  artifact_id: z.number().int().positive().optional(),
  prd_id: z.number().int().positive().optional(),
  /** Inline content — used when IDs are not yet stored */
  content: z.string().optional(),
  title: z.string().optional(),
  context: z.string().optional(),
}).refine(
  (d) => d.artifact_id !== undefined || d.prd_id !== undefined || d.content !== undefined,
  { message: "Provide artifact_id, prd_id, or content" }
);

export const DriftRequestSchema = z.object({
  prd_id: z.number().int().positive(),
  artifact_ids: z.array(z.number().int().positive()).min(1),
});

export const DriftResultSchema = z.object({
  has_drift: z.boolean(),
  drift_score: z.number().min(0).max(10),
  summary: z.string(),
  divergences: z.array(
    z.object({
      artifact_id: z.number(),
      artifact_title: z.string(),
      description: z.string(),
      severity: z.enum(["critical", "major", "minor"]),
    })
  ),
  recommendations: z.array(z.string()),
});

export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
export type DriftRequest = z.infer<typeof DriftRequestSchema>;
export type DriftResult = z.infer<typeof DriftResultSchema>;
