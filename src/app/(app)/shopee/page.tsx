"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { 
  RefreshCw,
  AlertCircle,
  Loader2,
  Database,
  ShoppingBag,
  Package,
  Store
} from 'lucide-react';
import useSWR from 'swr';
import { useWorkspaceStore } from '@/store/workspace';
import { cn } from '@/lib/utils';
import { IntegrationPageLayout } from '@/components/ui/IntegrationPageLayout';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { secondaryButtonLinkClassName } from '@/components/ui/SecondaryButton';
import { INTEGRATION_LOGOS } from '@/lib/integration-logos';
import { IntegrationMark } from '@/components/ui/IntegrationMark';

import { maskPII } from '@/lib/pii-masker';

const fetcher = (url: string) => fetch(url).then(res => res.json());

export default function ShopeePage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Fetch connections
  const { data: workspaces } = useSWR('/api/workspaces', fetcher);
  const activeWorkspace = Array.isArray(workspaces) ? workspaces.find((w: any) => w.id === activeWorkspaceId) : null;
  const shopeeConnections = (activeWorkspace?.connections || []).filter((c: any) => c.provider === 'shopee');

  const hasConnection = shopeeConnections.length > 0;

  const fetchOrders = async () => {
    if (!hasConnection) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/shopee/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: shopeeConnections[0].id,
          workspaceId: activeWorkspaceId
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch orders');
      setOrders(data.orders || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const leftColumn = (
    <div className="space-y-6">
      <div className="p-6 rounded-lg bg-panel border border-line shadow-xs">
        <h3 className="text-xs font-bold text-ink mb-4 uppercase tracking-wider">Shop Explorer</h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-ink-mute uppercase mb-2">Connected Shop</label>
            <select className="w-full bg-canvas border border-line rounded-md text-xs p-2.5 focus:border-white focus:outline-none text-ink">
              {shopeeConnections.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              {!hasConnection && <option disabled>No Shopee shops connected</option>}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
              <button className="flex flex-col items-center justify-center p-4 rounded-md border border-line bg-canvas text-white transition-colors">
                  <ShoppingBag className="w-4 h-4 mb-2" />
                  <span className="text-[10px] font-bold uppercase">Orders</span>
              </button>
              <button className="flex flex-col items-center justify-center p-4 rounded-md border border-line/40 bg-canvas text-ink-mute opacity-50 cursor-not-allowed">
                  <Package className="w-4 h-4 mb-2" />
                  <span className="text-[10px] font-bold uppercase">Products</span>
              </button>
          </div>
        </div>
      </div>

      <div className="p-5 rounded-lg bg-panel border border-line">
        <div className="flex items-center gap-2 text-ink mb-2">
          <Store className="w-3.5 h-3.5" />
          <h4 className="text-xs font-bold uppercase tracking-wider">Marketplace Sync</h4>
        </div>
        <p className="text-xs text-ink-mute leading-relaxed">
          Syncing order status from Shopee Open Platform v2. Data is updated in real-time on your dashboard.
        </p>
      </div>
    </div>
  );

  return (
    <IntegrationPageLayout
      title="Shopee Data Explorer"
      description="Pull orders, products, and shop info from your connected Shopee store."
      icon={<IntegrationMark src={INTEGRATION_LOGOS.shopee} alt="Shopee" size="md" />}
      banner={
        !hasConnection ? (
          <div className="mb-4 flex items-center gap-3 rounded-md border border-amber-800/50 bg-amber-950/20 px-4 py-3 text-xs font-medium text-amber-200">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Connect a Shopee seller account to view your store data.</span>
            <Link href="/sources" className="ml-auto underline font-bold">Go to Console</Link>
          </div>
        ) : null
      }
      primaryAction={
        hasConnection ? (
          <PrimaryButton className="w-full py-3" onClick={fetchOrders} disabled={loading} loading={loading}>
            <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
            Sync Recent Orders
          </PrimaryButton>
        ) : (
          <Link href="/sources" className={cn(secondaryButtonLinkClassName, "w-full py-3")}>

            <Database className="w-4 h-4 mr-2" />
            Connect Shopee
          </Link>
        )
      }
      leftColumn={leftColumn}
      results={
        <div className="flex flex-col h-full">
          {loading ? (
            <div className="flex flex-1 flex-col items-center justify-center p-12 text-center">
              <Loader2 className="h-8 w-8 text-white animate-spin mb-4" />
              <h4 className="text-sm font-bold text-ink">Pulling Shopee Data</h4>
              <p className="text-xs text-ink-mute max-w-xs mx-auto mt-1">Accessing Shopee Open Platform API...</p>
            </div>
          ) : orders.length > 0 ? (
            <div className="p-0 overflow-auto">
                <table className="w-full text-left text-xs">
                    <thead className="bg-canvas border-b border-line">
                        <tr>
                            <th className="px-4 py-3 font-bold text-ink-mute uppercase text-[10px]">Order ID</th>
                            <th className="px-4 py-3 font-bold text-ink-mute uppercase text-[10px]">Status</th>
                            <th className="px-4 py-3 font-bold text-ink-mute uppercase text-[10px]">Total</th>
                            <th className="px-4 py-3 font-bold text-ink-mute uppercase text-[10px]">Time</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                        {orders.map((order: any, i: number) => (
                            <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                                <td className="px-4 py-3 font-medium text-ink font-mono text-[11px]">{order.order_sn}</td>
                                <td className="px-4 py-3">
                                    <span className="px-2 py-0.5 rounded-full border border-line bg-canvas text-ink text-[10px] font-mono uppercase tracking-wider">{order.order_status}</span>
                                </td>
                                <td className="px-4 py-3 text-ink-mute">${Number(order.total_amount).toFixed(2)}</td>
                                <td className="px-4 py-3 text-[11px] text-ink-mute">{new Date(order.create_time * 1000).toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
          ) : error ? (
            <div className="flex flex-1 flex-col items-center justify-center p-12 text-center text-red-500">
                <AlertCircle className="h-8 w-8 mb-4 opacity-30" />
                <h4 className="text-sm font-bold">Sync Failed</h4>
                <p className="text-xs opacity-80 mt-1">{error}</p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col p-6 m-4 border border-line bg-canvas rounded-lg">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h4 className="text-sm font-bold text-ink flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-white" />
                    Shopee App Review Demo
                  </h4>
                  <p className="text-xs text-ink-mute mt-1">Demonstrating 90-day search limits and PII Masking requirements.</p>
                </div>
                <div className="flex items-center gap-3 bg-panel px-3 py-1.5 rounded-md border border-line shadow-xs">
                  <span className="text-[10px] font-bold text-ink-mute uppercase tracking-wider bg-canvas border border-line px-2 py-0.5 rounded">Date Range Limit</span>
                  <span className="text-xs font-semibold text-white">Max 90 Days</span>
                </div>
              </div>

              <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-[#2f3336]">
                <table className="w-full text-left text-sm">
                    <thead className="bg-white border-b border-gray-200 dark:bg-[#000000] dark:border-[#2f3336]">
                        <tr>
                            <th className="px-4 py-3 font-bold text-gray-500 uppercase text-[10px] tracking-wider">Shopee Order ID</th>
                            <th className="px-4 py-3 font-bold text-gray-500 uppercase text-[10px] tracking-wider">Buyer PII (Masked)</th>
                            <th className="px-4 py-3 font-bold text-gray-500 uppercase text-[10px] tracking-wider">Shipping Address (Masked)</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800 bg-white dark:bg-[#000000]">
                      <tr className="hover:bg-gray-50 dark:hover:bg-[#16181c]/50">
                          <td className="px-4 py-4 font-medium text-gray-900 dark:text-white font-mono text-[11px]">230502NK5PRJ8B</td>
                          <td className="px-4 py-4">
                              <p className="text-sm font-bold text-gray-900 dark:text-white">{maskPII.name("William")}</p>
                              <p className="text-xs text-gray-500 font-mono mt-1">{maskPII.phone("+60123456789")}</p>
                          </td>
                          <td className="px-4 py-4 text-xs text-gray-600 dark:text-gray-400 leading-relaxed max-w-[250px]">
                              {maskPII.address("38, Jalan Teratai 4, Johor Bahru, Johor, Malaysia")}
                          </td>
                      </tr>
                      <tr className="hover:bg-gray-50 dark:hover:bg-[#16181c]/50 bg-gray-50/50 dark:bg-[#000000]/50">
                          <td className="px-4 py-4 font-medium text-gray-900 dark:text-white font-mono text-[11px]">230502NK5PRJ8C</td>
                          <td className="px-4 py-4">
                              <p className="text-sm font-bold text-gray-900 dark:text-white">{maskPII.name("Siti Nurhaliza")}</p>
                              <p className="text-xs text-gray-500 font-mono mt-1">{maskPII.phone("+60198765432")}</p>
                          </td>
                          <td className="px-4 py-4 text-xs text-gray-600 dark:text-gray-400 leading-relaxed max-w-[250px]">
                              {maskPII.address("15, Lorong Bukit Bintang, Kuala Lumpur, Malaysia")}
                          </td>
                      </tr>
                    </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      }
    />
  );
}
