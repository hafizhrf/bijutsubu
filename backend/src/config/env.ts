import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  JWT_EXPIRES_IN: z.string().default("7d"),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: z.string().min(1),
  OPENAI_MODEL: z.string().min(1),
  UPLOAD_RATE_LIMIT_MINUTES: z.coerce.number().positive().default(5),
  UPLOAD_PLAN_RATE_LIMIT_MINUTES: z.coerce.number().positive().default(1),
  GENUI_RATE_LIMIT_MINUTES: z.coerce.number().positive().default(5),
  UPLOAD_MAX_FILE_SIZE_MB: z.coerce.number().positive().default(15),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  // Dify knowledge base (dataset-scoped API, not an app/chat key).
  DIFY_BASE_URL: z.string().min(1),
  DIFY_DATASET_API_KEY: z.string().min(1),
  KB_UPLOAD_RATE_LIMIT_MINUTES: z.coerce.number().positive().default(1),
  KB_CHAT_RATE_LIMIT_MINUTES: z.coerce.number().positive().default(0.2),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
