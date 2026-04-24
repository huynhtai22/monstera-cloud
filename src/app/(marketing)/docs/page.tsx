import React from 'react';
import { ArrowRight, CheckCircle2, ShieldAlert, Cpu, Network, Lock, Database, LineChart } from 'lucide-react';
import Link from 'next/link';

export default function DocsPage() {
    return (
        <div className="max-w-4xl font-sans pb-32">

            {/* ==================== INTRODUCTION ==================== */}
            <div className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold text-gray-400 border border-white/10 bg-white/5 tracking-widest uppercase mb-6">
                Getting Started
            </div>

            <h1 id="introduction" className="text-4xl md:text-5xl font-extrabold text-white tracking-tighter mb-6 pt-16 -mt-16">
                Introduction to Monstera
            </h1>

            <p className="text-lg text-gray-400 leading-relaxed mb-10">
                Monstera Cloud connects your ad platforms — Meta Ads, Google Ads, and TikTok for Business — into a single workspace,
                then lets you visualize that data in{" "}
                <strong className="text-white">Google Sheets™</strong> or <strong className="text-white">Looker Studio™</strong>.
                Sign up, connect your ad accounts via OAuth, create a workspace API key, and start building reports.
            </p>

            <div className="grid sm:grid-cols-2 gap-6 mb-16">
                <div className="bg-cyan-950/20 border border-cyan-500/20 rounded-xl p-6">
                    <CheckCircle2 className="w-6 h-6 text-cyan-500 mb-4" />
                    <h3 className="text-white font-bold mb-2">Automated Syncs</h3>
                    <p className="text-sm text-gray-400">Sync jobs run on a schedule, respect platform rate limits, and retry on failure — data lands in your Sheets or Looker reports automatically.</p>
                </div>
                <div className="bg-amber-950/20 border border-amber-500/20 rounded-xl p-6">
                    <ShieldAlert className="w-6 h-6 text-amber-500 mb-4" />
                    <h3 className="text-white font-bold mb-2">Sync Logs</h3>
                    <p className="text-sm text-gray-400">Every pipeline run is logged — success, failure, and row counts. Replay or re-sync any pipeline directly from the console.</p>
                </div>
            </div>

            <hr className="border-white/5 my-12" />

            {/* ==================== QUICKSTART ==================== */}
            <h2 id="quickstart" className="text-3xl font-extrabold text-white tracking-tight mb-6 pt-24 -mt-24">
                Quickstart
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                Get from zero to a live Looker Studio report in four steps:
            </p>

            <ol className="space-y-4 mb-16 text-gray-300 text-sm leading-relaxed">
                <li className="flex items-start gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold flex items-center justify-center mt-0.5">1</span>
                    <span><strong className="text-white">Create a workspace</strong> — sign up at <span className="font-mono text-slate-300">monsteracloud.com/register</span>.</span>
                </li>
                <li className="flex items-start gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold flex items-center justify-center mt-0.5">2</span>
                    <span><strong className="text-white">Connect ad platforms</strong> — go to Data Sources and connect Meta Ads, Google Ads, and/or TikTok for Business via OAuth. Trigger a manual sync to pull historical data.</span>
                </li>
                <li className="flex items-start gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold flex items-center justify-center mt-0.5">3</span>
                    <span><strong className="text-white">Create an API key</strong> — open Settings → API Keys, generate a workspace key, and copy it.</span>
                </li>
                <li className="flex items-start gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold flex items-center justify-center mt-0.5">4</span>
                    <span><strong className="text-white">Add the Looker Studio connector</strong> — in Looker Studio, add the Monstera community connector and paste your API key when prompted. Pick a date range and start building.</span>
                </li>
            </ol>

            <hr className="border-white/5 my-12" />

            {/* ==================== ARCHITECTURE ==================== */}
            <h2 id="architecture" className="text-3xl font-extrabold text-white tracking-tight mb-6 pt-24 -mt-24 flex items-center">
                <Cpu className="w-7 h-7 mr-3 text-cyan-500" /> Architecture
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                Each workspace keeps its own source connections, API keys, and sync history. Pipelines pull normalized metrics
                from your connected ad platforms and serve them to Looker Studio or Google Sheets via the workspace API.
                Credentials are encrypted at rest and scoped per workspace.
            </p>
            <ul className="space-y-4 mb-16 text-gray-300">
                <li className="flex items-start">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 mt-2 mr-3 shrink-0"></div>
                    <p><strong className="text-white">Workspace isolation:</strong> Sources, API keys, and sync logs are scoped per workspace. Members only see data for their workspace.</p>
                </li>
                <li className="flex items-start">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 mt-2 mr-3 shrink-0"></div>
                    <p><strong className="text-white">Sync logs:</strong> Manual and scheduled runs record success, failure, and row counts in the console so you can trace any delivery issue.</p>
                </li>
                <li className="flex items-start">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 mt-2 mr-3 shrink-0"></div>
                    <p><strong className="text-white">Rate limits:</strong> Connectors back off automatically when upstream ad platforms return <code className="text-cyan-200">429</code> responses.</p>
                </li>
            </ul>

            <hr className="border-white/5 my-12" />

            {/* ==================== SUPPORTED SOURCES ==================== */}
            <h2 id="sources" className="text-3xl font-extrabold text-white tracking-tight mb-6 pt-24 -mt-24">
                Supported Ad Platforms
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                Connect these platforms via OAuth in the Data Sources console:
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-16">
                <div className="p-4 border border-white/10 rounded-lg bg-white/5 text-center text-sm font-bold text-white uppercase tracking-wider">Meta Ads</div>
                <div className="p-4 border border-white/10 rounded-lg bg-white/5 text-center text-sm font-bold text-white uppercase tracking-wider">Google Ads</div>
                <div className="p-4 border border-white/10 rounded-lg bg-white/5 text-center text-sm font-bold text-white uppercase tracking-wider">TikTok for Business</div>
            </div>

            <hr className="border-white/5 my-12" />

            {/* ==================== DESTINATIONS ==================== */}
            <h2 id="destinations" className="text-3xl font-extrabold text-white tracking-tight mb-6 pt-24 -mt-24 flex items-center">
                <Database className="w-7 h-7 mr-3 text-blue-500" /> Destinations
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                After connecting your ad accounts, send your data to:
            </p>
            <p className="text-white font-mono text-sm bg-white/5 p-4 rounded-lg border border-white/10 mb-16 inline-block">
                Google Sheets™ · Looker Studio™ (via workspace API key)
            </p>

            <hr className="border-white/5 my-12" />

            {/* ==================== LOOKER STUDIO ==================== */}
            <h2 id="looker-studio" className="text-3xl font-extrabold text-white tracking-tight mb-6 pt-24 -mt-24 flex items-center">
                <LineChart className="w-7 h-7 mr-3 text-emerald-500" /> Looker Studio connector
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                The Monstera community connector for Looker Studio reads campaign metrics already stored in your workspace
                (from Meta Ads, Google Ads, and TikTok for Business) using a{" "}
                <strong className="text-white">workspace API key</strong>. No separate OAuth flow inside Looker.
            </p>
            <ul className="space-y-3 mb-8 text-gray-300 text-sm leading-relaxed">
                <li className="flex items-start">
                    <span className="mr-2 text-cyan-500 font-bold">1.</span>
                    <span>Connect ad platforms and run at least one sync so metrics exist in your workspace.</span>
                </li>
                <li className="flex items-start">
                    <span className="mr-2 text-cyan-500 font-bold">2.</span>
                    <span>In Monstera, open Settings → API Keys, create a key, and copy it.</span>
                </li>
                <li className="flex items-start">
                    <span className="mr-2 text-cyan-500 font-bold">3.</span>
                    <span>In Looker Studio, add the Monstera connector and paste your API key when prompted.</span>
                </li>
            </ul>
            <p className="mb-16">
                <Link
                    href="/looker-studio"
                    className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/20 hover:border-cyan-500/50 transition-colors"
                >
                    Open full Looker Studio guide
                    <ArrowRight className="h-4 w-4" />
                </Link>
            </p>

            <hr className="border-white/5 my-12" />

            {/* ==================== PIPELINES ==================== */}
            <h2 id="pipelines" className="text-3xl font-extrabold text-white tracking-tight mb-6 pt-24 -mt-24 flex items-center">
                <Network className="w-7 h-7 mr-3 text-purple-500" /> Pipelines
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                A pipeline maps one ad platform connection to a destination (Looker Studio or Google Sheets). You can
                trigger syncs manually or set them on a schedule. Each run logs the number of rows fetched, any errors,
                and the completion time.
            </p>

            <hr className="border-white/5 my-12" />

            {/* ==================== WORKSPACES ==================== */}
            <h2 id="workspaces" className="text-3xl font-extrabold text-white tracking-tight mb-6 pt-24 -mt-24">
                Workspaces
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                A workspace is your team&apos;s isolated environment. All sources, API keys, pipeline runs, and sync logs
                are scoped to the workspace. Use the workspace API key to authenticate the Looker Studio connector or the
                Google Sheets add-on.
            </p>

            <hr className="border-white/5 my-12" />

            {/* ==================== AUTHENTICATION ==================== */}
            <h2 id="authentication" className="text-3xl font-extrabold text-white tracking-tight mb-6 pt-24 -mt-24 flex items-center">
                <Lock className="w-7 h-7 mr-3 text-amber-500" /> API Authentication
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                The Looker Studio connector and Google Sheets add-on authenticate using a workspace API key passed as a
                Bearer token. Generate and revoke keys from Settings → API Keys at any time.
            </p>
            <div className="bg-[#18181b] border border-white/10 rounded-xl overflow-hidden mb-16">
                <div className="bg-[#09090b] px-4 py-3 border-b border-white/5">
                    <span className="text-xs font-mono text-gray-500">Authorization header</span>
                </div>
                <div className="p-6">
                    <pre className="text-sm text-gray-300 font-mono leading-relaxed">
                        <code>Authorization: Bearer YOUR_WORKSPACE_API_KEY</code>
                    </pre>
                </div>
            </div>

            {/* Bottom Nav */}
            <div className="mt-24 p-8 bg-gradient-to-r from-cyan-950/20 to-transparent border border-cyan-500/20 rounded-xl flex items-center justify-between">
                <div>
                    <h4 className="text-white font-bold mb-1">Ready to connect?</h4>
                    <p className="text-sm text-gray-400">Create your workspace and connect your first ad platform.</p>
                </div>
                <Link href="/register" className="px-6 py-3 bg-white text-black text-sm font-bold rounded hover:bg-gray-200 transition-colors">
                    Get started
                </Link>
            </div>

        </div>
    );
}
