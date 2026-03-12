import { headers } from "next/headers";

export type Currency = {
  code: string;
  symbol: string;
  proAmount: string;   // e.g. "9.99"
  proFormatted: string; // e.g. "$9.99"
  freeFormatted: string;
  stripePriceEnvKey: string;
};

const USD: Currency = {
  code: "USD", symbol: "$",
  proAmount: "9.99", proFormatted: "$9.99", freeFormatted: "$0",
  stripePriceEnvKey: "STRIPE_PRICE_ID_USD",
};
const EUR: Currency = {
  code: "EUR", symbol: "€",
  proAmount: "9.90", proFormatted: "€9.90", freeFormatted: "€0",
  stripePriceEnvKey: "STRIPE_PRICE_ID_EUR",
};
const GBP: Currency = {
  code: "GBP", symbol: "£",
  proAmount: "8.99", proFormatted: "£8.99", freeFormatted: "£0",
  stripePriceEnvKey: "STRIPE_PRICE_ID_GBP",
};

const EU = new Set([
  "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE",
  "GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT",
  "RO","SK","SI","ES","SE",
]);

export function currencyForCountry(country: string | null): Currency {
  if (!country) return USD;
  if (country === "GB") return GBP;
  if (EU.has(country)) return EUR;
  return USD;
}

// For server components — reads Vercel's geo header
export async function detectCurrency(): Promise<Currency> {
  const hdrs = await headers();
  const country = hdrs.get("x-vercel-ip-country");
  return currencyForCountry(country);
}

// Returns the right Stripe Price ID for a currency, falling back to STRIPE_PRICE_ID
export function stripePriceId(currency: Currency): string {
  return process.env[currency.stripePriceEnvKey] ?? process.env.STRIPE_PRICE_ID!;
}
