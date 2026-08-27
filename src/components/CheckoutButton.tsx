"use client";

import { cn } from "@/lib/utils";
import { metaPixelCustom } from "@/lib/meta-pixel";
import { useRouter } from "next/navigation";
import { pilotSupportHref } from "@/lib/checkout-api-path";

interface CheckoutButtonProps {
  plan: "starter" | "professional";
  billingCycle?: "monthly" | "annual";
  invoiceCurrency?: "VND" | "USD";
  metaPixelEvent?: string;
  metaPixelParams?: Record<string, string | number | boolean>;
  className?: string;
  children: React.ReactNode;
}

/** Catalog approved 2026-08-27. This button still does not charge; invoiceCurrency is kept for dual-gate cutover. */
export function CheckoutButton({
  plan,
  billingCycle,
  invoiceCurrency,
  metaPixelEvent,
  metaPixelParams,
  className,
}: CheckoutButtonProps) {
  const router = useRouter();
  function requestPilotAccess() {
    if (metaPixelEvent) {
      metaPixelCustom(metaPixelEvent, {
        plan,
        ...(billingCycle ? { billingCycle } : {}),
        ...(invoiceCurrency ? { invoiceCurrency } : {}),
        ...metaPixelParams,
      });
    }
    router.push(pilotSupportHref({ plan, billingCycle, invoiceCurrency }));
  }
  return <button type="button" onClick={requestPilotAccess} className={cn("flex w-full items-center justify-center", className)}>Request pilot access</button>;
}
