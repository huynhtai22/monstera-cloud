/**
 * Which hosted checkout API the pricing page should call.
 * Default: Paddle. Set NEXT_PUBLIC_PAYMENT_PROVIDER=lemonsqueezy to use LemonSqueezy instead.
 */
export function getCheckoutApiPath(): "/api/checkout/paddle" | "/api/checkout/lemonsqueezy" {
  const p = (process.env.NEXT_PUBLIC_PAYMENT_PROVIDER || "").trim().toLowerCase();
  if (p === "lemonsqueezy" || p === "lemon") {
    return "/api/checkout/lemonsqueezy";
  }
  return "/api/checkout/paddle";
}
