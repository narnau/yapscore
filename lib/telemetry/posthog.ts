import posthog from "posthog-js";

const isProduction = typeof window !== "undefined" && process.env.NODE_ENV === "production";

let initialized = false;

export function initPostHog() {
  if (!isProduction || initialized) return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!key || !host) return;

  posthog.init(key, {
    api_host: host,
    person_profiles: "identified_only",
    capture_pageview: false, // we handle this manually
    capture_pageleave: true,
    session_recording: {
      recordCrossOriginIframes: false,
    },
  });
  initialized = true;
}

export function capture(event: string, properties?: Record<string, unknown>) {
  if (!isProduction) return;
  posthog.capture(event, properties);
}

export function identifyUser(userId: string, email?: string) {
  if (!isProduction) return;
  posthog.identify(userId, email ? { email } : undefined);
}

export function resetUser() {
  if (!isProduction) return;
  posthog.reset();
}

export { posthog };
