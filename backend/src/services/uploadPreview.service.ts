import { Connection } from "mongoose";
import { ExtractionPlan } from "../schemas/extractionPlan.schema.js";
import { getMetaCollectionModel } from "../models/metaCollection.model.js";
import { SimilarityCandidate } from "./similarityDetector.service.js";

/**
 * Pre-write preview for the two-phase upload flow: for each existing
 * collection the incoming data could be merged into, computes how the shapes
 * line up (matched/new/missing-required fields) and how many incoming rows
 * would collide with existing rows on the collection's unique field — all
 * read-only, so the user can decide merge/skip/create-new before anything is
 * written.
 */

export interface UploadPreviewDuplicates {
  /** Incoming rows whose unique-key value already exists in the target. */
  count: number;
  sampleValues: string[];
  /** Rows sharing a key value with another row in the same file. */
  inFileDuplicateCount: number;
  /** Rows that have no value for the unique key at all. */
  rowsMissingKey: number;
}

export interface UploadPreviewCandidate {
  collectionName: string;
  displayName: string;
  score: number | null;
  matchedFields: string[];
  /** Incoming fields the target doesn't have yet (would be added, nullable). */
  newFields: string[];
  /** Target fields marked non-nullable that the file doesn't provide. */
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

const SAMPLE_ROW_COUNT = 5;
const DUPLICATE_QUERY_BATCH = 1000;
const SAMPLE_VALUE_COUNT = 5;

export async function buildUploadPreview(
  conn: Connection,
  rows: Record<string, unknown>[],
  plan: ExtractionPlan,
  similarCollections: SimilarityCandidate[],
): Promise<UploadPreview> {
  const MetaCollection = getMetaCollectionModel(conn);

  // Candidates: every heuristically-similar collection, plus the plan's own
  // target when the LLM already chose an existing-collection action.
  const candidateNames = new Map<string, number | null>();
  for (const candidate of similarCollections) {
    candidateNames.set(candidate.name, candidate.score);
  }
  if (plan.action !== "create" && !candidateNames.has(plan.targetCollection)) {
    candidateNames.set(plan.targetCollection, null);
  }

  const incomingFieldNames = new Set(plan.fields.map((f) => f.name));
  const candidates: UploadPreviewCandidate[] = [];

  for (const [name, score] of candidateNames) {
    const meta = await MetaCollection.findOne({ name }).lean();
    if (!meta) continue;

    const targetFields = meta.fields as { name: string; nullable?: boolean }[];
    const targetFieldNames = new Set(targetFields.map((f) => f.name));

    const matchedFields = [...incomingFieldNames].filter((f) => targetFieldNames.has(f));
    const newFields = [...incomingFieldNames].filter((f) => !targetFieldNames.has(f));
    const missingRequiredFields = targetFields
      .filter((f) => f.nullable === false && !incomingFieldNames.has(f.name))
      .map((f) => f.name);

    const uniqueField = meta.upsertKey ?? plan.upsertKey ?? null;
    const duplicates = uniqueField
      ? await analyzeDuplicates(conn, name, uniqueField, rows)
      : null;

    candidates.push({
      collectionName: name,
      displayName: meta.displayName,
      score,
      matchedFields,
      newFields,
      missingRequiredFields,
      uniqueField,
      duplicates,
    });
  }

  return {
    totalRows: rows.length,
    sampleRows: rows.slice(0, SAMPLE_ROW_COUNT),
    incomingFields: plan.fields.map((f) => ({
      name: f.name,
      type: f.type,
      nullable: f.nullable,
    })),
    candidates,
  };
}

async function analyzeDuplicates(
  conn: Connection,
  collectionName: string,
  uniqueField: string,
  rows: Record<string, unknown>[],
): Promise<UploadPreviewDuplicates> {
  const seen = new Set<unknown>();
  let inFileDuplicateCount = 0;
  let rowsMissingKey = 0;

  for (const row of rows) {
    const value = row[uniqueField];
    if (value === undefined || value === null || value === "") {
      rowsMissingKey += 1;
      continue;
    }
    if (seen.has(value)) inFileDuplicateCount += 1;
    else seen.add(value);
  }

  const distinctValues = [...seen];
  const collection = conn.collection(collectionName);
  const existingValues: unknown[] = [];
  for (let i = 0; i < distinctValues.length; i += DUPLICATE_QUERY_BATCH) {
    const batch = distinctValues.slice(i, i + DUPLICATE_QUERY_BATCH);
    const found = await collection
      .find({ [uniqueField]: { $in: batch } })
      .project({ [uniqueField]: 1, _id: 0 })
      .toArray();
    for (const doc of found) existingValues.push((doc as Record<string, unknown>)[uniqueField]);
  }

  const existingSet = new Set(existingValues);
  return {
    count: existingSet.size,
    sampleValues: [...existingSet].slice(0, SAMPLE_VALUE_COUNT).map((v) => String(v)),
    inFileDuplicateCount,
    rowsMissingKey,
  };
}
