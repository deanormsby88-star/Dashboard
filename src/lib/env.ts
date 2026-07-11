import { z } from "zod";

/**
 * All environment access goes through here so misconfiguration fails loudly
 * with a readable message instead of surfacing as a mystery downstream.
 * Parsed lazily (not at module load) so `next build` works without secrets.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_MODEL_MEETING_PROCESSOR: z.string().min(1).default("gpt-4.1"),
  OPENAI_MODEL_EMAIL_PROCESSOR: z.string().min(1).default("gpt-4.1"),
  OPENAI_MODEL_PRIORITIZER: z.string().min(1).default("gpt-4.1"),

  ZAPIER_WEBHOOK_SECRET: z
    .string()
    .min(16, "ZAPIER_WEBHOOK_SECRET must be at least 16 characters"),
  ZAPIER_TODOIST_CREATE_HOOK_URL: z.string().url().optional(),
  ZAPIER_TODOIST_UPDATE_HOOK_URL: z.string().url().optional(),
  ZAPIER_TODOIST_COMPLETE_HOOK_URL: z.string().url().optional(),
  // Direct Todoist REST API. When set, Todoist execution bypasses Zapier
  // entirely (no per-task Zapier cost, synchronous task IDs).
  TODOIST_API_TOKEN: z.string().min(1).optional(),

  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),

  DEANOS_EMAIL: z.string().email(),
  DEANOS_PASSWORD_HASH: z.string().min(1, "DEANOS_PASSWORD_HASH is required"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`Invalid environment configuration:\n${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/**
 * Presence-only view for the Settings page. Never exposes values.
 */
export function envStatus(): Record<string, boolean> {
  const keys = [
    "DATABASE_URL",
    "OPENAI_API_KEY",
    "OPENAI_MODEL_MEETING_PROCESSOR",
    "ZAPIER_WEBHOOK_SECRET",
    "ZAPIER_TODOIST_CREATE_HOOK_URL",
    "ZAPIER_TODOIST_UPDATE_HOOK_URL",
    "ZAPIER_TODOIST_COMPLETE_HOOK_URL",
    "TODOIST_API_TOKEN",
    "APP_URL",
    "SESSION_SECRET",
    "DEANOS_EMAIL",
    "DEANOS_PASSWORD_HASH",
  ];
  return Object.fromEntries(
    keys.map((k) => [k, Boolean(process.env[k] && process.env[k]!.length > 0)])
  );
}
