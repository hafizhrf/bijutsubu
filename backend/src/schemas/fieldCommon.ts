import { z } from "zod";

/**
 * Shared field-name/type rules for user-editable schema surfaces (collections
 * editor, pre-write upload overrides). One source of truth so the two paths
 * can't drift.
 */
export const FIELD_NAME_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9_ \-/()]{0,63}$/;

export const FieldTypeEnum = z.enum(["string", "number", "boolean", "date", "array", "object"]);

export type FieldType = z.infer<typeof FieldTypeEnum>;
