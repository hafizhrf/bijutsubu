import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().default(4000),
  ADMIN_EMAILS: z.string().default("").transform((value) => value.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean)),
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
  // External data sources. The credential key encrypts saved DB passwords at
  // rest (AES-256-GCM); when unset, a key is derived from JWT_SECRET so a
  // self-hosted setup still boots — set an explicit key in production.
  SOURCE_CREDENTIAL_ENC_KEY: z.string().optional(),
  SOURCE_SYNC_RATE_LIMIT_MINUTES: z.coerce.number().positive().default(1),
  // "false" enables the SSRF guard (reject loopback/private/link-local hosts).
  // Defaults to allowing them: self-hosted users connect to localhost DBs.
  SOURCE_ALLOW_PRIVATE_HOSTS: z
    .string()
    .default("true")
    .transform((value) => value !== "false"),
  SOURCE_SYNC_MAX_ROWS: z.coerce.number().positive().default(50_000),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
