import { z } from "zod";

export const ArtifactTypeSchema = z.enum(["ticket", "spec", "design", "test_plan"]);

export const ArtifactSchema = z.object({
  id: z.number().int().positive(),
  prd_id: z.number().int().positive(),
  type: ArtifactTypeSchema,
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  source_url: z.string().url().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const CreateArtifactSchema = z.object({
  prd_id: z.number().int().positive("prd_id is required"),
  type: ArtifactTypeSchema,
  title: z.string().min(1, "Title is required").max(200),
  content: z.string().min(1, "Content is required"),
  source_url: z.string().url().optional(),
});

export type Artifact = z.infer<typeof ArtifactSchema>;
export type CreateArtifact = z.infer<typeof CreateArtifactSchema>;
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;
