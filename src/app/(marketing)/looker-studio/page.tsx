import type { Metadata } from "next";
import Link from "next/link";
import { PRODUCT_SITE_URL } from "@/lib/site-url";
import { MarketingTrustSecuritySection } from "@/components/marketing/MarketingTrustSecuritySection";
import { ArrowRight, KeyRound, LineChart, Shield, BookOpen } from "lucide-react";

export const metadata: Metadata = {
  title: "Looker Studio connector",
  description:
    "Connect Monstera Cloud campaign metrics to Looker Studio with a workspace API key. Meta Ads, Google Ads, and TikTok Ads data.",
  alternates: { canonical: `${PRODUCT_SITE_URL}/looker-studio` },
};

export default function LookerStudioConnectorPage() {
  return (
    <>
    <div className="mx-auto max-w-3xl px-6 pt-28 pb-20 font-sans text-ink">
      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-line bg-panel text-ink-mute text-xs font-semibold uppercase tracking-wider mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
        <span>Looker Studio</span>
      </div>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
        Monstera Cloud connector
      </h1>
      <p className="mt-4 text-sm sm:text-base text-ink-mute leading-relaxed font-normal">
        This page describes the official Monstera Cloud community connector for{" "}
        <span className="text-ink font-medium">Looker Studio</span>. The connector reads campaign metrics
        already stored in your Monstera workspace (from Meta Ads, Google Ads, and TikTok for
        Business) and lets you build dashboards in Looker Studio using a{" "}
        <span className="text-ink font-medium">workspace API key</span>—no separate OAuth flow inside
        Looker.
      </p>

      <div className="mt-10 rounded-lg border border-line bg-panel p-6">
        <h2 className="text-base font-bold text-ink">Before you connect</h2>
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-xs text-ink-mute leading-relaxed">
          <li>
            <span className="font-semibold text-ink">Monstera account</span> —{" "}
            <Link href="/register" className="text-accent hover:underline">
              Create a free account
            </Link>{" "}
            or{" "}
            <Link href="/login" className="text-accent hover:underline">
              sign in
            </Link>
            .
          </li>
          <li>
            <span className="font-semibold text-ink">Ad platforms</span> — Connect Meta Ads,
            Google Ads, and/or TikTok for Business in the{" "}
            <Link href="/sources" className="text-accent hover:underline">
              Data Sources
            </Link>{" "}
            console and ensure data has synced so metrics exist in your workspace.
          </li>
          <li>
            <span className="font-semibold text-ink">API key</span> — In Monstera, open{" "}
            <Link href="/settings" className="text-accent hover:underline">
              Settings
            </Link>
            , create a workspace API key, and copy it. You will paste this key when Looker Studio
            prompts for credentials.
          </li>
        </ol>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="flex gap-3 rounded-lg border border-line bg-panel p-4">
          <KeyRound className="h-4 w-4 shrink-0 text-accent mt-0.5" aria-hidden />
          <div>
            <h3 className="text-xs font-bold text-ink">Authentication</h3>
            <p className="mt-1 text-[11px] text-ink-mute leading-normal">
              API key only. Keys are scoped to your workspace. Rotate or revoke keys from Settings
              at any time.
            </p>
          </div>
        </div>
        <div className="flex gap-3 rounded-lg border border-line bg-panel p-4">
          <LineChart className="h-4 w-4 shrink-0 text-accent mt-0.5" aria-hidden />
          <div>
            <h3 className="text-xs font-bold text-ink">Data in reports</h3>
            <p className="mt-1 text-[11px] text-ink-mute leading-normal">
              Looker Studio supplies a report date range; Monstera returns metrics only for those
              dates. Dimensions include date, platform, accounts, campaigns, and ad sets.
            </p>
          </div>
        </div>
        <div className="flex gap-3 rounded-lg border border-line bg-panel p-4">
          <Shield className="h-4 w-4 shrink-0 text-accent mt-0.5" aria-hidden />
          <div>
            <h3 className="text-xs font-bold text-ink">Network</h3>
            <p className="mt-1 text-[11px] text-ink-mute leading-normal">
              The connector calls Monstera only over HTTPS at{" "}
              <span className="font-mono text-ink">monsteracloud.com</span> via Looker Studio UrlFetchApp.
            </p>
          </div>
        </div>
        <div className="flex gap-3 rounded-lg border border-line bg-panel p-4">
          <BookOpen className="h-4 w-4 shrink-0 text-accent mt-0.5" aria-hidden />
          <div>
            <h3 className="text-xs font-bold text-ink">Support</h3>
            <p className="mt-1 text-[11px] text-ink-mute leading-normal">
              Questions or errors? See{" "}
              <Link href="/support" className="text-accent hover:underline">
                Support
              </Link>{" "}
              for troubleshooting and contact options.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-10 rounded-lg border border-line bg-panel p-6">
        <h2 className="text-sm font-bold text-ink">Legal</h2>
        <p className="mt-1 text-xs text-ink-mute">
          By using Monstera Cloud and this connector, you agree to our policies on this domain:
        </p>
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs">
          <li>
            <Link
              href="/legal/privacy-policy"
              className="inline-flex items-center gap-1 font-semibold text-accent hover:underline"
            >
              Privacy Policy
              <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          </li>
          <li>
            <Link
              href="/legal/terms-of-service"
              className="inline-flex items-center gap-1 font-semibold text-accent hover:underline"
            >
              Terms of Service
              <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          </li>
        </ul>
      </div>

      <p className="mt-10 text-[11px] text-ink-mute">
        Connector script for developers is maintained in the Monstera Cloud repository under{" "}
        <span className="font-mono text-ink">scripts/looker-studio-connector/</span>.
      </p>
    </div>
    <MarketingTrustSecuritySection />
    </>
  );
}
