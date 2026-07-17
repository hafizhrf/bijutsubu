import OpenAI from "openai";
import { z } from "zod";
import { env } from "../config/env.js";

const client = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  baseURL: env.OPENAI_BASE_URL,
  // Some OpenAI-compatible proxies sit behind Cloudflare WAF rules that block
  // the SDK's default "OpenAI/JS" user-agent; a plain UA passes.
  defaultHeaders: { "User-Agent": "bijustubu-backend/1.0" },
});

/**
 * Calls the OpenAI-compatible chat completions endpoint in JSON mode and
 * validates the result against `schema`. On a validation failure it retries
 * once with the zod error appended to the conversation so the model can
 * self-correct; a second failure throws.
 */
export async function completeJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    const completion = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages,
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const raw = completion.choices[0]?.message?.content ?? "";

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content: "That was not valid JSON. Respond with ONLY a single valid JSON object, no prose.",
      });
      continue;
    }

    const parsed = schema.safeParse(json);
    if (parsed.success) {
      return parsed.data;
    }

    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content: `That JSON did not match the required shape. Validation errors: ${JSON.stringify(
        parsed.error.flatten(),
      )}. Respond again with ONLY a corrected JSON object.`,
    });
  }

  throw new Error("LLM failed to produce schema-valid JSON after retry");
}
