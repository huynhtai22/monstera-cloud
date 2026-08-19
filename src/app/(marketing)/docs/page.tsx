import React from 'react';
import { ArrowRight, CheckCircle2, ShieldAlert, Cpu, Network, Lock, Database, LineChart } from 'lucide-react';
import Link from 'next/link';

export default function DocsPage() {
    return (
        <div className="max-w-4xl font-sans pb-32 text-ink">

            {/* ==================== INTRODUCTION ==================== */}
            <div className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-ink-mute border border-line bg-panel uppercase tracking-wider mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
                <span>Getting Started</span>
            </div>

            <h1 id="introduction" className="text-3xl sm:text-4xl md:text-5xl font-bold text-ink tracking-tight mb-6 pt-16 -mt-16">
                Introduction to Monstera
            </h1>

            <p className="text-sm sm:text-base text-ink-mute leading-relaxed mb-10 font-normal">
                Monstera Cloud connects your ad platforms — Meta Ads, Google Ads, and TikTok for Business — into a single workspace,
                then lets you visualize that data in{" "}
                <strong className="text-ink font-semibold">Google Sheets™</strong> or <strong className="text-ink font-semibold">Looker Studio™</strong>.
                Accept an agency invitation, connect your ad accounts via OAuth, verify the warehouse import, and start building reports.
            </p>

            <div className="grid sm:grid-cols-2 gap-4 mb-16">
                <div className="bg-panel border border-line rounded-lg p-5">
                    <CheckCircle2 className="w-5 h-5 text-accent mb-3" />
                    <h3 className="text-ink font-semibold text-sm mb-1.5">Warehouse refresh</h3>
                    <p className="text-xs text-ink-mute leading-relaxed">Run a manual refresh whenever needed. Pilot workspaces also receive one nightly warehouse refresh.</p>
                </div>
                <div className="bg-panel border border-line rounded-lg p-5">
                    <ShieldAlert className="w-5 h-5 text-accent mb-3" />
                    <h3 className="text-ink font-semibold text-sm mb-1.5">Sync activity</h3>
                    <p className="text-xs text-ink-mute leading-relaxed">Import status, row counts, freshness, errors, and recovery actions remain visible to agency staff.</p>
                </div>
            </div>

            <hr className="border-line my-12" />

            {/* ==================== QUICKSTART ==================== */}
            <h2 id="quickstart" className="text-2xl sm:text-3xl font-bold text-ink tracking-tight mb-6 pt-24 -mt-24">
                Quickstart
            </h2>
            <p className="text-sm text-ink-mute leading-relaxed mb-6 font-normal">
                Get from zero to a live Looker Studio report in four steps:
            </p>

            <ol className="space-y-4 mb-16 text-ink-mute text-xs sm:text-sm leading-relaxed">
                <li className="flex items-start gap-3">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-panel border border-line text-accent text-xs font-semibold flex items-center justify-center mt-0.5">1</span>
                    <span><strong className="text-ink">Accept an invitation</strong> — your pilot operator or agency owner sends an email-bound invitation.</span>
                </li>
                <li className="flex items-start gap-3">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-panel border border-line text-accent text-xs font-semibold flex items-center justify-center mt-0.5">2</span>
                    <span><strong className="text-ink">Connect ad platforms</strong> — go to Data Sources and connect Meta Ads, Google Ads, and/or TikTok for Business via OAuth. Trigger a manual sync to pull historical data.</span>
                </li>
                <li className="flex items-start gap-3">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-panel border border-line text-accent text-xs font-semibold flex items-center justify-center mt-0.5">3</span>
                    <span><strong className="text-ink">Create an API key</strong> — open Settings → API Keys, generate a workspace key, and copy it.</span>
                </li>
                <li className="flex items-start gap-3">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-panel border border-line text-accent text-xs font-semibold flex items-center justify-center mt-0.5">4</span>
                    <span><strong className="text-ink">Add the Looker Studio connector</strong> — in Looker Studio, add the Monstera community connector and paste your API key when prompted. Pick a date range and start building.</span>
                </li>
            </ol>

            <hr className="border-line my-12" />

            {/* ==================== ARCHITECTURE ==================== */}
            <h2 id="architecture" className="text-2xl sm:text-3xl font-bold text-ink tracking-tight mb-6 pt-24 -mt-24 flex items-center">
                <Cpu className="w-6 h-6 mr-3 text-accent" /> Architecture
            </h2>
            <p className="text-sm text-ink-mute leading-relaxed mb-6 font-normal">
                Each workspace keeps its own source connections, API keys, normalized warehouse metrics, and sync history. Warehouse queries
                serve those stored metrics to Data Explorer, Looker Studio, and Google Sheets through workspace-scoped authorization.
                Credentials are encrypted at rest and scoped per workspace.
            </p>
            <ul className="space-y-3 mb-16 text-xs sm:text-sm text-ink-mute">
                <li className="flex items-start">
                    <div className="w-1.5 h-1.5 rounded-full bg-accent mt-2 mr-3 shrink-0"></div>
                    <p><strong className="text-ink">Workspace isolation:</strong> Sources, API keys, and sync logs are scoped per workspace. Members only see data for their workspace.</p>
                </li>
                <li className="flex items-start">
                    <div className="w-1.5 h-1.5 rounded-full bg-accent mt-2 mr-3 shrink-0"></div>
                    <p><strong className="text-ink">Sync activity:</strong> Manual and nightly warehouse runs record success, failure, and row counts so agency staff can trace import issues.</p>
                </li>
                <li className="flex items-start">
                    <div className="w-1.5 h-1.5 rounded-full bg-accent mt-2 mr-3 shrink-0"></div>
                    <p><strong className="text-ink">Rate limits:</strong> Connectors back off automatically when upstream ad platforms return <code className="text-accent">429</code> responses.</p>
                </li>
            </ul>

            <hr className="border-line my-12" />

            {/* ==================== SUPPORTED SOURCES ==================== */}
            <h2 id="sources" className="text-2xl sm:text-3xl font-bold text-ink tracking-tight mb-6 pt-24 -mt-24">
                Supported Ad Platforms
            </h2>
            <p className="text-sm text-ink-mute leading-relaxed mb-6">
                Connect these platforms via OAuth in the Data Sources console:
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-16">
                <div className="p-4 border border-line rounded-lg bg-panel text-center text-xs font-semibold text-ink uppercase tracking-wider">Meta Ads</div>
                <div className="p-4 border border-line rounded-lg bg-panel text-center text-xs font-semibold text-ink uppercase tracking-wider">Google Ads</div>
                <div className="p-4 border border-line rounded-lg bg-panel text-center text-xs font-semibold text-ink uppercase tracking-wider">TikTok for Business</div>
            </div>

            <hr className="border-line my-12" />

            {/* ==================== DESTINATIONS ==================== */}
            <h2 id="destinations" className="text-2xl sm:text-3xl font-bold text-ink tracking-tight mb-6 pt-24 -mt-24 flex items-center">
                <Database className="w-6 h-6 mr-3 text-accent" /> Destinations
            </h2>
            <p className="text-sm text-ink-mute leading-relaxed mb-4">
                After importing your ad accounts, query the workspace warehouse from:
            </p>
            <div className="text-ink font-mono text-xs bg-panel p-4 rounded-lg border border-line mb-16 inline-block">
                Google Sheets™ · Looker Studio™ (via workspace API key)
            </div>

            <hr className="border-line my-12" />

            {/* ==================== LOOKER STUDIO ==================== */}
            <h2 id="looker-studio" className="text-2xl sm:text-3xl font-bold text-ink tracking-tight mb-6 pt-24 -mt-24 flex items-center">
                <LineChart className="w-6 h-6 mr-3 text-accent" /> Looker Studio connector
            </h2>
            <p className="text-sm text-ink-mute leading-relaxed mb-6">
                The Monstera community connector for Looker Studio reads campaign metrics already stored in your workspace
                (from Meta Ads, Google Ads, and TikTok for Business) using a{" "}
                <strong className="text-ink font-medium">workspace API key</strong>. No separate OAuth flow inside Looker.
            </p>
            <ul className="space-y-2 mb-8 text-ink-mute text-xs sm:text-sm leading-relaxed">
                <li className="flex items-start">
                    <span className="mr-2 text-accent font-bold">1.</span>
                    <span>Connect ad platforms and run at least one sync so metrics exist in your workspace.</span>
                </li>
                <li className="flex items-start">
                    <span className="mr-2 text-accent font-bold">2.</span>
                    <span>In Monstera, open Settings → API Keys, create a key, and copy it.</span>
                </li>
                <li className="flex items-start">
                    <span className="mr-2 text-accent font-bold">3.</span>
                    <span>In Looker Studio, add the Monstera connector and paste your API key when prompted.</span>
                </li>
            </ul>
            <p className="mb-16">
                <Link
                    href="/looker-studio"
                    className="inline-flex items-center gap-2 rounded-md border border-line bg-panel hover:bg-[#16181c] px-4 py-2 text-xs font-semibold text-ink transition-colors"
                >
                    Open full Looker Studio guide
                    <ArrowRight className="h-3.5 w-3.5" />
                </Link>
            </p>

            <hr className="border-line my-12" />

            {/* ==================== PIPELINES ==================== */}
            <h2 id="pipelines" className="text-2xl sm:text-3xl font-bold text-ink tracking-tight mb-6 pt-24 -mt-24 flex items-center">
                <Network className="w-6 h-6 mr-3 text-accent" /> Pipelines
            </h2>
            <p className="text-sm text-ink-mute leading-relaxed mb-6">
                A pipeline maps one ad platform connection to a destination (Looker Studio or Google Sheets). You can
                trigger syncs manually or set them on a schedule. Each run logs the number of rows fetched, any errors,
                and the completion time.
            </p>

            <hr className="border-line my-12" />

            {/* ==================== WORKSPACES ==================== */}
            <h2 id="workspaces" className="text-2xl sm:text-3xl font-bold text-ink tracking-tight mb-6 pt-24 -mt-24">
                Workspaces
            </h2>
            <p className="text-sm text-ink-mute leading-relaxed mb-6">
                A workspace is your team&apos;s isolated environment. All sources, API keys, pipeline runs, and sync logs
                are scoped to the workspace. Use the workspace API key to authenticate the Looker Studio connector or the
                Google Sheets add-on.
            </p>

            <hr className="border-line my-12" />

            {/* ==================== AUTHENTICATION ==================== */}
            <h2 id="authentication" className="text-2xl sm:text-3xl font-bold text-ink tracking-tight mb-6 pt-24 -mt-24 flex items-center">
                <Lock className="w-6 h-6 mr-3 text-accent" /> API Authentication
            </h2>
            <p className="text-sm text-ink-mute leading-relaxed mb-6">
                The Looker Studio connector and Google Sheets add-on authenticate using a workspace API key passed as a
                Bearer token. Generate and revoke keys from Settings → API Keys at any time.
            </p>
            <div className="bg-panel border border-line rounded-lg overflow-hidden mb-16">
                <div className="bg-canvas px-4 py-2.5 border-b border-line">
                    <span className="text-[11px] font-mono text-ink-mute">Authorization header</span>
                </div>
                <div className="p-4">
                    <pre className="text-xs text-ink font-mono leading-relaxed">
                        <code>Authorization: Bearer YOUR_WORKSPACE_API_KEY</code>
                    </pre>
                </div>
            </div>

            {/* Bottom Nav */}
            <div className="mt-20 p-6 border border-line rounded-lg bg-panel flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h4 className="text-ink font-bold text-sm mb-1">Ready to connect?</h4>
                    <p className="text-xs text-ink-mute">Create your workspace and connect your first ad platform.</p>
                </div>
                <Link href="/register" className="inline-flex items-center justify-center px-5 py-2.5 bg-white text-black hover:bg-neutral-200 text-xs font-semibold rounded-md transition-colors shadow-xs">
                    Get started
                </Link>
            </div>

        </div>
    );
}
