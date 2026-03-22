'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface CheckoutButtonProps {
  plan: 'starter' | 'professional';
  billingCycle?: 'monthly' | 'annual';
  /** Sent to /api/xendit/checkout — VNĐ or USD (default follows server env, usually VND). */
  invoiceCurrency?: 'VND' | 'USD';
  className?: string;
  children: React.ReactNode;
}

export function CheckoutButton({
  plan,
  billingCycle = 'monthly',
  invoiceCurrency,
  className,
  children,
}: CheckoutButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleCheckout = async () => {
    try {
      setIsLoading(true);
      
      const response = await fetch('/api/xendit/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          plan,
          billingCycle,
          ...(invoiceCurrency ? { currency: invoiceCurrency } : {}),
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        if (response.status === 401) {
          // Redirect to login if unauthorized
          window.location.href = `/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
          return;
        }
        throw new Error(data.error?.message || 'Failed to create checkout session');
      }

      if (data.url) {
        // Redirect standard browser location to Xendit invoice URL
        window.location.href = data.url;
      } else {
        console.error('No redirect URL returned from Xendit', data);
      }
    } catch (error: any) {
      console.error('Error during checkout:', error);
      alert(error.message || 'Something went wrong during checkout. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={handleCheckout}
      disabled={isLoading}
      className={cn(
        "flex items-center justify-center w-full relative", 
        className
      )}
    >
      {isLoading ? (
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
      ) : null}
      {isLoading ? "Redirecting to Payment..." : children}
    </button>
  );
}
