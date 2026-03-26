import { z } from "zod";

export const PRDStatusSchema = z.enum(["draft", "review", "approved", "deprecated"]);

export const PRDSchema = z.object({
  id: z.number().int().positive(),
  product_id: z.number().int().positive(),
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  status: PRDStatusSchema,
  version: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const CreatePRDSchema = z.object({
  product_id: z.number().int().positive("product_id is required"),
  title: z.string().min(1, "Title is required").max(200),
  content: z.string().min(1, "Content is required"),
  status: PRDStatusSchema.optional().default("draft"),
});

export const UpdatePRDSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  status: PRDStatusSchema.optional(),
});

export type PRD = z.infer<typeof PRDSchema>;
export type CreatePRD = z.infer<typeof CreatePRDSchema>;
export type UpdatePRD = z.infer<typeof UpdatePRDSchema>;
export type PRDStatus = z.infer<typeof PRDStatusSchema>;
