import { describe, test, expect } from "bun:test";
import { currencyForCountry, stripePriceId } from "@/lib/stripe/currency";
import type { Currency } from "@/lib/stripe/currency";

describe("currencyForCountry", () => {
  test("returns USD for US", () => {
    const c = currencyForCountry("US");
    expect(c.code).toBe("USD");
    expect(c.symbol).toBe("$");
  });

  test("returns GBP for GB", () => {
    const c = currencyForCountry("GB");
    expect(c.code).toBe("GBP");
    expect(c.symbol).toBe("\u00a3");
    expect(c.proAmount).toBe("8.99");
  });

  test("returns EUR for EU countries", () => {
    const euCountries = ["DE", "FR", "IT", "ES", "NL", "AT", "BE", "PT", "FI", "IE"];
    for (const country of euCountries) {
      const c = currencyForCountry(country);
      expect(c.code).toBe("EUR");
      expect(c.symbol).toBe("\u20ac");
    }
  });

  test("returns EUR for all 27 EU member states", () => {
    const allEU = [
      "AT",
      "BE",
      "BG",
      "HR",
      "CY",
      "CZ",
      "DK",
      "EE",
      "FI",
      "FR",
      "DE",
      "GR",
      "HU",
      "IE",
      "IT",
      "LV",
      "LT",
      "LU",
      "MT",
      "NL",
      "PL",
      "PT",
      "RO",
      "SK",
      "SI",
      "ES",
      "SE",
    ];
    for (const country of allEU) {
      expect(currencyForCountry(country).code).toBe("EUR");
    }
  });

  test("falls back to USD for unknown countries", () => {
    expect(currencyForCountry("JP").code).toBe("USD");
    expect(currencyForCountry("BR").code).toBe("USD");
    expect(currencyForCountry("AU").code).toBe("USD");
    expect(currencyForCountry("CN").code).toBe("USD");
  });

  test("falls back to USD for null", () => {
    expect(currencyForCountry(null).code).toBe("USD");
  });

  test("falls back to USD for empty string", () => {
    // Empty string is not in EU set and not GB, so falls through to USD
    expect(currencyForCountry("").code).toBe("USD");
  });

  test("price formatting is correct for each currency", () => {
    const usd = currencyForCountry("US");
    expect(usd.proFormatted).toBe("$9.99");
    expect(usd.freeFormatted).toBe("$0");

    const eur = currencyForCountry("DE");
    expect(eur.proFormatted).toBe("\u20ac9.90");
    expect(eur.freeFormatted).toBe("\u20ac0");

    const gbp = currencyForCountry("GB");
    expect(gbp.proFormatted).toBe("\u00a38.99");
    expect(gbp.freeFormatted).toBe("\u00a30");
  });

  test("stripePriceEnvKey is set correctly", () => {
    expect(currencyForCountry("US").stripePriceEnvKey).toBe("STRIPE_PRICE_ID_USD");
    expect(currencyForCountry("DE").stripePriceEnvKey).toBe("STRIPE_PRICE_ID_EUR");
    expect(currencyForCountry("GB").stripePriceEnvKey).toBe("STRIPE_PRICE_ID_GBP");
  });
});

describe("stripePriceId", () => {
  test("returns env var for currency-specific key if set", () => {
    const origEnv = process.env.STRIPE_PRICE_ID_USD;
    process.env.STRIPE_PRICE_ID_USD = "price_usd_123";
    try {
      const c = currencyForCountry("US");
      expect(stripePriceId(c)).toBe("price_usd_123");
    } finally {
      if (origEnv === undefined) delete process.env.STRIPE_PRICE_ID_USD;
      else process.env.STRIPE_PRICE_ID_USD = origEnv;
    }
  });

  test("falls back to STRIPE_PRICE_ID if currency-specific key not set", () => {
    const origUsd = process.env.STRIPE_PRICE_ID_USD;
    const origFallback = process.env.STRIPE_PRICE_ID;
    delete process.env.STRIPE_PRICE_ID_USD;
    process.env.STRIPE_PRICE_ID = "price_fallback";
    try {
      const c = currencyForCountry("US");
      expect(stripePriceId(c)).toBe("price_fallback");
    } finally {
      if (origUsd === undefined) delete process.env.STRIPE_PRICE_ID_USD;
      else process.env.STRIPE_PRICE_ID_USD = origUsd;
      if (origFallback === undefined) delete process.env.STRIPE_PRICE_ID;
      else process.env.STRIPE_PRICE_ID = origFallback;
    }
  });
});
