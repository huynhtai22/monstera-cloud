/**
 * Geo → invoice currency for public pricing and Billing.
 * VN → VND (PayOS / VietQR). Everyone else → USD (Paddle). Never mix gates.
 */

export type PricingCurrency = "USD" | "VND";
export type BillingGate = "paddle" | "vietqr_domestic";

export function pricingCurrencyFromCountry(country: string | null | undefined): PricingCurrency {
  return (country || "").toUpperCase() === "VN" ? "VND" : "USD";
}

export function resolvePricingGeo(opts: {
  country?: string | null;
  vercelCountry?: string | null;
  cfCountry?: string | null;
  acceptLanguage?: string | null;
}): { country: string; currency: PricingCurrency; isVietnam: boolean } {
  let country = (opts.country || opts.vercelCountry || opts.cfCountry || "").toUpperCase();
  if (!country) {
    const lang = (opts.acceptLanguage || "").toLowerCase();
    country = lang.includes("vi") || lang.includes("vn") ? "VN" : "US";
  }
  const isVietnam = country === "VN";
  return {
    country,
    currency: isVietnam ? "VND" : "USD",
    isVietnam,
  };
}

export function billingGateForCurrency(currency: PricingCurrency): BillingGate {
  return currency === "VND" ? "vietqr_domestic" : "paddle";
}
