import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { stripe, createOrGetCustomer } from "@/lib/stripe";
import { currencyForCountry, stripePriceId } from "@/lib/currency";

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

  const customerId = await createOrGetCustomer(auth.userId, user.email);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

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
}
