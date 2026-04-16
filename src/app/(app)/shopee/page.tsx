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
      <div className="p-6 rounded-2xl bg-white border border-gray-100 shadow-sm dark:bg-slate-900/50 dark:border-slate-800">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4 uppercase tracking-wider">Shop Explorer</h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Connected Shop</label>
            <select className="w-full bg-gray-50 border-none rounded-xl text-sm p-3 focus:ring-cyan-500 dark:bg-slate-800 dark:text-white">
              {shopeeConnections.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              {!hasConnection && <option disabled>No Shopee shops connected</option>}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
              <button className="flex flex-col items-center justify-center p-4 rounded-xl border-2 border-cyan-100 bg-cyan-50 text-cyan-700 transition-all">
                  <ShoppingBag className="w-5 h-5 mb-2" />
                  <span className="text-[10px] font-bold uppercase">Orders</span>
              </button>
              <button className="flex flex-col items-center justify-center p-4 rounded-xl border-2 border-transparent bg-gray-50 text-gray-400 opacity-50 cursor-not-allowed">
                  <Package className="w-5 h-5 mb-2" />
                  <span className="text-[10px] font-bold uppercase">Products</span>
              </button>
          </div>
        </div>
      </div>

      <div className="p-6 rounded-2xl bg-cyan-50 border border-cyan-100 dark:bg-cyan-900/20 dark:border-cyan-800">
        <div className="flex items-center gap-2 text-cyan-800 dark:text-cyan-300 mb-2">
          <Store className="w-4 h-4" />
          <h4 className="text-sm font-bold uppercase tracking-tight">Marketplace Sync</h4>
        </div>
        <p className="text-xs text-cyan-600 dark:text-cyan-400 leading-relaxed">
          Syncing order status from Shopee Open Platform v2. Data is updated in real-time on your dashboard.
        </p>
      </div>
    </div>
  );

  return (
    <IntegrationPageLayout
      title="Shopee Data Explorer"
      description="Pull orders, products, and shop info from your connected Shopee store."
      icon={<img src={INTEGRATION_LOGOS.shopee} alt="Shopee" width={22} height={22} />}
      banner={
        !hasConnection ? (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300">
            <AlertCircle className="h-4 w-4" />
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
              <Loader2 className="h-10 w-10 text-cyan-500 animate-spin mb-4" />
              <h4 className="text-lg font-bold text-gray-900 dark:text-white">Pulling Shopee Data</h4>
              <p className="text-sm text-gray-500 max-w-xs mx-auto">Accessing Shopee Open Platform API...</p>
            </div>
          ) : orders.length > 0 ? (
            <div className="p-0 overflow-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100 dark:bg-slate-800 dark:border-slate-700">
                        <tr>
                            <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px]">Order ID</th>
                            <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px]">Status</th>
                            <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px]">Total</th>
                            <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px]">Time</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                        {orders.map((order: any, i: number) => (
                            <tr key={i} className="hover:bg-gray-50 transition-colors dark:hover:bg-slate-800/50">
                                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white font-mono text-[11px]">{order.order_sn}</td>
                                <td className="px-4 py-3">
                                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[10px] font-bold uppercase tracking-wider">{order.order_status}</span>
                                </td>
                                <td className="px-4 py-3 text-gray-600 dark:text-gray-400">${Number(order.total_amount).toFixed(2)}</td>
                                <td className="px-4 py-3 text-[11px] text-gray-400">{new Date(order.create_time * 1000).toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
          ) : error ? (
            <div className="flex flex-1 flex-col items-center justify-center p-12 text-center text-red-500">
                <AlertCircle className="h-10 w-10 mb-4 opacity-20" />
                <h4 className="text-lg font-bold">Sync Failed</h4>
                <p className="text-sm opacity-80">{error}</p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-12 text-center border-2 border-dashed border-gray-100 rounded-xl m-4 dark:border-slate-800">
              <ShoppingBag className="h-12 w-12 text-gray-200 dark:text-slate-800 mb-4" />
              <h4 className="text-lg font-bold text-gray-300 dark:text-slate-700">No orders pulled</h4>
              <p className="text-sm text-gray-400 dark:text-slate-600">Sync recent orders from your Shopee store.</p>
            </div>
          )}
        </div>
      }
    />
  );
}
