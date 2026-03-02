import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";

export async function DELETE() {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  const admin = createAdminClient();

  // 1. Cancel Stripe subscription if exists
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", auth.userId)
    .single();

  if (profile?.stripe_customer_id) {
    const subscriptions = await stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      status: "active",
    });
    for (const sub of subscriptions.data) {
      await stripe.subscriptions.cancel(sub.id);
    }
  }

  // 2. Delete all user files
  await admin.from("files").delete().eq("user_id", auth.userId);

  // 3. Delete all API keys
  await admin.from("api_keys").delete().eq("user_id", auth.userId);

  // 4. Delete profile
  await admin.from("profiles").delete().eq("id", auth.userId);

  // 5. Delete Supabase auth user
  await admin.auth.admin.deleteUser(auth.userId);

  return NextResponse.json({ ok: true });
}
