/* ==========================================================================
   Environment
   --------------------------------------------------------------------------
   Read in one place so a missing variable produces one clear message rather
   than an undefined creeping into a fetch call. Nothing here is validated at
   import time: the portal must still boot in demo mode with no keys at all.
   ========================================================================== */

const read = (name: string): string | null => {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : null;
};

/* Referenced by their full name rather than through a helper, because Next
   only inlines NEXT_PUBLIC_* variables it can see literally in the source. */
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL.trim() !== ""
    ? process.env.NEXT_PUBLIC_SUPABASE_URL.trim()
    : null;

const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim() !== ""
    ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim()
    : null;

const DEMO_FLAG =
  process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === "true" ||
  process.env.NEXT_PUBLIC_PORTAL_DEMO_MODE === "1";

export const env = {
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
  get supabaseServiceRoleKey() {
    return read("SUPABASE_SERVICE_ROLE_KEY");
  },
  get openaiApiKey() {
    return read("OPENAI_API_KEY");
  },
  get openaiModel() {
    return read("OPENAI_MODEL") ?? "gpt-4.1";
  },
  get recallApiKey() {
    return read("RECALL_API_KEY");
  },
  get recallRegion() {
    return read("RECALL_REGION") ?? "us-west-2";
  },
  get recallWebhookSecret() {
    return read("RECALL_WEBHOOK_SECRET");
  },
  get googleClientId() {
    return read("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret() {
    return read("GOOGLE_CLIENT_SECRET");
  },
  get appUrl() {
    return read("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000";
  },
  get marketingSiteUrl() {
    return read("NEXT_PUBLIC_MARKETING_URL") ?? "https://ownyourstudy.com";
  },
} as const;

/**
 * Demo mode is the state the portal runs in when no database is configured —
 * or when it is explicitly asked for. It serves a fixed in-memory dataset so
 * every screen, state and role can be seen without an account. It is loudly
 * labelled in the UI, and it refuses to start if Supabase credentials are
 * present unless the flag is set on purpose.
 */
export function isDemoMode(): boolean {
  if (DEMO_FLAG) return true;
  return !(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/**
 * Whether the paid question banks and mock papers may be served at all.
 *
 * Demo mode has no authentication worth the name: its login page hands any role
 * to anyone who clicks, and tutors pass the paid-content gate. A portal
 * deployed without its Supabase secrets falls back to demo mode — so without
 * this, a first deploy would publish every question and every paper to whoever
 * picked the tutor account.
 *
 * Set PORTAL_DEMO_PAID_CONTENT=true to open it locally on purpose.
 */
export function paidContentAvailable(): boolean {
  return !isDemoMode() || process.env.PORTAL_DEMO_PAID_CONTENT === "true";
}

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/** Integrations report their own readiness so the UI can say what is wired up
 *  rather than pretending everything is. */
export interface IntegrationStatus {
  configured: boolean;
  detail: string;
}

export function openAiStatus(): IntegrationStatus {
  return env.openaiApiKey
    ? { configured: true, detail: `Ready — model ${env.openaiModel}` }
    : { configured: false, detail: "No OPENAI_API_KEY set. Lesson analysis will not run." };
}

export function googleStatus(): IntegrationStatus {
  if (!env.googleClientId || !env.googleClientSecret) {
    return {
      configured: false,
      detail:
        "No GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET set. Meet links must be pasted in by hand.",
    };
  }
  return { configured: true, detail: "Ready — tutors can connect their Google Calendar." };
}

export function recallStatus(): IntegrationStatus {
  return env.recallApiKey
    ? { configured: true, detail: `Ready — region ${env.recallRegion}` }
    : {
        configured: false,
        detail: "No RECALL_API_KEY set. The notetaker cannot be scheduled into meetings.",
      };
}
