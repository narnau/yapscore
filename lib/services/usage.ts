import { createAdminClient } from "@/lib/supabase/admin";
import { FREE_INTERACTION_LIMIT, PRO_DAILY_LIMIT } from "@/lib/constants";
import { getProfile } from "./profile";

export type UsageLimitResult =
  | { allowed: true;  used: number; limit: number | null; plan: string }
  | { allowed: false; used: number; limit: number;       plan: string; errorResponse: { body: Record<string, unknown>; status: number } };

/**
 * Check whether the user is allowed to make another agent interaction.
 *
 * - Free users: hard cap at FREE_INTERACTION_LIMIT lifetime interactions.
 * - Pro users:  soft daily cap via `check_and_increment_api_calls` RPC.
 */
export async function checkUsageLimit(userId: string): Promise<UsageLimitResult> {
  const { plan, used } = await getProfile(userId);

  if (plan === "free" && used >= FREE_INTERACTION_LIMIT) {
    return {
      allowed: false,
      used,
      limit: FREE_INTERACTION_LIMIT,
      plan,
      errorResponse: {
        body: { error: "limit_reached", usage: { used, limit: FREE_INTERACTION_LIMIT } },
        status: 402,
      },
    };
  }

  if (plan === "pro") {
    const admin = createAdminClient();
    const { data: allowed } = await admin.rpc("check_and_increment_api_calls", {
      p_user_id:     userId,
      p_daily_limit: PRO_DAILY_LIMIT,
    });
    if (!allowed) {
      return {
        allowed: false,
        used,
        limit: PRO_DAILY_LIMIT,
        plan,
        errorResponse: {
          body: { error: "Daily limit reached. Resets at midnight UTC.", limit: PRO_DAILY_LIMIT },
          status: 429,
        },
      };
    }
  }

  return { allowed: true, used, limit: plan === "free" ? FREE_INTERACTION_LIMIT : null, plan };
}
