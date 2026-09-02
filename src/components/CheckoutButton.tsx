"use client";

import { cn } from "@/lib/utils";
import { metaPixelCustom } from "@/lib/meta-pixel";
import { useRouter } from "next/navigation";

interface CheckoutButtonProps {
  plan: "starter" | "professional";
  billingCycle?: "monthly" | "annual";
  invoiceCurrency?: "VND" | "USD";
  metaPixelEvent?: string;
  metaPixelParams?: Record<string, string | number | boolean>;
  className?: string;
  children: React.ReactNode;
}

export function CheckoutButton({ plan, metaPixelEvent, metaPixelParams, className, children }: CheckoutButtonProps) {
  const router = useRouter();
  function requestPilotAccess() {
    if (metaPixelEvent) metaPixelCustom(metaPixelEvent, { plan, ...metaPixelParams });
    router.push(`/support?pilot=1&plan=${encodeURIComponent(plan)}`);
  }
  return <button type="button" onClick={requestPilotAccess} className={cn("flex w-full items-center justify-center", className)}>{children}</button>;
}
