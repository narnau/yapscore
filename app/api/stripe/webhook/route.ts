import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

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
      const customerId = session.customer as string;

      // Upgrade user to pro
      await admin
        .from("profiles")
        .update({ plan: "pro" })
        .eq("stripe_customer_id", customerId);

      console.log(`[stripe webhook] upgraded customer ${customerId} to pro`);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const customerId = subscription.customer as string;

      // Downgrade user to free
      await admin
        .from("profiles")
        .update({ plan: "free", interactions_used: 0 })
        .eq("stripe_customer_id", customerId);

      console.log(`[stripe webhook] downgraded customer ${customerId} to free`);
      break;
    }
  }

  return NextResponse.json({ received: true });
}
