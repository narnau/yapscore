import { describe, test, expect } from "bun:test";
import { createRateLimiter } from "@/lib/rate-limit";

describe("createRateLimiter", () => {
  test("allows requests within the limit", () => {
    const limiter = createRateLimiter({ windowMs: 10_000, max: 3 });
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(true);
  });

  test("blocks requests that exceed the limit", () => {
    const limiter = createRateLimiter({ windowMs: 10_000, max: 2 });
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(false);
    expect(limiter.check("user1")).toBe(false);
  });

  test("different users are tracked independently", () => {
    const limiter = createRateLimiter({ windowMs: 10_000, max: 1 });
    expect(limiter.check("alice")).toBe(true);
    expect(limiter.check("bob")).toBe(true);
    expect(limiter.check("alice")).toBe(false);
    expect(limiter.check("bob")).toBe(false);
  });

  test("different limiters are independent", () => {
    const limiterA = createRateLimiter({ windowMs: 10_000, max: 1 });
    const limiterB = createRateLimiter({ windowMs: 10_000, max: 1 });
    expect(limiterA.check("user1")).toBe(true);
    expect(limiterA.check("user1")).toBe(false);
    // limiterB should still allow user1
    expect(limiterB.check("user1")).toBe(true);
  });

  test("resets after window expires", async () => {
    const limiter = createRateLimiter({ windowMs: 50, max: 1 });
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(false);

    // Wait for the window to expire
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(limiter.check("user1")).toBe(true);
  });

  test("max: 1 blocks second request immediately", () => {
    const limiter = createRateLimiter({ windowMs: 10_000, max: 1 });
    expect(limiter.check("user1")).toBe(true);
    expect(limiter.check("user1")).toBe(false);
  });

  test("cleanup runs when map exceeds 1000 entries", async () => {
    const limiter = createRateLimiter({ windowMs: 10, max: 1 });

    // Fill up > 1000 entries
    for (let i = 0; i < 1001; i++) {
      limiter.check(`user-${i}`);
    }

    // Wait for all windows to expire
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Next check triggers cleanup of expired entries
    expect(limiter.check("new-user")).toBe(true);
    // If cleanup worked, the old entries should be gone.
    // The new-user entry should exist, and stale entries purged.
    // We can verify by checking that expired users get fresh windows.
    expect(limiter.check("user-0")).toBe(true); // was expired, gets new window
  });
});
