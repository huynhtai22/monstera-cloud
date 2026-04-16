"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
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
      <div className="p-6 rounded-2xl bg-white border border-gray-100 shadow-sm dark:bg-slate-900/50 dark:border-slate-800">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4 uppercase tracking-wider">Report Settings</h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Customer Account</label>
            <select className="w-full bg-gray-50 border-none rounded-xl text-sm p-3 focus:ring-cyan-500 dark:bg-slate-800 dark:text-white">
              {gadsConnections.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              {!hasConnection && <option disabled>No Google Ads connected</option>}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Report Type</label>
            <div className="space-y-2">
                <div className="flex items-center gap-2 p-2 bg-cyan-50 text-cyan-700 rounded-lg border border-cyan-100 text-xs font-bold">
                    <Target className="w-3.5 h-3.5" /> Campaign Performance
                </div>
                <div className="flex items-center gap-2 p-2 bg-gray-50 text-gray-500 rounded-lg border border-gray-100 text-xs font-medium opacity-60">
                    <Database className="w-3.5 h-3.5" /> Ad Group Performance
                </div>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 rounded-2xl bg-blue-50 border border-blue-100 dark:bg-blue-900/20 dark:border-blue-800">
        <div className="flex items-center gap-2 text-blue-800 dark:text-blue-300 mb-2">
          <RefreshCw className="w-4 h-4" />
          <h4 className="text-sm font-bold uppercase tracking-tight">Real-time Data</h4>
        </div>
        <p className="text-xs text-blue-600 dark:text-blue-400 leading-relaxed">
          Google Ads data is fetched directly from the API. Sync frequency can be set in settings.
        </p>
      </div>
    </div>
  );

  return (
    <IntegrationPageLayout
      title="Google Ads"
      description="Campaign, ad group, and Shopping performance from Google Ads API."
      icon={<img src={INTEGRATION_LOGOS.googleAds} alt="Google Ads" width={22} height={22} />}
      banner={
        !hasConnection ? (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300">
            <AlertCircle className="h-4 w-4" />
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
              <Loader2 className="h-10 w-10 text-cyan-500 animate-spin mb-4" />
              <h4 className="text-lg font-bold text-gray-900 dark:text-white">Analyzing Campaigns</h4>
              <p className="text-sm text-gray-500 max-w-xs mx-auto">Connecting to Google Ads API...</p>
            </div>
          ) : reportResult ? (
            <div className="p-0 overflow-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100 dark:bg-slate-800 dark:border-slate-700">
                        <tr>
                            <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px]">Campaign</th>
                            <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px]">Status</th>
                            <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px]">Spend</th>
                            <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px]">Conversions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                        {reportResult.data?.map((row: any, i: number) => (
                            <tr key={i} className="hover:bg-gray-50 transition-colors dark:hover:bg-slate-800/50">
                                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{row.campaign_name}</td>
                                <td className="px-4 py-3">
                                    <span className="px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-600 text-[10px] font-bold uppercase tracking-wider">{row.status}</span>
                                </td>
                                <td className="px-4 py-3 text-gray-600 dark:text-gray-400">${Number(row.spend).toFixed(2)}</td>
                                <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{Number(row.conversions).toLocaleString()}</td>
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
            <div className="flex flex-1 flex-col items-center justify-center p-12 text-center border-2 border-dashed border-gray-100 rounded-xl m-4 dark:border-slate-800">
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
