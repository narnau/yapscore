/**
 * In-process burst rate limiter.
 *
 * Creates a Map-based limiter scoped to a single Node process.
 * Not shared across Vercel function instances — that's intentional:
 * it only needs to catch rapid-fire bursts from a single user.
 */
export function createRateLimiter(opts: { windowMs: number; max: number }) {
  const map = new Map<string, { count: number; resetAt: number }>();

  return {
    /** Returns `true` if the request is allowed, `false` if rate-limited. */
    check(userId: string): boolean {
      const now = Date.now();
      const entry = map.get(userId);

      if (!entry || now > entry.resetAt) {
        // Purge expired entries to prevent unbounded growth
        if (map.size > 1000) {
          for (const [key, val] of map) {
            if (now > val.resetAt) map.delete(key);
          }
        }
        map.set(userId, { count: 1, resetAt: now + opts.windowMs });
        return true;
      }

      if (entry.count >= opts.max) return false;
      entry.count++;
      return true;
    },
  };
}
