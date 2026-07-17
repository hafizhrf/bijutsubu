import { z } from "zod";

const RelationTypeEnum = z.enum(["one-to-one", "one-to-many", "many-to-many"]);

const AddOpSchema = z.object({
  op: z.literal("add"),
  fromCollection: z.string().min(1),
  toCollection: z.string().min(1),
  fromField: z.string().min(1),
  toField: z.string().min(1),
  type: RelationTypeEnum,
  description: z.string().min(1),
});

const RemoveOpSchema = z.object({
  op: z.literal("remove"),
  fromCollection: z.string().min(1),
  toCollection: z.string().min(1),
});

const UpdateOpSchema = z.object({
  op: z.literal("update"),
  fromCollection: z.string().min(1),
  toCollection: z.string().min(1),
  fromField: z.string().min(1).optional(),
  toField: z.string().min(1).optional(),
  type: RelationTypeEnum.optional(),
  description: z.string().min(1).optional(),
});

/**
 * Creates a (nullable, null-backfilled) field on a collection so a relation
 * has a foreign key to hang off — e.g. "link every sales record to a contact"
 * when sales_records has no contact/pic field yet.
 */
const AddFieldOpSchema = z.object({
  op: z.literal("add-field"),
  collection: z.string().min(1),
  field: z.string().regex(/^[a-zA-Z0-9_][a-zA-Z0-9_ \-/()]{0,63}$/),
  fieldType: z.enum(["string", "number", "boolean", "date", "array", "object"]),
  reason: z.string().min(1),
});

export const RelationUpdateSchema = z.object({
  operations: z
    .array(z.discriminatedUnion("op", [AddOpSchema, RemoveOpSchema, UpdateOpSchema, AddFieldOpSchema]))
    .min(1),
  summary: z.string().min(1),
});

export type RelationUpdate = z.infer<typeof RelationUpdateSchema>;
