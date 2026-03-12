import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { getProfile } from "@/lib/services/profile";

export async function POST() {
  try {
    const auth = await getAuthUser();
    if (!auth.ok) return auth.response;

    const { stripeCustomerId } = await getProfile(auth.userId);

    if (!stripeCustomerId) {
      return NextResponse.json({ error: "No subscription found" }, { status: 400 });
    }

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").trim();

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${appUrl}/editor`,
    });

    return NextResponse.json({ url: session.url });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
