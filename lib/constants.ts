// ─── Business constants ─────────────────────────────────────────────────────
// Centralised so every route references the same values.

/** Max free-tier agent interactions (lifetime). */
export const FREE_INTERACTION_LIMIT = 5;

/** Daily API-key call cap for Pro users (v1 endpoints). */
export const API_DAILY_LIMIT = 20;

/** Soft daily cap for Pro users in the web editor. */
export const PRO_DAILY_LIMIT = 200;

/** In-process burst rate-limit presets. */
export const RATE_LIMITS = {
  AGENT: { windowMs: 10_000, max: 5 },
  TRANSCRIBE: { windowMs: 60_000, max: 10 },
} as const;
