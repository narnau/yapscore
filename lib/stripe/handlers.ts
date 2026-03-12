import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { captureServer } from "@/lib/telemetry/posthog-server";

/**
 * Handle Stripe checkout.session.completed — upgrade user to Pro.
 */
export async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const customerId = typeof session.customer === "string" ? session.customer : null;
  if (!customerId) {
    console.error("[stripe webhook] checkout.session.completed missing customer ID");
    return;
  }

  const admin = createAdminClient();
  const { data: upgraded } = await admin
    .from("profiles")
    .update({ plan: "pro" })
    .eq("stripe_customer_id", customerId)
    .select("id")
    .single();

  if (upgraded) {
    captureServer(upgraded.id, "user_upgraded_to_pro", { stripe_customer_id: customerId });
  }

  console.log(`[stripe webhook] upgraded customer ${customerId} to pro`);
}

/**
 * Handle Stripe customer.subscription.deleted — downgrade user to free.
 */
export async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : null;
  if (!customerId) {
    console.error("[stripe webhook] customer.subscription.deleted missing customer ID");
    return;
  }

  const admin = createAdminClient();
  const { data: downgraded } = await admin
    .from("profiles")
    .update({ plan: "free" })
    .eq("stripe_customer_id", customerId)
    .select("id")
    .single();

  if (downgraded) {
    captureServer(downgraded.id, "user_downgraded_to_free", { stripe_customer_id: customerId });
  }

  console.log(`[stripe webhook] downgraded customer ${customerId} to free`);
}
