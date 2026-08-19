import Link from "next/link";
import { Lock, Scale, Shield } from "lucide-react";

/**
 * Shared trust, security, and positioning strip for marketing pages (SEA-first, honest comparison).
 */
export function MarketingTrustSecuritySection() {
    return (
        <section className="border-b border-line px-4 py-20 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-5xl">
                <p className="mb-3 text-center font-mono text-[10px] uppercase tracking-widest text-ink-mute">Trust &amp; security</p>
                <h2 className="mb-4 text-center text-2xl font-semibold tracking-tight text-ink md:text-3xl">
                    Built for teams who outgrow manual spreadsheets
                </h2>
                <p className="mx-auto mb-10 max-w-2xl text-center text-sm leading-relaxed text-slate-500">
                    Monstera is not a generic spreadsheet — it is a connector workspace with OAuth to your ad platforms, encrypted credentials, and
                    optional delivery to Google Sheets™ or Looker Studio™. You keep ownership of your Google accounts and ad logins.
                </p>
                <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-lg border border-line bg-panel p-6">
                        <Shield className="mb-3 h-6 w-6 text-ink" strokeWidth={1.5} aria-hidden />
                        <h3 className="mb-2 text-sm font-semibold text-ink">OAuth &amp; encryption</h3>
                        <p className="text-xs leading-relaxed text-slate-500">
                            Platform sign-in uses each vendor&apos;s OAuth. Tokens and keys are encrypted at rest. Traffic uses modern TLS. See our{" "}
                            <Link href="/legal/privacy-policy" className="text-ink underline">
                                Privacy Policy
                            </Link>
                            .
                        </p>
                    </div>
                    <div className="rounded-lg border border-line bg-panel p-6">
                        <Lock className="mb-3 h-6 w-6 text-ink" strokeWidth={1.5} aria-hidden />
                        <h3 className="mb-2 text-sm font-semibold text-ink">What we don&apos;t do</h3>
                        <p className="text-xs leading-relaxed text-slate-500">
                            We don&apos;t sell your ad data. Sheets access is scoped to spreadsheets Monstera creates unless you choose otherwise in
                            your pipeline settings. Infrastructure is hosted with a Singapore-region posture for SEA latency.
                        </p>
                    </div>
                    <div className="rounded-lg border border-line bg-panel p-6">
                        <Scale className="mb-3 h-6 w-6 text-ink" strokeWidth={1.5} aria-hidden />
                        <h3 className="mb-2 text-sm font-semibold text-ink">Vs DIY exports</h3>
                        <p className="text-xs leading-relaxed text-slate-500">
                            Manual CSVs and one-off scripts break when APIs change. Monstera normalises metrics across TikTok, Meta, Shopee, and Google
                            Ads so your team spends time on decisions — not glue code.
                        </p>
                    </div>
                </div>
                <p className="mt-8 text-center text-xs text-slate-400">
                    Serving sellers and agencies in{" "}
                    <span className="font-semibold text-slate-600">Singapore, Malaysia, Indonesia, Vietnam, Thailand</span> — pricing in USD and VND
                    where available.
                </p>
            </div>
        </section>
    );
}
