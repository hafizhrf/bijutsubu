import { z } from "zod";
import { QueryDSLSchema } from "./uiSpec.schema.js";

export const CustomTableSchema = z.object({
  title: z.string().min(1).max(200),
  columns: z
    .array(z.object({ field: z.string().min(1), label: z.string().min(1) }))
    .min(1)
    .max(12),
  query: QueryDSLSchema,
});

export type CustomTable = z.infer<typeof CustomTableSchema>;
