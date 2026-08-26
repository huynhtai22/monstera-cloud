"use client";

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { 
  RefreshCw,
  AlertCircle,
  Loader2,
  Database,
  ShoppingBag,
  TrendingUp,
  BarChart3,
  Search,
  KeyRound,
  Info,
  CheckCircle2,
  ExternalLink,
  Store,
  DollarSign,
  Layers,
  ArrowUpRight,
  ShieldCheck,
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

function formatVnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatPercent(val: number): string {
  return `${(val * 100).toFixed(2)}%`;
}

function formatNum(val: number): string {
  return new Intl.NumberFormat("en-US").format(val);
}

export default function ShopeePage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const [selectedTab, setSelectedTab] = useState<'ads' | 'campaigns' | 'orders'>('ads');
  const [dateRangeDays, setDateRangeDays] = useState<number>(30);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Fetch workspaces & connections
  const { data: workspaces, mutate: mutateWorkspaces } = useSWR('/api/workspaces', fetcher);
  const activeWorkspace = Array.isArray(workspaces) ? workspaces.find((w: any) => w.id === activeWorkspaceId) : null;
  const shopeeConnections = (activeWorkspace?.connections || []).filter((c: any) => c.provider === 'shopee');
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');

  const activeConnection = useMemo(() => {
    if (selectedConnectionId) {
      return shopeeConnections.find((c: any) => c.id === selectedConnectionId) || shopeeConnections[0];
    }
    return shopeeConnections[0] || null;
  }, [shopeeConnections, selectedConnectionId]);

  const hasConnection = Boolean(activeConnection);

  // Fetch Authoritative Shop Info
  const { data: shopInfo } = useSWR(
    activeConnection?.id ? `/api/shopee/shop-info?connectionId=${activeConnection.id}` : null,
    fetcher
  );

  // Calculate Start & End Date
  const dateParams = useMemo(() => {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - dateRangeDays * 86400000).toISOString().slice(0, 10);
    return { start, end };
  }, [dateRangeDays]);

  // Fetch Ads Performance Data
  const { data: adsPerf, isValidating: loadingPerf, mutate: mutatePerf } = useSWR(
    activeConnection?.id && selectedTab === 'ads'
      ? `/api/shopee/ads/performance?connectionId=${activeConnection.id}&startDate=${dateParams.start}&endDate=${dateParams.end}`
      : null,
    fetcher
  );

  // Fetch Campaigns & Keyword Settings
  const { data: campaignSettings, isValidating: loadingCampaigns, mutate: mutateCampaigns } = useSWR(
    activeConnection?.id && selectedTab === 'campaigns'
      ? `/api/shopee/ads/campaigns?connectionId=${activeConnection.id}`
      : null,
    fetcher
  );

  // Fetch Orders
  const { data: ordersData, isValidating: loadingOrders, mutate: mutateOrders } = useSWR(
    activeConnection?.id && selectedTab === 'orders'
      ? `/api/shopee/orders?connectionId=${activeConnection.id}`
      : null,
    fetcher
  );

  const isVietnamShop = (shopInfo?.region || '').toUpperCase() === 'VN' || true;

  const triggerSync = async () => {
    if (!activeConnection?.id) return;
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/shopee/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: activeConnection.id,
          workspaceId: activeWorkspaceId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      setSyncMessage('Sync completed successfully.');
      mutatePerf();
      mutateCampaigns();
      mutateOrders();
      mutateWorkspaces();
    } catch (err: any) {
      setSyncMessage(`Sync error: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const filteredPerfRows = useMemo(() => {
    const rows = adsPerf?.rows || [];
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase();
    return rows.filter((r: any) => 
      (r.campaignName && r.campaignName.toLowerCase().includes(q)) ||
      (r.adName && r.adName.toLowerCase().includes(q)) ||
      (r.campaignId && String(r.campaignId).includes(q)) ||
      (r.adId && String(r.adId).includes(q))
    );
  }, [adsPerf?.rows, searchQuery]);

  const filteredCampaigns = useMemo(() => {
    const list = campaignSettings?.campaigns || [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((c: any) =>
      (c.campaign_name && c.campaign_name.toLowerCase().includes(q)) ||
      (c.campaign_id && String(c.campaign_id).includes(q)) ||
      (c.item_name && c.item_name.toLowerCase().includes(q)) ||
      (c.keyword_list && c.keyword_list.some((k: any) => k.keyword.toLowerCase().includes(q)))
    );
  }, [campaignSettings?.campaigns, searchQuery]);

  const summary = adsPerf?.summary || {
    spend: 0,
    broadGmv: 0,
    broadRoas: 0,
    broadOrders: 0,
    broadUnits: 0,
    clicks: 0,
    impressions: 0,
    ctr: 0,
    cpc: 0,
    broadAcos: 0,
    broadCr: 0,
    broadCostPerConversion: 0,
    directOrders: 0,
    directUnits: 0,
    directGmv: 0,
    directRoas: 0,
  };

  const leftColumn = (
    <div className="space-y-6">
      {/* Shop Selector & Region Status */}
      <div className="p-5 rounded-lg bg-panel border border-line shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-ink uppercase tracking-wider">Shopee Shop</h3>
          {shopInfo?.region && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="w-3 h-3" />
              {shopInfo.region} Authoritative
            </span>
          )}
        </div>

        <div>
          <label className="block text-[10px] font-bold text-ink-mute uppercase mb-2">Connected Store</label>
          <select 
            className="w-full bg-canvas border border-line rounded-md text-xs p-2.5 focus:border-white focus:outline-none text-ink"
            value={activeConnection?.id || ''}
            onChange={(e) => setSelectedConnectionId(e.target.value)}
          >
            {shopeeConnections.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name || `Shopee Shop (${c.remoteAccountId || c.id})`}
              </option>
            ))}
            {!hasConnection && <option disabled>No Shopee shops connected</option>}
          </select>
        </div>

        {shopInfo && (
          <div className="pt-2 border-t border-line space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-ink-mute">Shop Name:</span>
              <span className="font-semibold text-ink">{shopInfo.shop_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-mute">Region:</span>
              <span className="font-semibold text-emerald-400">Vietnam ({shopInfo.region})</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-mute">Cross Border:</span>
              <span className="font-semibold text-ink">{shopInfo.is_cb ? 'Yes' : 'No (Local Shop)'}</span>
            </div>
          </div>
        )}
      </div>

      {/* Navigation Tabs */}
      <div className="p-3 rounded-lg bg-panel border border-line space-y-1">
        <button 
          onClick={() => setSelectedTab('ads')}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-semibold transition-colors text-left",
            selectedTab === 'ads' 
              ? "bg-canvas border border-line text-white shadow-xs" 
              : "text-ink-mute hover:text-ink hover:bg-white/[0.02]"
          )}
        >
          <TrendingUp className="w-4 h-4 text-orange-400" />
          <span>Product Ads Performance</span>
        </button>

        <button 
          onClick={() => setSelectedTab('campaigns')}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-semibold transition-colors text-left",
            selectedTab === 'campaigns' 
              ? "bg-canvas border border-line text-white shadow-xs" 
              : "text-ink-mute hover:text-ink hover:bg-white/[0.02]"
          )}
        >
          <KeyRound className="w-4 h-4 text-sky-400" />
          <span>Campaign Settings & Keywords</span>
        </button>

        <button 
          onClick={() => setSelectedTab('orders')}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-semibold transition-colors text-left",
            selectedTab === 'orders' 
              ? "bg-canvas border border-line text-white shadow-xs" 
              : "text-ink-mute hover:text-ink hover:bg-white/[0.02]"
          )}
        >
          <ShoppingBag className="w-4 h-4 text-emerald-400" />
          <span>Orders & Marketplace Sync</span>
        </button>
      </div>

      {/* Policy & Capability Notice */}
      <div className="p-5 rounded-lg bg-panel border border-line space-y-2">
        <div className="flex items-center gap-2 text-ink">
          <Store className="w-3.5 h-3.5 text-orange-400" />
          <h4 className="text-xs font-bold uppercase tracking-wider">Vietnam Marketplace</h4>
        </div>
        <p className="text-xs text-ink-mute leading-relaxed">
          Product advertising reports support authoritative Shopee Vietnam (<code className="text-white">VN</code>) shops with full attribution (Broad & Direct GMV/ROAS/CIR).
        </p>
      </div>
    </div>
  );

  return (
    <IntegrationPageLayout
      title="Shopee Vietnam Ads & Intelligence"
      description="Authoritative Vietnam product-level advertising analytics, settings, and order reconciliation."
      icon={<IntegrationMark src={INTEGRATION_LOGOS.shopee} alt="Shopee" size="md" />}
      banner={
        !hasConnection ? (
          <div className="mb-4 flex items-center gap-3 rounded-md border border-amber-800/50 bg-amber-950/20 px-4 py-3 text-xs font-medium text-amber-200">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Connect a Vietnam Shopee seller account to view ad metrics and sales performance.</span>
            <Link href="/sources" className="ml-auto underline font-bold">Go to Sources</Link>
          </div>
        ) : syncMessage ? (
          <div className="mb-4 flex items-center gap-3 rounded-md border border-emerald-800/50 bg-emerald-950/20 px-4 py-3 text-xs font-medium text-emerald-200">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{syncMessage}</span>
          </div>
        ) : null
      }
      primaryAction={
        hasConnection ? (
          <PrimaryButton 
            className="w-full py-3" 
            onClick={triggerSync} 
            disabled={isSyncing} 
            loading={isSyncing}
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", isSyncing && "animate-spin")} />
            Sync Shopee Warehouse
          </PrimaryButton>
        ) : (
          <Link href="/sources" className={cn(secondaryButtonLinkClassName, "w-full py-3")}>
            <Database className="w-4 h-4 mr-2" />
            Connect Shopee VN
          </Link>
        )
      }
      leftColumn={leftColumn}
      results={
        <div className="flex flex-col h-full space-y-6">
          {/* Header Controls */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-lg bg-panel border border-line">
            <div className="flex items-center gap-3 flex-1 max-w-sm">
              <div className="relative w-full">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute" />
                <input
                  type="text"
                  placeholder="Search campaigns, products, keywords..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-canvas border border-line rounded-md pl-9 pr-3 py-1.5 text-xs text-ink focus:border-white focus:outline-none placeholder:text-ink-mute"
                />
              </div>
            </div>

            {selectedTab === 'ads' && (
              <div className="flex items-center gap-2">
                {[7, 14, 30, 90].map((days) => (
                  <button
                    key={days}
                    onClick={() => setDateRangeDays(days)}
                    className={cn(
                      "px-2.5 py-1 rounded text-[11px] font-semibold transition-colors",
                      dateRangeDays === days
                        ? "bg-white text-black font-bold shadow-xs"
                        : "bg-canvas border border-line text-ink-mute hover:text-white"
                    )}
                  >
                    Last {days}d
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* TAB 1: PRODUCT ADS PERFORMANCE */}
          {selectedTab === 'ads' && (
            <div className="space-y-6">
              {/* 4-Card Bento Operational Metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-panel border border-line shadow-xs">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-ink-mute">Ad Spend (Expense)</span>
                  <div className="text-lg font-bold text-ink font-mono mt-1">{formatVnd(summary.spend)}</div>
                  <div className="text-[11px] text-ink-mute mt-1 flex items-center justify-between">
                    <span>CPC: {formatVnd(summary.cpc)}</span>
                    <span>CTR: {formatPercent(summary.ctr)}</span>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-panel border border-line shadow-xs">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-ink-mute">Attributed GMV (Broad)</span>
                  <div className="text-lg font-bold text-emerald-400 font-mono mt-1">{formatVnd(summary.broadGmv)}</div>
                  <div className="text-[11px] text-ink-mute mt-1 flex items-center justify-between">
                    <span>ROAS: <b className="text-white">{summary.broadRoas.toFixed(2)}x</b></span>
                    <span>ACOS: {formatPercent(summary.broadAcos)}</span>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-panel border border-line shadow-xs">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-ink-mute">Attributed Orders</span>
                  <div className="text-lg font-bold text-ink font-mono mt-1">{formatNum(summary.broadOrders)}</div>
                  <div className="text-[11px] text-ink-mute mt-1 flex items-center justify-between">
                    <span>Units: {formatNum(summary.broadUnits)}</span>
                    <span>Cost/Conv: {formatVnd(summary.broadCostPerConversion)}</span>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-panel border border-line shadow-xs">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-ink-mute">Direct Attribution</span>
                  <div className="text-lg font-bold text-sky-400 font-mono mt-1">{formatVnd(summary.directGmv)}</div>
                  <div className="text-[11px] text-ink-mute mt-1 flex items-center justify-between">
                    <span>Direct Orders: {formatNum(summary.directOrders)}</span>
                    <span>ROAS: {summary.directRoas.toFixed(2)}x</span>
                  </div>
                </div>
              </div>

              {/* Product Campaign Daily Performance Table */}
              <div className="rounded-lg bg-panel border border-line overflow-hidden shadow-xs">
                <div className="p-4 border-b border-line flex items-center justify-between">
                  <h4 className="text-xs font-bold text-ink uppercase tracking-wider">Product Performance ({filteredPerfRows.length} rows)</h4>
                  <span className="text-[11px] text-ink-mute font-mono">Date Window: {dateParams.start} → {dateParams.end}</span>
                </div>

                {loadingPerf ? (
                  <div className="p-12 flex flex-col items-center justify-center text-center">
                    <Loader2 className="h-6 w-6 text-white animate-spin mb-3" />
                    <p className="text-xs text-ink-mute">Loading Shopee Ads metrics...</p>
                  </div>
                ) : filteredPerfRows.length === 0 ? (
                  <div className="p-12 text-center text-ink-mute text-xs">
                    No product advertising metrics found for this period.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-canvas border-b border-line font-mono text-[10px] text-ink-mute uppercase">
                        <tr>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Campaign / Product</th>
                          <th className="px-4 py-3 text-right">Spend</th>
                          <th className="px-4 py-3 text-right">Impr. / Clicks</th>
                          <th className="px-4 py-3 text-right">CTR</th>
                          <th className="px-4 py-3 text-right">Broad Orders</th>
                          <th className="px-4 py-3 text-right">Broad GMV</th>
                          <th className="px-4 py-3 text-right">ROAS</th>
                          <th className="px-4 py-3 text-right">ACOS</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line font-mono text-[11px]">
                        {filteredPerfRows.map((row: any) => (
                          <tr key={row.id} className="hover:bg-white/[0.02] transition-colors">
                            <td className="px-4 py-3 text-ink-mute whitespace-nowrap">{row.date}</td>
                            <td className="px-4 py-3 font-sans">
                              <div className="font-semibold text-ink">{row.campaignName}</div>
                              {row.adName && <div className="text-[10px] text-ink-mute mt-0.5">{row.adName}</div>}
                            </td>
                            <td className="px-4 py-3 text-right text-ink font-semibold">{formatVnd(row.spend)}</td>
                            <td className="px-4 py-3 text-right text-ink-mute">
                              {formatNum(row.impressions)} / <span className="text-white">{formatNum(row.clicks)}</span>
                            </td>
                            <td className="px-4 py-3 text-right text-ink-mute">{formatPercent(row.ctr)}</td>
                            <td className="px-4 py-3 text-right text-ink">
                              {formatNum(row.broadOrders)} <span className="text-[10px] text-ink-mute">({formatNum(row.broadUnits)}u)</span>
                            </td>
                            <td className="px-4 py-3 text-right text-emerald-400 font-semibold">{formatVnd(row.broadGmv)}</td>
                            <td className="px-4 py-3 text-right text-white font-bold">{row.broadRoas.toFixed(2)}x</td>
                            <td className="px-4 py-3 text-right text-ink-mute">{formatPercent(row.broadAcos)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: CAMPAIGN SETTINGS & HONEST KEYWORD INSPECTOR */}
          {selectedTab === 'campaigns' && (
            <div className="space-y-6">
              {/* Honest Keyword Limitation Notice Banner */}
              <div className="p-4 rounded-lg border border-sky-800/40 bg-sky-950/20 flex items-start gap-3 text-xs text-sky-200">
                <Info className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold text-white">Shopee Open Platform Keyword Limitation Disclosure</div>
                  <p className="text-sky-300/90 leading-relaxed">
                    Shopee currently exposes keyword <b>configuration</b> (selected keyword text, match type, bid price, status) through <code className="bg-canvas px-1.5 py-0.5 rounded border border-line text-white">/api/v2/ads/get_product_level_campaign_setting_info</code>. 
                    Keyword-level <b>performance metrics</b> (impressions, clicks, spend per keyword) are not exposed by the Shopee API. All performance metrics above are reported at the campaign and product levels.
                  </p>
                </div>
              </div>

              {/* Campaign Settings List */}
              <div className="space-y-4">
                {loadingCampaigns ? (
                  <div className="p-12 flex flex-col items-center justify-center text-center">
                    <Loader2 className="h-6 w-6 text-white animate-spin mb-3" />
                    <p className="text-xs text-ink-mute">Loading campaign settings & keywords...</p>
                  </div>
                ) : filteredCampaigns.length === 0 ? (
                  <div className="p-12 text-center text-ink-mute text-xs bg-panel rounded-lg border border-line">
                    No campaigns found matching search query.
                  </div>
                ) : (
                  filteredCampaigns.map((c: any) => (
                    <div key={c.campaign_id} className="p-5 rounded-lg bg-panel border border-line shadow-xs space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-ink">{c.campaign_name}</h4>
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-canvas border border-line text-ink-mute">
                              ID: {c.campaign_id}
                            </span>
                            <span className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                              c.campaign_status === 'ongoing' ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-canvas border border-line text-ink-mute"
                            )}>
                              {c.campaign_status}
                            </span>
                          </div>
                          {c.item_name && (
                            <p className="text-xs text-ink-mute mt-1">Product: <span className="text-white">{c.item_name}</span> (Item #{c.item_id})</p>
                          )}
                        </div>

                        <div className="flex items-center gap-4 text-xs font-mono">
                          {c.budget != null && (
                            <div>
                              <span className="text-ink-mute">Budget: </span>
                              <span className="text-white font-semibold">{formatVnd(c.budget)}</span>
                            </div>
                          )}
                          {c.bidding_method && (
                            <div>
                              <span className="text-ink-mute">Bidding: </span>
                              <span className="text-white font-semibold capitalize">{c.bidding_method}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Keywords List */}
                      <div>
                        <div className="text-[10px] font-bold uppercase text-ink-mute mb-2 flex items-center justify-between">
                          <span>Configured Keywords ({c.keyword_list?.length || 0})</span>
                          <span className="text-[9px] text-ink-mute font-normal">Settings only</span>
                        </div>

                        {c.keyword_list && c.keyword_list.length > 0 ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                            {c.keyword_list.map((kw: any, idx: number) => (
                              <div key={idx} className="p-2.5 rounded bg-canvas border border-line flex items-center justify-between text-xs">
                                <div>
                                  <div className="font-medium text-white">{kw.keyword}</div>
                                  <div className="text-[10px] text-ink-mute font-mono capitalize">{kw.match_type} match</div>
                                </div>
                                <div className="text-right font-mono">
                                  <div className="text-ink font-semibold">{formatVnd(kw.bid_price)}</div>
                                  <div className="text-[9px] text-emerald-400 uppercase">{kw.status}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-ink-mute italic">Auto-bidding or discovery placement (no manual keywords configured).</p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 3: ORDERS & RECONCILIATION */}
          {selectedTab === 'orders' && (
            <div className="p-0 overflow-auto rounded-lg bg-panel border border-line shadow-xs">
              <div className="p-4 border-b border-line flex items-center justify-between">
                <h4 className="text-xs font-bold text-ink uppercase tracking-wider">Retail Orders Stream</h4>
                <span className="text-[11px] text-ink-mute font-mono">PII Masked per Shopee Open Platform policy</span>
              </div>

              {loadingOrders ? (
                <div className="p-12 flex flex-col items-center justify-center text-center">
                  <Loader2 className="h-6 w-6 text-white animate-spin mb-3" />
                  <p className="text-xs text-ink-mute">Loading orders...</p>
                </div>
              ) : ordersData?.orders?.length > 0 ? (
                <table className="w-full text-left text-xs">
                  <thead className="bg-canvas border-b border-line font-mono text-[10px] text-ink-mute uppercase">
                    <tr>
                      <th className="px-4 py-3">Order SN</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Total Amount</th>
                      <th className="px-4 py-3">Buyer (Masked)</th>
                      <th className="px-4 py-3">Order Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line font-mono text-[11px]">
                    {ordersData.orders.map((order: any, i: number) => (
                      <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 font-semibold text-white">{order.order_sn}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded-full border border-line bg-canvas text-ink text-[10px] uppercase">
                            {order.order_status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-emerald-400 font-semibold">{formatVnd(Number(order.total_amount))}</td>
                        <td className="px-4 py-3 text-ink-mute font-sans">{order.customer_name || 'Buyer (Masked)'}</td>
                        <td className="px-4 py-3 text-ink-mute">{new Date(order.create_time * 1000).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-12 text-center text-ink-mute text-xs">
                  No retail orders found. Click &quot;Sync Shopee Warehouse&quot; to fetch latest data.
                </div>
              )}
            </div>
          )}
        </div>
      }
    />
  );
}
