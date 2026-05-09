"use client";

import Link from "next/link";
import { Building2, Layers, LineChart } from "lucide-react";

type Creds = Record<string, unknown>;

function parseCreds(raw: string | undefined): Creds | null {
    if (!raw || typeof raw !== "string") return null;
    try {
        return JSON.parse(raw) as Creds;
    } catch {
        return null;
    }
}

/**
 * Shows which ad accounts / customers / advertisers OAuth attached to this connection.
 * Per-account pulls for Looker Studio add-on / API are configured in those tools;
 * this panel answers “what did I connect?” after OAuth.
 */
export function AccountScopePanel({
    provider,
    credentialsJson,
}: {
    provider: string;
    credentialsJson?: string;
}) {
    const c = parseCreds(credentialsJson);
    if (!c) return null;

    if (provider === "meta_ads") {
        const accounts = (c.adAccounts as Array<{ id: string; name?: string; currency?: string }> | undefined) ?? [];
        const ids = (c.adAccountIds as string[] | undefined) ?? [];
        const rows =
            accounts.length > 0
                ? accounts
                : ids.map((id) => ({ id, name: `act_${String(id).replace(/^act_/, "")}` }));

        return (
            <section className="mb-10 rounded-2xl border border-gray-200/80 bg-white/80 p-6 dark:border-[#2f3336]/60 dark:bg-[#000000]/50">
                <div className="mb-4 flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1877F2]/15 text-[#1877F2]">
                        <Building2 className="h-5 w-5" aria-hidden />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Meta ad accounts (this connection)</h2>
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                            OAuth granted Monstera access to the Business Manager ad accounts below. Sync and workspace metrics use
                            this scope; to <strong>query one specific account</strong> in Looker Studio or exports, pick the
                            account inside the report or add-on.
                        </p>
                    </div>
                </div>
                {rows.length === 0 ? (
                    <p className="text-sm text-amber-700 dark:text-amber-300">No ad accounts were returned — try reconnecting.</p>
                ) : (
                    <ul className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50/80 p-3 text-sm dark:border-[#2f3336] dark:bg-[#16181c]/50">
                        {rows.map((a) => (
                            <li
                                key={a.id}
                                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100/80 pb-2 last:border-0 last:pb-0 dark:border-[#2f3336]/80"
                            >
                                <span className="font-medium text-gray-900 dark:text-white">{a.name ?? a.id}</span>
                                <code className="text-xs text-gray-500 dark:text-gray-400">
                                    act_{String(a.id).replace(/^act_/, "")}
                                </code>
                            </li>
                        ))}
                    </ul>
                )}
                <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                    Need to change which accounts are used for reporting? Use{" "}
                    <Link href="/meta-ads" className="font-semibold text-cyan-700 underline hover:no-underline dark:text-cyan-300">
                        Meta Ads tools
                    </Link>{" "}
                    <LineChart className="inline h-3.5 w-3.5 align-text-bottom opacity-70" aria-hidden /> — the sidebar only switches{" "}
                    <strong>workspace</strong>, not individual ad accounts.
                </p>
            </section>
        );
    }

    if (provider === "google_ads") {
        const customerIds = (c.customerIds as string[] | undefined) ?? [];
        const mccId = (c.mccId as string | undefined)?.trim();

        return (
            <section className="mb-10 rounded-2xl border border-gray-200/80 bg-white/80 p-6 dark:border-[#2f3336]/60 dark:bg-[#000000]/50">
                <div className="mb-4 flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-800 dark:bg-[#16181c] dark:text-slate-100">
                        <Layers className="h-5 w-5" aria-hidden />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Google Ads customers (this connection)</h2>
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                            These are the <strong>accessible customer IDs</strong> from the Google account you used in OAuth
                            (often an MCC user with child accounts). Reporting and sync aggregate from this set.
                        </p>
                    </div>
                </div>
                {mccId ? (
                    <p className="mb-3 text-xs font-medium text-gray-600 dark:text-gray-300">
                        Manager (MCC) hint: <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-[#16181c]">{mccId}</code>
                    </p>
                ) : null}
                {customerIds.length === 0 ? (
                    <p className="text-sm text-amber-700 dark:text-amber-300">No customer IDs listed yet — try reconnecting.</p>
                ) : (
                    <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50/80 p-3 font-mono text-xs text-gray-800 dark:border-[#2f3336] dark:bg-[#16181c]/50 dark:text-gray-200">
                        {customerIds.map((id) => (
                            <li key={id}>{id}</li>
                        ))}
                    </ul>
                )}
                <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                    Pick a specific customer for API / reports in{" "}
                    <Link
                        href="/google-ads"
                        className="font-semibold text-cyan-700 underline hover:no-underline dark:text-cyan-300"
                    >
                        Google Ads tools
                    </Link>
                    . The sidebar switches <strong>workspace</strong> only.
                </p>
            </section>
        );
    }

    if (provider === "tiktok_business") {
        const advertiserIds = (c.advertiserIds as string[] | undefined) ?? [];

        return (
            <section className="mb-10 rounded-2xl border border-gray-200/80 bg-white/80 p-6 dark:border-[#2f3336]/60 dark:bg-[#000000]/50">
                <div className="mb-4 flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900/10 text-slate-900 dark:bg-white/10 dark:text-white">
                        <Layers className="h-5 w-5" aria-hidden />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">TikTok advertisers (this connection)</h2>
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                            Advertiser IDs returned for your TikTok Marketing API login. Use{" "}
                            <strong>TikTok Ads tools</strong> to choose which advertiser to query in depth.
                        </p>
                    </div>
                </div>
                {advertiserIds.length === 0 ? (
                    <p className="text-sm text-amber-700 dark:text-amber-300">No advertiser IDs on file — try reconnecting.</p>
                ) : (
                    <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50/80 p-3 font-mono text-xs text-gray-800 dark:border-[#2f3336] dark:bg-[#16181c]/50 dark:text-gray-200">
                        {advertiserIds.map((id) => (
                            <li key={id}>{id}</li>
                        ))}
                    </ul>
                )}
                <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                    <Link href="/tiktok-ads" className="font-semibold text-cyan-700 underline hover:no-underline dark:text-cyan-300">
                        TikTok Ads tools
                    </Link>{" "}
                    — per-advertiser reporting; sidebar = workspace only.
                </p>
            </section>
        );
    }

    return null;
}
