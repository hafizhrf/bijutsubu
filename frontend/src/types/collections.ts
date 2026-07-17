export interface CollectionField {
  name: string;
  type: string;
  nullable?: boolean;
}

export type FieldType = "string" | "number" | "boolean" | "date" | "array" | "object";

export const FIELD_TYPES: FieldType[] = [
  "string",
  "number",
  "boolean",
  "date",
  "array",
  "object",
];

export interface RowRecord {
  _id: string;
  [key: string]: unknown;
}

export interface CollectionRowsResponse {
  fields: CollectionField[];
  rows: RowRecord[];
  total: number;
  skip: number;
  limit: number;
}

export interface NewFieldInput {
  name: string;
  type: FieldType;
  nullable?: boolean;
}

export interface FieldPatchInput {
  newName?: string;
  type?: FieldType;
  nullable?: boolean;
}

export interface CollectionSourceFile {
  originalName: string;
  mimetype: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface MetaCollection {
  _id: string;
  name: string;
  displayName: string;
  fields: CollectionField[];
  sourceFile: CollectionSourceFile;
  createdVia: "auto" | "instruction";
  instructionText: string | null;
  upsertKey: string | null;
  rowCount: number;
  lastAppendedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionSample {
  fields: CollectionField[];
  rows: Record<string, unknown>[];
}

export type RelationType = "one-to-one" | "one-to-many" | "many-to-many";

export interface MetaRelation {
  _id: string;
  fromCollection: string;
  toCollection: string;
  fromField: string;
  toField: string;
  type: RelationType;
  description: string;
  createdVia: "upload-instruction" | "nl-prompt" | "manual";
  createdAt: string;
  updatedAt: string;
}

export interface RelationPromptChange {
  op: "add" | "remove" | "update";
  [key: string]: unknown;
}

export interface RelationPromptResponse {
  relations: MetaRelation[];
  changes: {
    operations: RelationPromptChange[];
    summary: string;
  };
}

export interface UploadPlanRelation {
  toCollection: string;
  fromField: string;
  toField: string;
  type: RelationType;
  description: string;
}

export interface UploadPlan {
  action: "create" | "append" | "replace" | "merge";
  targetCollection: string;
  displayName: string;
  fields: { name: string; type: string; nullable: boolean }[];
  upsertKey: string | null;
  relations: UploadPlanRelation[];
  similarityNote: string | null;
  reasoning: string;
}

export interface SimilarCollection {
  name: string;
  displayName: string;
  fields: string[];
  score: number;
}

export type DuplicateStrategy = "skip" | "overwrite";

export interface UploadCollectionResult {
  collectionName: string;
  displayName: string;
  rowCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedDuplicateCount: number;
  rowsMissingKey: number;
}

export interface UploadPreviewDuplicates {
  /** Incoming rows whose unique-key value already exists in the target. */
  count: number;
  sampleValues: string[];
  inFileDuplicateCount: number;
  rowsMissingKey: number;
}

export interface UploadPreviewCandidate {
  collectionName: string;
  displayName: string;
  score: number | null;
  matchedFields: string[];
  newFields: string[];
  missingRequiredFields: string[];
  uniqueField: string | null;
  duplicates: UploadPreviewDuplicates | null;
}

export interface UploadPreview {
  totalRows: number;
  sampleRows: Record<string, unknown>[];
  incomingFields: { name: string; type: string; nullable: boolean }[];
  candidates: UploadPreviewCandidate[];
}

export interface UploadApplied {
  status: "applied";
  plan: UploadPlan;
  collection: UploadCollectionResult;
  similarityNote: string | null;
  similarCollections: SimilarCollection[];
}

export interface UploadNeedsDecision {
  status: "needs-decision";
  pendingId: string;
  expiresAt: string;
  plan: UploadPlan;
  similarityNote: string | null;
  similarCollections: SimilarCollection[];
  preview: UploadPreview;
}

export type UploadPlanResponse = UploadApplied | UploadNeedsDecision;

/** Pre-write schema edit: rename and/or retype one planned field. */
export interface UploadFieldOverride {
  originalName: string;
  name: string;
  type: string;
}

export type ApplyDecision =
  | { mode: "apply-plan"; fieldOverrides?: UploadFieldOverride[] }
  | { mode: "create-new"; fieldOverrides?: UploadFieldOverride[] }
  | { mode: "merge-into"; targetCollection: string; duplicateStrategy: DuplicateStrategy };
