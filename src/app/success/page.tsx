"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 40_000;

const PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  professional: "Professional",
  pro: "Professional",
};

type State = "polling" | "success" | "timeout";

function SuccessContent() {
  const searchParams = useSearchParams();
  const transactionId = searchParams.get("_ptxn")?.trim() ?? "";
  const [state, setState] = useState<State>("polling");
  const [planLabel, setPlanLabel] = useState("");

  useEffect(() => {
    let stopped = false;
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    async function activateFromPlan(plan: string) {
      if (plan && plan !== "free") {
        setPlanLabel(PLAN_LABELS[plan] ?? plan);
        setState("success");
        return true;
      }
      return false;
    }

    async function pollPlan() {
      const workspaceId = window.localStorage.getItem("activeWorkspaceId")?.trim();
      if (!workspaceId) return false;
      const res = await fetch(`/api/user/plan?workspaceId=${encodeURIComponent(workspaceId)}`);
      if (res.status === 401) {
        const callbackUrl = `${window.location.pathname}${window.location.search}`;
        window.location.href = `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;
        return true;
      }
      if (res.ok) {
        const json = await res.json();
        return activateFromPlan(json.plan ?? "");
      }
      return false;
    }

    async function confirmTransaction() {
      if (!transactionId) return false;
      const workspaceId = window.localStorage.getItem("activeWorkspaceId")?.trim();
      if (!workspaceId) return false;
      const res = await fetch(
        `/api/checkout/paddle/confirm?transactionId=${encodeURIComponent(transactionId)}&workspaceId=${encodeURIComponent(workspaceId)}`
      );
      if (res.status === 401) {
        const callbackUrl = `${window.location.pathname}${window.location.search}`;
        window.location.href = `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;
        return true;
      }
      if (res.ok) {
        const json = await res.json();
        return activateFromPlan(json.plan ?? "");
      }
      return false;
    }

    async function poll() {
      while (!stopped && Date.now() < deadline) {
        try {
          if (await confirmTransaction()) return;
          if (await pollPlan()) return;
        } catch {
          // network hiccup — keep polling
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      if (!stopped) setState("timeout");
    }

    poll();
    return () => {
      stopped = true;
    };
  }, [transactionId]);

  if (state === "polling") {
    return (
      <div className="min-h-screen bg-[#F8FAFC] dark:bg-slate-950 flex flex-col items-center justify-center font-sans px-4">
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-10 max-w-lg w-full shadow-xl border border-emerald-100 dark:border-emerald-900 text-center relative overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-2 bg-gradient-to-r from-emerald-400 to-emerald-600" />
          <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center mx-auto mb-6">
            <svg
              className="w-10 h-10 text-emerald-500 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
            Activating your plan…
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">
            Your payment was received. We&apos;re confirming your subscription — this usually takes a few seconds.
          </p>
        </div>
      </div>
    );
  }

  if (state === "timeout") {
    return (
      <div className="min-h-screen bg-[#F8FAFC] dark:bg-slate-950 flex flex-col items-center justify-center font-sans px-4">
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-10 max-w-lg w-full shadow-xl border border-yellow-100 dark:border-yellow-900 text-center relative overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-2 bg-gradient-to-r from-yellow-400 to-orange-400" />
          <div className="w-20 h-20 rounded-full bg-yellow-50 dark:bg-yellow-900/20 flex items-center justify-center mx-auto mb-6">
            <svg
              className="w-10 h-10 text-yellow-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
            Payment received
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed mb-8">
            Your plan is being activated. It may take a moment to appear — head to the console and refresh if it hasn&apos;t updated yet.
          </p>
          <a
            href="/console"
            className="inline-block w-full py-4 px-6 rounded-xl font-medium text-white bg-emerald-600 hover:bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all"
          >
            Go to Console
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-slate-950 flex flex-col items-center justify-center font-sans px-4">
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-10 max-w-lg w-full shadow-xl border border-emerald-100 dark:border-emerald-900 text-center relative overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-2 bg-gradient-to-r from-emerald-400 to-emerald-600" />
        <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-6">
          <svg
            className="w-10 h-10 text-emerald-600 dark:text-emerald-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          You&apos;re on {planLabel}!
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8 leading-relaxed">
          Your subscription is active. Head to the console to start building your data pipelines.
        </p>
        <a
          href="/console"
          className="inline-block w-full py-4 px-6 rounded-xl font-medium text-white bg-emerald-600 hover:bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all"
        >
          Go to Console
        </a>
      </div>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F8FAFC] dark:bg-slate-950 flex items-center justify-center">
          <p className="text-sm text-gray-500">Loading…</p>
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
