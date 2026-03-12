import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { stripe, createOrGetCustomer } from "@/lib/stripe/client";
import { currencyForCountry, stripePriceId } from "@/lib/stripe/currency";

export async function POST(req: NextRequest) {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  const { data: { user } } = await auth.supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: "No email found" }, { status: 400 });
  }

  const country = req.headers.get("x-vercel-ip-country");
  const currency = currencyForCountry(country);
  const priceId = stripePriceId(currency);

  try {
    const customerId = await createOrGetCustomer(auth.userId, user.email);
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").trim();

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      subscription_data: { trial_period_days: 3 },
      success_url: `${appUrl}/editor?upgraded=true`,
      cancel_url: `${appUrl}/editor`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[stripe/checkout] error:", msg, "priceId:", priceId, "country:", country);
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
