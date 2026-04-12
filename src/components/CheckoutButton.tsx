'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { metaPixelCustom } from '@/lib/meta-pixel';

interface CheckoutButtonProps {
  plan: 'starter' | 'professional';
  billingCycle?: 'monthly' | 'annual';
  invoiceCurrency?: 'VND' | 'USD'; // kept for API compatibility, LemonSqueezy bills in USD
  /** Meta Pixel custom event — use for Custom Conversions in Events Manager */
  metaPixelEvent?: string;
  metaPixelParams?: Record<string, string | number | boolean>;
  className?: string;
  children: React.ReactNode;
}

const checkoutApiPath =
  process.env.NEXT_PUBLIC_PAYMENT_PROVIDER === 'paddle'
    ? '/api/checkout/paddle'
    : '/api/checkout/lemonsqueezy';

export function CheckoutButton({
  plan,
  billingCycle = 'monthly',
  metaPixelEvent,
  metaPixelParams,
  className,
  children,
}: CheckoutButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleCheckout = async () => {
    if (metaPixelEvent) {
      metaPixelCustom(metaPixelEvent, {
        plan,
        ...metaPixelParams,
      });
    }
    try {
      setIsLoading(true);

      const response = await fetch(checkoutApiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, billingCycle }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = `/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
          return;
        }
        throw new Error(data.error || 'Failed to create checkout session');
      }

      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (error: any) {
      console.error('Checkout error:', error);
      alert(error.message || 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={handleCheckout}
      disabled={isLoading}
      className={cn('flex items-center justify-center w-full relative', className)}
    >
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
      {isLoading ? 'Redirecting to Payment…' : children}
    </button>
  );
}
