"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { 
  BarChart3, 
  RefreshCw,
  AlertCircle,
  Loader2,
  Database,
  LineChart
} from 'lucide-react';
import useSWR from 'swr';
import { useWorkspaceStore } from '@/store/workspace';
import { cn } from '@/lib/utils';
import { IntegrationPageLayout } from '@/components/ui/IntegrationPageLayout';
import { INTEGRATION_LOGOS } from '@/lib/integration-logos';
import { IntegrationMark } from '@/components/ui/IntegrationMark';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { secondaryButtonLinkClassName } from '@/components/ui/SecondaryButton';

const fetcher = (url: string) => fetch(url).then(res => res.json());

export default function TikTokAdsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const [loading, setLoading] = useState(false);
  const [reportResult, setReportResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch connections to find TikTok Business ones
  const { data: workspaces } = useSWR('/api/workspaces', fetcher);
  const activeWorkspace = Array.isArray(workspaces) ? workspaces.find((w: any) => w.id === activeWorkspaceId) : null;
  const tiktokConnections = (activeWorkspace?.connections || []).filter((c: any) => c.provider === 'tiktok_business');

  const hasConnection = tiktokConnections.length > 0;

  const runReport = async () => {
    if (!hasConnection) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tiktok-business/report/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: tiktokConnections[0].id,
          workspaceId: activeWorkspaceId,
          metrics: ['spend', 'impressions', 'clicks', 'conversions', 'ctr'],
          dimensions: ['campaign_id', 'campaign_name'],
          dateRange: 'LAST_7_DAYS'
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to run report');
      setReportResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const leftColumn = (
    <div className="space-y-6">
      <div className="p-6 rounded-lg bg-panel border border-line shadow-xs">
        <h3 className="text-xs font-bold text-ink mb-4 uppercase tracking-wider">Report Configuration</h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-ink-mute uppercase mb-2">Ad Account</label>
            <select className="w-full bg-canvas border border-line rounded-md text-xs p-2.5 focus:border-white focus:outline-none text-ink">
              {tiktokConnections.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              {!hasConnection && <option disabled>No TikTok accounts connected</option>}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-ink-mute uppercase mb-2">Time Range</label>
            <div className="grid grid-cols-2 gap-2">
              <button className="p-2 text-xs font-semibold bg-white text-black rounded-md shadow-xs">Last 7 Days</button>
              <button className="p-2 text-xs font-semibold bg-canvas text-ink-mute rounded-md border border-line hover:text-white transition-colors">Last 30 Days</button>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-ink-mute uppercase mb-2">Metrics</label>
            <div className="flex flex-wrap gap-2">
              {['Spend', 'Impressions', 'Clicks', 'Conversions', 'ROAS'].map(m => (
                <span key={m} className="px-2 py-1 bg-canvas border border-line text-ink-mute rounded text-[10px] font-mono">{m}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 rounded-lg bg-panel border border-line">
        <div className="flex items-center gap-2 text-ink mb-2">
          <RefreshCw className="w-3.5 h-3.5" />
          <h4 className="text-xs font-bold uppercase tracking-wider">Auto-Sync Status</h4>
        </div>
        <p className="text-xs text-ink-mute leading-relaxed">
          TikTok Ads reports can be scheduled to automatically sync to Google Sheets every 24 hours.
        </p>
      </div>
    </div>
  );

  return (
    <IntegrationPageLayout
      title="TikTok Ads Report"
      description="Pull async ad performance reports from TikTok Business API into your workspace."
      icon={<IntegrationMark src={INTEGRATION_LOGOS.tiktok} alt="TikTok" size="md" />}
      banner={
        tiktokConnections.length === 0 ? (
          <div className="mb-4 flex items-center gap-3 rounded-md border border-amber-800/50 bg-amber-950/20 px-4 py-3 text-xs font-medium text-amber-200">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Connect a TikTok Business account to start generating reports.</span>
            <Link href="/sources" className="ml-auto underline font-bold">Go to Console</Link>
          </div>
        ) : null
      }
      primaryAction={
        hasConnection ? (
          <PrimaryButton className="w-full py-3" onClick={runReport} disabled={loading} loading={loading}>
            <BarChart3 className="w-4 h-4 mr-2" />
            Generate Report
          </PrimaryButton>
        ) : (
          <Link href="/sources" className={cn(secondaryButtonLinkClassName, "w-full py-3")}>

            <Database className="w-4 h-4 mr-2" />
            Connect TikTok
          </Link>
        )
      }
      leftColumn={leftColumn}
      results={
        <div className="flex flex-col h-full">
          {loading ? (
            <div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
              <Loader2 className="h-8 w-8 text-white animate-spin mb-4" />
              <h4 className="text-sm font-bold text-ink">Fetching TikTok Data</h4>
              <p className="text-xs text-ink-mute max-w-xs mx-auto mt-1">This usually takes 5-10 seconds depending on account size.</p>
            </div>
          ) : reportResult ? (
            <div className="p-0 overflow-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100 dark:bg-[#16181c] dark:border-[#2f3336]">
                        <tr>
                            <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px]">Campaign</th>
                            <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px]">Spend</th>
                            <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px]">Impressions</th>
                            <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px]">Clicks</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                        {reportResult.data?.map((row: any, i: number) => (
                            <tr key={i} className="hover:bg-gray-50 transition-colors dark:hover:bg-[#16181c]/50">
                                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{row.campaign_name}</td>
                                <td className="px-4 py-3 text-gray-600 dark:text-gray-400">${Number(row.spend).toFixed(2)}</td>
                                <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{Number(row.impressions).toLocaleString()}</td>
                                <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{Number(row.clicks).toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
          ) : error ? (
            <div className="flex flex-1 flex-col items-center justify-center p-12 text-center text-red-500">
                <AlertCircle className="h-10 w-10 mb-4 opacity-20" />
                <h4 className="text-lg font-bold">Report Failed</h4>
                <p className="text-sm opacity-80">{error}</p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-12 text-center border-2 border-dashed border-gray-100 rounded-xl m-4 dark:border-[#2f3336]">
              <LineChart className="h-12 w-12 text-gray-200 dark:text-slate-800 mb-4" />
              <h4 className="text-lg font-bold text-gray-300 dark:text-slate-700">No report generated yet</h4>
              <p className="text-sm text-gray-400 dark:text-slate-600">Choose your account and metrics, then click generate.</p>
            </div>
          )}
        </div>
      }
    />
  );
}
