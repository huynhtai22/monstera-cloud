import React from 'react';
import { ArrowRight, Terminal, CheckCircle2, ShieldAlert } from 'lucide-react';
import Link from 'next/link';

export default function DocsGettingStarted() {
    return (
        <div className="max-w-3xl font-sans">
            <div className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold text-gray-400 border border-white/10 bg-white/5 tracking-widest uppercase mb-6">
                Getting Started
            </div>
            
            <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tighter mb-6">
                Introduction to Monstera
            </h1>
            
            <p className="text-lg text-gray-400 leading-relaxed mb-10">
                Monstera Cloud is an architectural data ingestion engine. Instead of wrapping your systems in heavy ETL middleware or Python scripts, Monstera provides direct, real-time connection streams from SaaS tools (like Shopee or Shopify) directly into your private data warehouses (BigQuery, Snowflake).
            </p>

            <h2 id="quickstart" className="text-2xl font-bold text-white tracking-tight mt-16 mb-6">
                Quickstart Authentication
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
                To route data from a platform like Shopee, you must first authenticate your Tenant Workspace. This generates the necessary HMAC-SHA256 credentials required for our headless nodes to listen for webhooks.
            </p>

            <div className="bg-[#18181b] border border-white/10 rounded-xl overflow-hidden mb-12">
                <div className="bg-[#09090b] px-4 py-3 border-b border-white/5 flex items-center space-x-2">
                    <div className="w-3 h-3 rounded-full bg-red-500/20"></div>
                    <div className="w-3 h-3 rounded-full bg-amber-500/20"></div>
                    <div className="w-3 h-3 rounded-full bg-emerald-500/20"></div>
                    <span className="ml-4 text-xs font-mono text-gray-500">cURL - Authenticate Node</span>
                </div>
                <div className="p-6 overflow-x-auto">
                    <pre className="text-sm text-gray-300 font-mono leading-relaxed">
                        <code dangerouslySetInnerHTML={{ __html: `curl -X POST https://api.monsteracloud.com/v1/workspaces/auth \\
<br/>  -H "Authorization: Bearer mnt_live_YOUR_API_KEY" \\<br/>  -d '{<br/>    "provider": "shopee",<br/>    "region": "sg",<br/>    "encryption": "aes-256-gcm"<br/>  }'` }} />
                    </pre>
                </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-6 mb-16">
                <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-xl p-6">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500 mb-4" />
                    <h3 className="text-white font-bold mb-2">Zero Maintenance</h3>
                    <p className="text-sm text-gray-400">Our engine automatically manages schema drift, API rate limiting, and exponential backoff retry logic. You just query the warehouse.</p>
                </div>
                <div className="bg-amber-950/20 border border-amber-500/20 rounded-xl p-6">
                    <ShieldAlert className="w-6 h-6 text-amber-500 mb-4" />
                    <h3 className="text-white font-bold mb-2">Immutable Logs</h3>
                    <p className="text-sm text-gray-400">Every byte of data synced is cryptographically signed and logged. Replay failed webhooks unconditionally from your dashboard.</p>
                </div>
            </div>

            <hr className="border-white/5 my-12" />

            <div className="flex justify-between items-center">
                <div />
                <Link href="#architecture" className="flex items-center p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors group text-right">
                    <div>
                        <div className="text-xs text-gray-500 mb-1 uppercase tracking-wider font-bold">Next Concept</div>
                        <div className="text-emerald-500 font-semibold group-hover:text-emerald-400 transition-colors">Core Pipeline Architecture</div>
                    </div>
                    <ArrowRight className="w-5 h-5 ml-4 text-emerald-500 group-hover:translate-x-1 transition-transform" />
                </Link>
            </div>
        </div>
    );
}
