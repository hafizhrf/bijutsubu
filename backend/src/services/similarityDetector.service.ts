interface CollectionFieldSummary {
  name: string;
  displayName: string;
  fields: string[];
}

export interface SimilarityCandidate extends CollectionFieldSummary {
  score: number;
}

/**
 * Cheap Jaccard-overlap heuristic over field names, used only to hand the LLM
 * a short, relevant candidate list for grounding — the LLM's own judgement
 * (via ExtractionPlanSchema.similarityNote) is what actually gets shown to
 * the user, this just narrows what it has to look at.
 */
export function findSimilarCollections(
  newFieldNames: string[],
  existing: CollectionFieldSummary[],
  { topN = 3, minScore = 0.25 }: { topN?: number; minScore?: number } = {},
): SimilarityCandidate[] {
  if (newFieldNames.length === 0) return [];

  const newSet = new Set(newFieldNames.map((f) => f.toLowerCase()));

  const scored = existing.map((collection) => {
    const existingSet = new Set(collection.fields.map((f) => f.toLowerCase()));
    const intersection = [...newSet].filter((f) => existingSet.has(f)).length;
    const union = new Set([...newSet, ...existingSet]).size;
    const score = union === 0 ? 0 : intersection / union;
    return { ...collection, score };
  });

  return scored
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
