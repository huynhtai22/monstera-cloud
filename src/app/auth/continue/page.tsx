"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { getPostLoginRedirectPath } from "@/lib/post-login-redirect";
import { safeCallbackUrl } from "@/lib/safe-callback-url";

/**
 * OAuth redirect target: applies the same post-login rules as email/password
 * (free users → /pricing when they would have landed on /console).
 */
function ContinueInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status } = useSession();
  const nextRaw = searchParams.get("next") ?? "/console";
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      const back = `/auth/continue?next=${encodeURIComponent(nextRaw)}`;
      router.replace(`/login?callbackUrl=${encodeURIComponent(back)}`);
      return;
    }

    if (status !== "authenticated") return;

    let cancelled = false;
    (async () => {
      try {
        // Prefer /api/user/plan (DB-direct) over /api/auth/session to guarantee
        // we see the current DB plan, not a potentially stale session value.
        let plan: string | undefined;
        const planRes = await fetch("/api/user/plan");
        if (planRes.ok) {
          const planData = (await planRes.json()) as { plan?: string };
          plan = planData?.plan;
        } else {
          // Fallback: read from session endpoint
          const r = await fetch("/api/auth/session");
          const data = (await r.json()) as { user?: { plan?: string } };
          plan = data?.user?.plan;
        }
        if (cancelled) return;
        const dest = getPostLoginRedirectPath(
          plan,
          safeCallbackUrl(nextRaw, "/console")
        );
        router.replace(dest);
      } catch {
        if (!cancelled) setError("Could not continue sign-in. Try again.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, nextRaw, router]);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white dark:bg-slate-950 px-4">
        <p className="text-red-600 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white dark:bg-slate-950">
      <Loader2 className="w-8 h-8 animate-spin text-[#1ba177]" />
      <p className="mt-4 text-sm text-gray-500">Redirecting…</p>
    </div>
  );
}

export default function AuthContinuePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-white dark:bg-slate-950">
          <Loader2 className="w-8 h-8 animate-spin text-[#1ba177]" />
        </div>
      }
    >
      <ContinueInner />
    </Suspense>
  );
}
