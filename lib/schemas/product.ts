import { z } from "zod";

export const ProductSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable(),
  owner: z.string().email().nullable(),
  created_at: z.string().datetime({ offset: true }).or(z.string()),
  updated_at: z.string().datetime({ offset: true }).or(z.string()),
});

export const CreateProductSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  description: z.string().max(500).optional(),
  owner: z.string().email("Must be a valid email").optional(),
});

export const UpdateProductSchema = CreateProductSchema.partial();

export type Product = z.infer<typeof ProductSchema>;
export type CreateProduct = z.infer<typeof CreateProductSchema>;
export type UpdateProduct = z.infer<typeof UpdateProductSchema>;
