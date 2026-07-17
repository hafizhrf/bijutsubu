import { z } from "zod";

const FieldTypeEnum = z.enum(["string", "number", "boolean", "date", "array", "object"]);

export const FieldDefSchema = z.object({
  name: z.string().min(1),
  type: FieldTypeEnum,
  nullable: z.boolean().default(false),
});

const RelationNoteSchema = z.object({
  toCollection: z.string().min(1),
  fromField: z.string().min(1),
  toField: z.string().min(1),
  type: z.enum(["one-to-one", "one-to-many", "many-to-many"]),
  description: z.string().min(1),
});

export const ExtractionPlanSchema = z
  .object({
    action: z.enum(["create", "append", "replace", "merge"]),
    targetCollection: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,63}$/, "must be lowercase snake_case, 2-64 chars"),
    displayName: z.string().min(1),
    fields: z.array(FieldDefSchema).min(1),
    upsertKey: z.string().nullable(),
    relations: z.array(RelationNoteSchema).default([]),
    similarityNote: z.string().nullable(),
    reasoning: z.string().min(1),
    // Populated only when the source document was raw narrative text (PDF/TXT/MD/DOCX)
    // with no inherent row structure — the LLM extracts structured records itself here.
    // Left empty for CSV/Excel uploads, where rows are already parsed deterministically.
    extractedRecords: z.array(z.record(z.string(), z.unknown())).default([]),
  })
  .superRefine((val, ctx) => {
    if (val.action === "replace" && !val.upsertKey) {
      ctx.addIssue({
        code: "custom",
        message: "upsertKey is required when action is 'replace'",
        path: ["upsertKey"],
      });
    }
  });

export type ExtractionPlan = z.infer<typeof ExtractionPlanSchema>;
