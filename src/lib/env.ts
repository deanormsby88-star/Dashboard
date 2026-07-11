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
  OPENAI_MODEL_TRANSCRIBE: z.string().min(1).default("gpt-4o-transcribe"),

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

  // Secret for the scheduled daily-brief job. Vercel Cron sends it as a
  // Bearer token; optional so the app boots without it configured.
  CRON_SECRET: z.string().min(16).optional(),

  // Telegram bot channel (all optional — the bot is off until configured).
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  // Secret token registered with the webhook; Telegram echoes it in the
  // X-Telegram-Bot-Api-Secret-Token header on every update.
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
  // Only this chat id may talk to the bot (Dean's private chat).
  TELEGRAM_ALLOWED_CHAT_ID: z.string().min(1).optional(),

  // Shared secret for the iOS Action Button / Shortcuts voice endpoint.
  ASSISTANT_SHORTCUT_SECRET: z.string().min(16).optional(),

  // Microsoft Graph (Outlook calendar read/write). Register a multi-tenant
  // Azure AD app; see docs. Optional until configured.
  MS_CLIENT_ID: z.string().min(1).optional(),
  MS_CLIENT_SECRET: z.string().min(1).optional(),
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
    "CRON_SECRET",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "TELEGRAM_ALLOWED_CHAT_ID",
    "ASSISTANT_SHORTCUT_SECRET",
    "MS_CLIENT_ID",
    "MS_CLIENT_SECRET",
  ];
  return Object.fromEntries(
    keys.map((k) => [k, Boolean(process.env[k] && process.env[k]!.length > 0)])
  );
}
