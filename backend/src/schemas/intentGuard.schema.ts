import { z } from "zod";

export const IntentGuardSchema = z.object({
  allowed: z.boolean(),
  category: z.enum([
    "visualization_request",
    "page_design_request",
    "off_topic",
    "destructive_request",
    "prompt_injection",
    "inappropriate_content",
    "ambiguous",
  ]),
  reasonForUser: z.string().min(1),
});

export type IntentGuardResult = z.infer<typeof IntentGuardSchema>;
