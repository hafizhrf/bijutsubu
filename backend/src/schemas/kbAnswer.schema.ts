import { z } from "zod";

/** Shape the RAG chat LLM call must return (see knowledge.controller.ts). */
export const KbAnswerSchema = z.object({
  answer: z.string().min(1),
  /** Names of the source documents actually used for the answer. */
  sources: z.array(z.string()),
});

export type KbAnswer = z.infer<typeof KbAnswerSchema>;
