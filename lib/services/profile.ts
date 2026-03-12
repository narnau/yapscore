import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Upsert a profile row from the Supabase Auth user object.
 * Used after OAuth callback and in the profile sync endpoint.
 */
export async function syncUserProfile(admin: SupabaseClient, user: User) {
  await admin.from("profiles").upsert(
    {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.email?.split("@")[0] ?? "",
      avatar_url: user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null,
    },
    { onConflict: "id" },
  );
}

/**
 * Fetch the profile fields commonly needed by API routes.
 */
export async function getProfile(userId: string) {
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, interactions_used, stripe_customer_id")
    .eq("id", userId)
    .single();

  return {
    plan: (profile?.plan as string) ?? "free",
    used: (profile?.interactions_used as number) ?? 0,
    stripeCustomerId: (profile?.stripe_customer_id as string | null) ?? null,
  };
}
