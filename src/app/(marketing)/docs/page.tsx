import React from 'react';
import { ArrowRight, CheckCircle2, ShieldAlert, Cpu, Network, Lock, Zap, FileJson, Database, LineChart } from 'lucide-react';
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
                Monstera Cloud is a live product: you sign in, create a workspace, connect marketplace and ad sources with OAuth, connect{" "}
                <strong className="text-white">Google Sheets™</strong> or <strong className="text-white">Looker Studio™</strong> as destinations, and run pipelines on a schedule. This page summarizes how that shipped stack fits together — not a future roadmap.
            </p>

            <div className="grid sm:grid-cols-2 gap-6 mb-16">
                <div className="bg-cyan-950/20 border border-cyan-500/20 rounded-xl p-6">
                    <CheckCircle2 className="w-6 h-6 text-cyan-500 mb-4" />
                    <h3 className="text-white font-bold mb-2">Zero Maintenance</h3>
                    <p className="text-sm text-gray-400">Sync jobs respect platform rate limits and retries; data lands in your connected spreadsheet or Looker-backed reports.</p>
                </div>
                <div className="bg-amber-950/20 border border-amber-500/20 rounded-xl p-6">
                    <ShieldAlert className="w-6 h-6 text-amber-500 mb-4" />
                    <h3 className="text-white font-bold mb-2">Immutable Logs</h3>
                    <p className="text-sm text-gray-400">Every byte of data synced is cryptographically signed and logged. Replay failed webhooks unconditionally from your console.</p>
                </div>
            </div>

            <hr className="border-white/5 my-12" />

            {/* ==================== QUICKSTART ==================== */}
            <h2 id="quickstart" className="text-3xl font-extrabold text-white tracking-tight mb-6 pt-24 -mt-24">
                Quickstart Default Configuration
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                To route data autonomously, initialize your Tenant Workspace via the standard REST protocol. This provisions your dedicated ingestion workers.
            </p>

            <div className="bg-[#18181b] border border-white/10 rounded-xl overflow-hidden mb-16">
                <div className="bg-[#09090b] px-4 py-3 border-b border-white/5 flex items-center space-x-2">
                    <div className="w-3 h-3 rounded-full bg-cyan-500/20"></div>
                    <span className="ml-4 text-xs font-mono text-gray-500">cURL - Initialize Node</span>
                </div>
                <div className="p-6 overflow-x-auto">
                    <pre className="text-sm text-gray-300 font-mono leading-relaxed">
                        <code dangerouslySetInnerHTML={{ __html: `curl -X POST https://api.monsteracloud.com/v1/workspaces/init \\
<br/>  -H "Authorization: Bearer mnt_live_YOUR_API_KEY" \\<br/>  -d '{<br/>    "tenant_id": "org_production",<br/>    "region": "ap-southeast-1"<br/>  }'` }} />
                    </pre>
                </div>
            </div>

            <hr className="border-white/5 my-12" />

            {/* ==================== ARCHITECTURE ==================== */}
            <h2 id="architecture" className="text-3xl font-extrabold text-white tracking-tight mb-6 pt-24 -mt-24 flex items-center">
                <Cpu className="w-7 h-7 mr-3 text-cyan-500" /> Architecture
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                Each customer workspace keeps its own source and destination connections. Pipelines move normalized rows from a source (e.g. Shopee orders) into the destination you connected (Sheets or Looker API consumption). Credentials are encrypted at rest.
            </p>
            <ul className="space-y-4 mb-16 text-gray-300">
                <li className="flex items-start">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 mt-2 mr-3 shrink-0"></div>
                    <p><strong className="text-white">Workspace isolation:</strong> Sources, destinations, and pipelines are scoped per workspace and member access.</p>
                </li>
                <li className="flex items-start">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 mt-2 mr-3 shrink-0"></div>
                    <p><strong className="text-white">Sync logs:</strong> Manual and scheduled runs record success and failure in the app so you can trace delivery issues.</p>
                </li>
                <li className="flex items-start">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 mt-2 mr-3 shrink-0"></div>
                    <p><strong className="text-white">Rate limits:</strong> Connectors back off when upstream APIs return <code className="text-cyan-200">429</code> responses.</p>
                </li>
            </ul>

            <hr className="border-white/5 my-12" />

            {/* ==================== SUPPORTED SOURCES ==================== */}
            <h2 id="sources" className="text-3xl font-extrabold text-white tracking-tight mb-6 pt-24 -mt-24">
                Supported Sources
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                We officially maintain native connectors for high-velocity APAC operators:
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-16">
                <div className="p-4 border border-white/10 rounded-lg bg-white/5 text-center text-sm font-bold text-white uppercase tracking-wider">Shopee V2</div>
                <div className="p-4 border border-white/10 rounded-lg bg-white/5 text-center text-sm font-bold text-white uppercase tracking-wider">Xendit</div>
                <div className="p-4 border border-white/10 rounded-lg bg-white/5 text-center text-sm font-bold text-white uppercase tracking-wider">Lazada</div>
                <div className="p-4 border border-white/10 rounded-lg bg-white/5 text-center text-sm font-bold text-white uppercase tracking-wider">TikTok Shop</div>
                <div className="p-4 border border-white/10 rounded-lg bg-[#18181b] text-center text-sm font-bold text-gray-500 uppercase tracking-wider border-dashed">Shopify (Beta)</div>
            </div>

            <hr className="border-white/5 my-12" />

            {/* ==================== DESTINATIONS ==================== */}
            <h2 id="destinations" className="text-3xl font-extrabold text-white tracking-tight mb-6 pt-24 -mt-24 flex items-center">
                <Database className="w-7 h-7 mr-3 text-blue-500" /> Destinations
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                In production today, destinations are consumer surfaces your team already uses:
            </p>
            <p className="text-white font-mono text-sm bg-white/5 p-4 rounded-lg border border-white/10 mb-16 inline-block">
                Google Sheets™ · Looker Studio™ (workspace API key) · Slack alerts (where enabled)
            </p>

            <hr className="border-white/5 my-12" />

            {/* ==================== LOOKER STUDIO ==================== */}
            <h2 id="looker-studio" className="text-3xl font-extrabold text-white tracking-tight mb-6 pt-24 -mt-24 flex items-center">
                <LineChart className="w-7 h-7 mr-3 text-emerald-500" /> Looker Studio connector
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                After you connect ad platforms in the console and sync metrics into your workspace, you can visualize them in{" "}
                <strong className="text-white">Looker Studio</strong> using the Monstera community connector and a{" "}
                <strong className="text-white">workspace API key</strong> (from Settings in the app). Looker Studio calls Monstera&apos;s API — no extra OAuth inside Looker.
            </p>
            <ul className="space-y-3 mb-8 text-gray-300 text-sm leading-relaxed">
                <li className="flex items-start">
                    <span className="mr-2 text-cyan-500 font-bold">1.</span>
                    <span>Create sources and run at least one sync so campaign metrics exist in your workspace.</span>
                </li>
                <li className="flex items-start">
                    <span className="mr-2 text-cyan-500 font-bold">2.</span>
                    <span>In Monstera, open Settings → API keys, create a key, and copy it for the connector credential prompt.</span>
                </li>
                <li className="flex items-start">
                    <span className="mr-2 text-cyan-500 font-bold">3.</span>
                    <span>In Looker Studio, add a data source, choose the Monstera connector, and paste your API key and workspace details as documented on the full guide.</span>
                </li>
            </ul>
            <p className="mb-6">
                <Link
                    href="/looker-studio"
                    className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/20 hover:border-cyan-500/50 transition-colors"
                >
                    Open full Looker Studio guide
                    <ArrowRight className="h-4 w-4" />
                </Link>
            </p>

            <hr className="border-white/5 my-12" />

            {/* ==================== SYNCHRONIZATION ==================== */}
            <h2 id="sync" className="text-3xl font-extrabold text-white tracking-tight mb-6 pt-24 -mt-24">
                Synchronization Logic
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                Monstera Cloud employs a watermark-based incremental synchronization strategy. By default, pipelines cursor through the `updated_at` timestamps of the source API, ensuring only mutated records are fetched and merged (`UPSERT`) into your destination tables. Full Historical Resyncs can be triggered via the console.
            </p>

            <hr className="border-white/5 my-12" />

            {/* ==================== PIPELINES ==================== */}
            <h2 id="pipelines" className="text-3xl font-extrabold text-white tracking-tight mb-6 pt-24 -mt-24 flex items-center">
                <Network className="w-7 h-7 mr-3 text-purple-500" /> Pipelines
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                A Pipeline is the atomic unit of work in Monstera Cloud. It defines a strict 1:1 mapping between a Source Connection and a Destination Dataset. Pipelines are scheduled via cron syntax or executed continuously via webhook listeners.
            </p>

            <hr className="border-white/5 my-12" />

            {/* ==================== WORKSPACES ==================== */}
            <h2 id="workspaces" className="text-3xl font-extrabold text-white tracking-tight mb-6 pt-24 -mt-24">
                Workspaces
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                Workspaces provide hard logical boundaries for teams, billing, and API keys. A Production workspace handles live customer orders, while a Staging workspace routes mock data to a dev-database without crossing credentials.
            </p>

            <hr className="border-white/5 my-12" />

            {/* ==================== TRANSFORMATIONS ==================== */}
            <h2 id="transformations" className="text-3xl font-extrabold text-white tracking-tight mb-6 pt-24 -mt-24">
                Transformations
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                Monstera is an ELT (Extract, Load, Transform) engine. We heavily recommend dumping raw JSON into your warehouse and applying transformations natively via `dbt`. However, we offer light inline payload masking (e.g., stripping `customer_phone` arrays) prior to insertion for strict PII compliance.
            </p>

            <hr className="border-white/5 my-12" />

            {/* ==================== AUTHENTICATION ==================== */}
            <h2 id="authentication" className="text-3xl font-extrabold text-white tracking-tight mb-6 pt-24 -mt-24 flex items-center">
                <Lock className="w-7 h-7 mr-3 text-amber-500" /> API Authentication
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                All requests to the Monstera REST API must be authenticated via Bearer Tokens passed in the Authorization header.
            </p>
            <div className="bg-[#18181b] border border-white/10 rounded-xl overflow-hidden mb-16">
                <div className="bg-[#09090b] px-4 py-3 border-b border-white/5">
                    <span className="text-xs font-mono text-gray-500">Headers</span>
                </div>
                <div className="p-6">
                    <pre className="text-sm text-gray-300 font-mono leading-relaxed">
                        <code>Content-Type: application/json<br/>Authorization: Bearer mnt_live_xxxxxxxxxxxxxxxxxxxx</code>
                    </pre>
                </div>
            </div>

            <hr className="border-white/5 my-12" />

            {/* ==================== API REFERENCE ==================== */}
            <h2 id="api" className="text-3xl font-extrabold text-white tracking-tight mb-6 pt-24 -mt-24 flex items-center">
                <FileJson className="w-7 h-7 mr-3 text-slate-400" /> API Reference
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                The Monstera Cloud API is organized around REST. It accepts JSON-encoded request bodies, returns JSON-encoded responses, and uses standard HTTP response codes.
            </p>
            <ul className="space-y-4 mb-16 text-sm font-mono text-gray-300 bg-white/5 p-6 rounded-xl border border-white/10">
                <li><span className="text-cyan-500 font-bold w-12 inline-block">GET</span> /v1/pipelines</li>
                <li><span className="text-amber-500 font-bold w-12 inline-block">POST</span> /v1/pipelines/:id/run</li>
                <li><span className="text-cyan-500 font-bold w-12 inline-block">GET</span> /v1/workspaces/metrics</li>
                <li><span className="text-red-500 font-bold w-12 inline-block">DEL</span> /v1/destinations/:id</li>
            </ul>

            <hr className="border-white/5 my-12" />

            {/* ==================== RATE LIMITS ==================== */}
            <h2 id="limits" className="text-3xl font-extrabold text-white tracking-tight mb-6 pt-24 -mt-24 flex items-center">
                <Zap className="w-7 h-7 mr-3 text-yellow-500" /> Rate Limits
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                We strongly enforce rate limits to protect infrastructure stability. The standard API limit is `1,000 requests per minute` per IP address. Exceeding this will return a `429 Too Many Requests` status code.
            </p>

            {/* Bottom Nav */}
            <div className="mt-24 p-8 bg-gradient-to-r from-cyan-950/20 to-transparent border border-cyan-500/20 rounded-xl flex items-center justify-between">
                <div>
                    <h4 className="text-white font-bold mb-1">Explore Console</h4>
                    <p className="text-sm text-gray-400">Put theory into practice. Initialize your first pipeline.</p>
                </div>
                <Link href="/register" className="px-6 py-3 bg-white text-black text-sm font-bold rounded hover:bg-gray-200 transition-colors">
                    Open Console
                </Link>
            </div>
            
        </div>
    );
}
