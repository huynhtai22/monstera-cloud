/**
 * Hosted checkout path **after** live cutover. Public CheckoutButton still
 * routes to /support?pilot=1 and does not charge in this PR.
 *
 * USD → Paddle. VND → PayOS hosted checkout (VietQR orders). Never mix.
 * LemonSqueezy remains a USD-only legacy env override — never used for VND.
 */
export type CheckoutInvoiceCurrency = "USD" | "VND";

export function getCheckoutApiPath(
  invoiceCurrency: CheckoutInvoiceCurrency = "USD",
): "/api/checkout/paddle" | "/api/payments/vietqr/create" | "/api/checkout/lemonsqueezy" {
  if (invoiceCurrency === "VND") {
    return "/api/payments/vietqr/create";
  }
  const p = (process.env.NEXT_PUBLIC_PAYMENT_PROVIDER || "").trim().toLowerCase();
  if (p === "lemonsqueezy" || p === "lemon") {
    return "/api/checkout/lemonsqueezy";
  }
  return "/api/checkout/paddle";
}

/** Support URL used while public checkout stays Request pilot access. */
export function pilotSupportHref(opts: {
  plan: string;
  billingCycle?: "monthly" | "annual";
  invoiceCurrency?: CheckoutInvoiceCurrency;
}): string {
  const params = new URLSearchParams({ pilot: "1", plan: opts.plan });
  if (opts.billingCycle) params.set("cycle", opts.billingCycle);
  if (opts.invoiceCurrency) params.set("currency", opts.invoiceCurrency);
  return `/support?${params.toString()}`;
}
