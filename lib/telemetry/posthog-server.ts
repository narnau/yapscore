import { PostHog } from "posthog-node";

let _client: PostHog | null = null;

export function getPostHogServer(): PostHog | null {
  if (process.env.NODE_ENV !== "production") return null;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!key || !host) return null;

  if (!_client) {
    _client = new PostHog(key, { host, flushAt: 1, flushInterval: 0 });
  }
  return _client;
}

/**
 * Server-side PostHog capture. Fire-and-forget — never blocks the request.
 */
export function captureServer(distinctId: string, event: string, properties?: Record<string, unknown>) {
  getPostHogServer()?.capture({ distinctId, event, properties });
}
