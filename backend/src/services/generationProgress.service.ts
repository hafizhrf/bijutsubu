/**
 * In-memory progress stages for in-flight dashboard generations, keyed by the
 * client's stable requestId. Deliberately not persisted: on a multi-instance
 * deployment (or after a restart) the progress poll simply 404s and the
 * frontend falls back to its indeterminate spinner — generation correctness
 * never depends on this map.
 */

export type GenerationStage = "guarding" | "designing" | "executing" | "saving";

interface StageEntry {
  stage: GenerationStage;
  updatedAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

const stages = new Map<string, StageEntry>();
let lastSweep = Date.now();

function sweep(): void {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, entry] of stages) {
    if (now - entry.updatedAt > TTL_MS) stages.delete(key);
  }
}

export function setGenerationStage(requestId: string, stage: GenerationStage): void {
  sweep();
  stages.set(requestId, { stage, updatedAt: Date.now() });
}

export function getGenerationStage(requestId: string): GenerationStage | null {
  sweep();
  return stages.get(requestId)?.stage ?? null;
}

export function clearGenerationStage(requestId: string): void {
  stages.delete(requestId);
}
