import type { Metadata } from "next";
import Link from "next/link";
import { PRODUCT_SITE_URL } from "@/lib/site-url";
import { ArrowRight, KeyRound, LineChart, Shield, BookOpen } from "lucide-react";

export const metadata: Metadata = {
  title: "Looker Studio connector",
  description:
    "Connect Monstera Cloud campaign metrics to Looker Studio with a workspace API key. Meta Ads, Google Ads, and TikTok Ads data.",
  alternates: { canonical: `${PRODUCT_SITE_URL}/looker-studio` },
};

export default function LookerStudioConnectorPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 pt-28 pb-20">
      <p className="text-xs font-semibold uppercase tracking-widest text-cyan-400">
        Looker Studio
      </p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
        Monstera Cloud connector
      </h1>
      <p className="mt-4 text-base text-slate-300 leading-relaxed">
        This page describes the official Monstera Cloud community connector for{" "}
        <span className="text-white">Looker Studio</span>. The connector reads campaign metrics
        already stored in your Monstera workspace (from Meta Ads, Google Ads, and TikTok for
        Business) and lets you build dashboards in Looker Studio using a{" "}
        <span className="text-white">workspace API key</span>—no separate OAuth flow inside
        Looker.
      </p>

      <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-950/40 p-6">
        <h2 className="text-lg font-bold text-white">Before you connect</h2>
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-slate-300">
          <li>
            <span className="font-medium text-slate-200">Monstera account</span> —{" "}
            <Link href="/register" className="text-cyan-400 hover:underline">
              Create a free account
            </Link>{" "}
            or{" "}
            <Link href="/login" className="text-cyan-400 hover:underline">
              sign in
            </Link>
            .
          </li>
          <li>
            <span className="font-medium text-slate-200">Ad platforms</span> — Connect Meta Ads,
            Google Ads, and/or TikTok for Business in the{" "}
            <Link href="/sources" className="text-cyan-400 hover:underline">
              Data Sources
            </Link>{" "}
            console and ensure data has synced so metrics exist in your workspace.
          </li>
          <li>
            <span className="font-medium text-slate-200">API key</span> — In Monstera, open{" "}
            <Link href="/settings" className="text-cyan-400 hover:underline">
              Settings
            </Link>
            , create a workspace API key, and copy it. You will paste this key when Looker Studio
            prompts for credentials.
          </li>
        </ol>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/30 p-4">
          <KeyRound className="h-5 w-5 shrink-0 text-cyan-500" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold text-white">Authentication</h3>
            <p className="mt-1 text-xs text-slate-400 leading-snug">
              API key only. Keys are scoped to your workspace. Rotate or revoke keys from Settings
              at any time.
            </p>
          </div>
        </div>
        <div className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/30 p-4">
          <LineChart className="h-5 w-5 shrink-0 text-cyan-500" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold text-white">Data in reports</h3>
            <p className="mt-1 text-xs text-slate-400 leading-snug">
              Looker Studio supplies a report date range; Monstera returns metrics only for those
              dates (up to 50,000 rows per request). Dimensions include date, platform, accounts,
              campaigns, and ad sets. Raw metrics include spend, impressions, clicks, conversions,
              and revenue. Add <span className="text-slate-300 font-medium">Calculated Fields</span> in
              your report for derived ratios: CPC = Spend / Clicks, CTR = Clicks / Impressions,
              CPM = (Spend / Impressions) × 1000, ROAS = Revenue / Spend.
            </p>
          </div>
        </div>
        <div className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/30 p-4">
          <Shield className="h-5 w-5 shrink-0 text-cyan-500" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold text-white">Network</h3>
            <p className="mt-1 text-xs text-slate-400 leading-snug">
              The connector calls Monstera only over HTTPS at{" "}
              <span className="font-mono text-slate-300">monsteracloud.com</span> (Looker Studio
              Apps Script <span className="font-mono text-slate-300">UrlFetchApp</span>).
            </p>
          </div>
        </div>
        <div className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/30 p-4">
          <BookOpen className="h-5 w-5 shrink-0 text-cyan-500" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold text-white">Support</h3>
            <p className="mt-1 text-xs text-slate-400 leading-snug">
              Questions or errors? See{" "}
              <Link href="/support" className="text-cyan-400 hover:underline">
                Support
              </Link>{" "}
              for troubleshooting and contact options.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-10 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-6">
        <h2 className="text-base font-bold text-white">Legal</h2>
        <p className="mt-2 text-sm text-slate-300">
          By using Monstera Cloud and this connector, you agree to our policies on this domain:
        </p>
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <li>
            <Link
              href="/legal/privacy-policy"
              className="inline-flex items-center gap-1 font-medium text-cyan-400 hover:underline"
            >
              Privacy Policy
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </li>
          <li>
            <Link
              href="/legal/terms-of-service"
              className="inline-flex items-center gap-1 font-medium text-cyan-400 hover:underline"
            >
              Terms of Service
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </li>
        </ul>
      </div>

      <p className="mt-10 text-xs text-slate-500">
        Connector script for developers is maintained in the Monstera Cloud repository under{" "}
        <span className="font-mono text-slate-400">scripts/looker-studio-connector/</span>. Deploy
        your own copy as a Looker Studio community connector, or use a deployment ID provided by
        Monstera.
      </p>
    </div>
  );
}
