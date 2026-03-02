import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { captureServer } from "@/lib/posthog-server";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stripe webhook] signature verification failed: ${message}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const admin = createAdminClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const customerId = typeof session.customer === "string" ? session.customer : null;
      if (!customerId) {
        console.error("[stripe webhook] checkout.session.completed missing customer ID");
        break;
      }

      // Upgrade user to pro
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
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const customerId = typeof subscription.customer === "string" ? subscription.customer : null;
      if (!customerId) {
        console.error("[stripe webhook] customer.subscription.deleted missing customer ID");
        break;
      }

      // Downgrade user to free
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
      break;
    }
  }

  return NextResponse.json({ received: true });
}
