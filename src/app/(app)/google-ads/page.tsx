"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { 
  BarChart3, 
  RefreshCw,
  AlertCircle,
  Loader2,
  Database,
  LineChart,
  Target
} from 'lucide-react';
import useSWR from 'swr';
import { useWorkspaceStore } from '@/store/workspace';
import { cn } from '@/lib/utils';
import { IntegrationPageLayout } from '@/components/ui/IntegrationPageLayout';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { secondaryButtonLinkClassName } from '@/components/ui/SecondaryButton';
import { INTEGRATION_LOGOS } from '@/lib/integration-logos';
import { IntegrationMark } from '@/components/ui/IntegrationMark';

const fetcher = (url: string) => fetch(url).then(res => res.json());

export default function GoogleAdsPage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const [loading, setLoading] = useState(false);
  const [reportResult, setReportResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch connections
  const { data: workspaces } = useSWR('/api/workspaces', fetcher);
  const activeWorkspace = Array.isArray(workspaces) ? workspaces.find((w: any) => w.id === activeWorkspaceId) : null;
  const gadsConnections = (activeWorkspace?.connections || []).filter((c: any) => c.provider === 'google_ads');

  const hasConnection = gadsConnections.length > 0;

  const runReport = async () => {
    if (!hasConnection) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/google-ads/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: gadsConnections[0].id,
          workspaceId: activeWorkspaceId
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
        <h3 className="text-xs font-bold text-ink mb-4 uppercase tracking-wider">Report Settings</h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-ink-mute uppercase mb-2">Customer Account</label>
            <select className="w-full bg-canvas border border-line rounded-md text-xs p-2.5 focus:border-white focus:outline-none text-ink">
              {gadsConnections.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              {!hasConnection && <option disabled>No Google Ads connected</option>}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-ink-mute uppercase mb-2">Report Type</label>
            <div className="space-y-2">
                <div className="flex items-center gap-2 p-2 bg-white text-black rounded-md text-xs font-semibold shadow-xs">
                    <Target className="w-3.5 h-3.5" /> Campaign Performance
                </div>
                <div className="flex items-center gap-2 p-2 bg-canvas text-ink-mute rounded-md border border-line text-xs font-medium opacity-60">
                    <Database className="w-3.5 h-3.5" /> Ad Group Performance
                </div>
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 rounded-lg bg-panel border border-line">
        <div className="flex items-center gap-2 text-ink mb-2">
          <RefreshCw className="w-3.5 h-3.5" />
          <h4 className="text-xs font-bold uppercase tracking-wider">Real-time Data</h4>
        </div>
        <p className="text-xs text-ink-mute leading-relaxed">
          Google Ads data is fetched directly from the API. Sync frequency can be set in settings.
        </p>
      </div>
    </div>
  );

  return (
    <IntegrationPageLayout
      title="Google Ads"
      description="Campaign, ad group, and Shopping performance from Google Ads API."
      icon={<IntegrationMark src={INTEGRATION_LOGOS.googleAds} alt="Google Ads" size="md" />}
      banner={
        !hasConnection ? (
          <div className="mb-4 flex items-center gap-3 rounded-md border border-amber-800/50 bg-amber-950/20 px-4 py-3 text-xs font-medium text-amber-200">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Connect a Google Ads account to start generating reports.</span>
            <Link href="/sources" className="ml-auto underline font-bold">Go to Console</Link>
          </div>
        ) : null
      }
      primaryAction={
        hasConnection ? (
          <PrimaryButton className="w-full py-3" onClick={runReport} disabled={loading} loading={loading}>
            <BarChart3 className="w-4 h-4 mr-2" />
            Fetch Performance
          </PrimaryButton>
        ) : (
          <Link href="/sources" className={cn(secondaryButtonLinkClassName, "w-full py-3")}>

            <Database className="w-4 h-4 mr-2" />
            Connect Google Ads
          </Link>
        )
      }
      leftColumn={leftColumn}
      results={
        <div className="flex flex-col h-full">
          {loading ? (
            <div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
              <Loader2 className="h-8 w-8 text-white animate-spin mb-4" />
              <h4 className="text-sm font-bold text-ink">Analyzing Campaigns</h4>
              <p className="text-xs text-ink-mute max-w-xs mx-auto mt-1">Connecting to Google Ads API...</p>
            </div>
          ) : reportResult ? (
            <div className="p-0 overflow-auto">
                <table className="w-full text-left text-xs">
                    <thead className="bg-canvas border-b border-line">
                        <tr>
                            <th className="px-4 py-3 font-bold text-ink-mute uppercase text-[10px]">Campaign</th>
                            <th className="px-4 py-3 font-bold text-ink-mute uppercase text-[10px]">Status</th>
                            <th className="px-4 py-3 font-bold text-ink-mute uppercase text-[10px]">Spend</th>
                            <th className="px-4 py-3 font-bold text-ink-mute uppercase text-[10px]">Conversions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                        {reportResult.data?.map((row: any, i: number) => (
                            <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                                <td className="px-4 py-3 font-medium text-ink">{row.campaign_name}</td>
                                <td className="px-4 py-3">
                                    <span className="px-2 py-0.5 rounded-full border border-line bg-canvas text-white text-[10px] font-mono uppercase tracking-wider">{row.status}</span>
                                </td>
                                <td className="px-4 py-3 text-ink-mute">${Number(row.spend).toFixed(2)}</td>
                                <td className="px-4 py-3 text-ink-mute">{Number(row.conversions).toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
          ) : error ? (
            <div className="flex flex-1 flex-col items-center justify-center p-12 text-center text-red-500">
                <AlertCircle className="h-10 w-10 mb-4 opacity-20" />
                <h4 className="text-lg font-bold">Fetch Failed</h4>
                <p className="text-sm opacity-80">{error}</p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-12 text-center border-2 border-dashed border-gray-100 rounded-xl m-4 dark:border-[#2f3336]">
              <LineChart className="h-12 w-12 text-gray-200 dark:text-slate-800 mb-4" />
              <h4 className="text-lg font-bold text-gray-300 dark:text-slate-700">No data loaded</h4>
              <p className="text-sm text-gray-400 dark:text-slate-600">Choose an account to fetch campaign performance.</p>
            </div>
          )}
        </div>
      }
    />
  );
}
