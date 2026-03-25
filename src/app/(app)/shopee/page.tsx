"use client";

import React, { useState, useMemo } from "react";
import Image from "next/image";
import {
  Loader2,
  Play,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Package,
  ShoppingCart,
  Store,
  ChevronDown,
} from "lucide-react";
import useSWR from "swr";
import { useWorkspaceStore } from "@/store/workspace";
import { ExportDropdown } from "@/components/ExportDropdown";
import { downloadCsv, downloadExcel } from "@/lib/export-utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Tab = "orders" | "products" | "shop";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function flattenOrder(order: any) {
  return {
    order_sn: order.order_sn ?? "",
    order_status: order.order_status ?? "",
    create_time: order.create_time
      ? new Date(order.create_time * 1000).toLocaleString()
      : "",
    total_amount: order.total_amount ?? "",
    currency: order.currency ?? "",
    buyer_username: order.buyer_username ?? "",
    items: (order.item_list || [])
      .map((i: any) => `${i.item_name} x${i.model_quantity_purchased ?? 1}`)
      .join("; "),
    shipping_carrier: order.shipping_carrier ?? "",
    pay_time: order.pay_time
      ? new Date(order.pay_time * 1000).toLocaleString()
      : "",
  };
}

function flattenProduct(item: any) {
  return {
    item_id: item.item_id ?? "",
    item_name: item.item_name ?? "",
    item_status: item.item_status ?? "",
    category_id: item.category_id ?? "",
    stock:
      item.stock_info_v2?.summary_info?.total_available_stock ??
      item.stock_info?.current_stock ??
      "",
    price: item.price_info?.[0]?.current_price ?? "",
    currency: item.price_info?.[0]?.currency ?? "",
    sales: item.sale_count ?? "",
    rating: item.rating_star ?? "",
    create_time: item.create_time
      ? new Date(item.create_time * 1000).toLocaleString()
      : "",
    update_time: item.update_time
      ? new Date(item.update_time * 1000).toLocaleString()
      : "",
  };
}

export default function ShopeePage() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const { data: workspaces } = useSWR("/api/workspaces", fetcher);

  const shopeeConnections = useMemo(() => {
    if (!Array.isArray(workspaces) || !activeWorkspaceId) return [];
    const ws = workspaces.find((w: any) => w.id === activeWorkspaceId);
    return (ws?.connections || [])
      .filter(
        (c: any) => c.provider === "shopee" && c.status === "connected"
      )
      .map((c: any) => {
        let shopId = "";
        let sandbox = false;
        try {
          const creds = JSON.parse(c.credentials || "{}");
          shopId = String(creds.shopId ?? "");
          sandbox = creds.sandbox === true;
        } catch {}
        return { id: c.id, name: c.name, shopId, sandbox };
      });
  }, [workspaces, activeWorkspaceId]);

  const [connectionId, setConnectionId] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("orders");
  const [startDate, setStartDate] = useState(daysAgo(7));
  const [endDate, setEndDate] = useState(today());
  const [orderStatus, setOrderStatus] = useState("ALL");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Orders state
  const [orders, setOrders] = useState<any[] | null>(null);
  const [orderCursor, setOrderCursor] = useState("");
  const [orderHasMore, setOrderHasMore] = useState(false);

  // Products state
  const [products, setProducts] = useState<any[] | null>(null);
  const [productOffset, setProductOffset] = useState(0);
  const [productHasMore, setProductHasMore] = useState(false);

  // Shop info state
  const [shopInfo, setShopInfo] = useState<any | null>(null);

  const handleFetchOrders = async (reset = true) => {
    if (!connectionId) {
      setError("Select a connection first.");
      return;
    }
    setIsLoading(true);
    setError(null);
    if (reset) {
      setOrders(null);
      setOrderCursor("");
    }
    try {
      const res = await fetch("/api/shopee/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          startDate,
          endDate,
          cursor: reset ? "" : orderCursor,
          pageSize: 50,
          orderStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch orders");
      const newOrders = data.orders || [];
      setOrders(reset ? newOrders : [...(orders || []), ...newOrders]);
      setOrderHasMore(data.more);
      setOrderCursor(data.next_cursor || "");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFetchProducts = async (reset = true) => {
    if (!connectionId) {
      setError("Select a connection first.");
      return;
    }
    setIsLoading(true);
    setError(null);
    if (reset) {
      setProducts(null);
      setProductOffset(0);
    }
    try {
      const res = await fetch("/api/shopee/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          offset: reset ? 0 : productOffset,
          pageSize: 50,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch products");
      const newItems = data.items || [];
      setProducts(reset ? newItems : [...(products || []), ...newItems]);
      setProductHasMore(data.has_next_page);
      setProductOffset(data.next_offset || 0);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFetchShopInfo = async () => {
    if (!connectionId) {
      setError("Select a connection first.");
      return;
    }
    setIsLoading(true);
    setError(null);
    setShopInfo(null);
    try {
      const res = await fetch(
        `/api/shopee/shop-info?connectionId=${connectionId}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch shop info");
      setShopInfo(data.response || data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRun = () => {
    if (activeTab === "orders") handleFetchOrders();
    else if (activeTab === "products") handleFetchProducts();
    else handleFetchShopInfo();
  };

  const flatOrders = useMemo(
    () => (orders || []).map(flattenOrder),
    [orders]
  );
  const flatProducts = useMemo(
    () => (products || []).map(flattenProduct),
    [products]
  );

  const tabs: Array<{ id: Tab; label: string; icon: any }> = [
    { id: "orders", label: "Orders", icon: ShoppingCart },
    { id: "products", label: "Products", icon: Package },
    { id: "shop", label: "Shop Info", icon: Store },
  ];

  return (
    <div className="relative max-w-7xl mx-auto px-6 py-10 w-full animate-in fade-in duration-300">
      <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute top-0 right-[10%] w-[40%] h-[40%] rounded-full bg-orange-200/20 dark:bg-orange-900/20 blur-[120px]" />
        <div className="absolute bottom-[10%] left-0 w-[40%] h-[50%] rounded-full bg-emerald-200/20 dark:bg-emerald-900/20 blur-[120px]" />
      </div>

      {/* Header */}
      <div className="mb-8 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-white/50 dark:bg-slate-900/50 border border-white dark:border-slate-700/60 flex items-center justify-center shadow-sm">
          <Image src="/logos/shopee.svg" alt="Shopee" width={22} height={22} />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white">
            Shopee Data Explorer
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Pull orders, products, and shop info from your connected Shopee
            store.
          </p>
        </div>
      </div>

      {shopeeConnections.length === 0 && (
        <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 text-amber-800 dark:text-amber-300 text-sm font-medium">
          <AlertCircle className="w-4 h-4 shrink-0" />
          No Shopee connection found. Connect via the{" "}
          <a href="/dashboard" className="underline font-semibold">
            Data Sources
          </a>{" "}
          page.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left config panel */}
        <div className="lg:col-span-1 space-y-5">
          {/* Connection */}
          <div className="bg-white/50 dark:bg-slate-900/50 backdrop-blur-xl border border-white dark:border-slate-700/60 rounded-2xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">
              Connection
            </h2>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
              Shopee Account
            </label>
            <select
              value={connectionId}
              onChange={(e) => setConnectionId(e.target.value)}
              className="w-full text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
            >
              <option value="">Select connection…</option>
              {shopeeConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.sandbox ? "🧪 " : ""}
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Tabs */}
          <div className="bg-white/50 dark:bg-slate-900/50 backdrop-blur-xl border border-white dark:border-slate-700/60 rounded-2xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">
              Data Type
            </h2>
            <div className="flex gap-2">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === t.id
                      ? "bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 border border-orange-200 dark:border-orange-700/50"
                      : "bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-700"
                  }`}
                >
                  <t.icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date range (orders only) */}
          {activeTab === "orders" && (
            <div className="bg-white/50 dark:bg-slate-900/50 backdrop-blur-xl border border-white dark:border-slate-700/60 rounded-2xl p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">
                Filters
              </h2>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
                    Start
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
                    End
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
                  />
                </div>
              </div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
                Order Status
              </label>
              <select
                value={orderStatus}
                onChange={(e) => setOrderStatus(e.target.value)}
                className="w-full text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
              >
                <option value="ALL">All</option>
                <option value="UNPAID">Unpaid</option>
                <option value="READY_TO_SHIP">Ready to Ship</option>
                <option value="PROCESSED">Processed</option>
                <option value="SHIPPED">Shipped</option>
                <option value="COMPLETED">Completed</option>
                <option value="IN_CANCEL">In Cancel</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          )}

          {/* Run button */}
          <button
            onClick={handleRun}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-semibold text-sm transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Fetching…
              </>
            ) : (
              <>
                <Play className="w-4 h-4" /> Fetch Data
              </>
            )}
          </button>
        </div>

        {/* Right results panel */}
        <div className="lg:col-span-2">
          <div className="bg-white/50 dark:bg-slate-900/50 backdrop-blur-xl border border-white dark:border-slate-700/60 rounded-2xl shadow-sm overflow-hidden h-full min-h-[420px] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-700/60 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-800 dark:text-white">
                {activeTab === "orders"
                  ? "Orders"
                  : activeTab === "products"
                  ? "Products"
                  : "Shop Info"}
              </span>
              <div className="flex items-center gap-2">
                {activeTab === "orders" && flatOrders.length > 0 && (
                  <ExportDropdown
                    onCsv={() =>
                      downloadCsv(flatOrders, `shopee_orders_${today()}`)
                    }
                    onExcel={() =>
                      downloadExcel(flatOrders, `shopee_orders_${today()}`)
                    }
                  />
                )}
                {activeTab === "products" && flatProducts.length > 0 && (
                  <ExportDropdown
                    onCsv={() =>
                      downloadCsv(flatProducts, `shopee_products_${today()}`)
                    }
                    onExcel={() =>
                      downloadExcel(flatProducts, `shopee_products_${today()}`)
                    }
                  />
                )}
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {error && (
                <div className="m-5 flex items-start gap-3 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 text-red-700 dark:text-red-300 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              {/* Empty state */}
              {!isLoading &&
                !error &&
                !orders &&
                !products &&
                !shopInfo && (
                  <div className="flex flex-col items-center justify-center h-full py-20 text-center">
                    <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                      <RefreshCw className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                    </div>
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      Select a connection and click{" "}
                      <strong>Fetch Data</strong>
                    </p>
                  </div>
                )}

              {/* Orders table */}
              {activeTab === "orders" && flatOrders.length > 0 && (
                <div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs min-w-[700px]">
                      <thead className="bg-gray-50/80 dark:bg-slate-800/80 sticky top-0">
                        <tr>
                          {Object.keys(flatOrders[0]).map((col) => (
                            <th
                              key={col}
                              className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap border-b border-gray-100 dark:border-slate-700/60"
                            >
                              {col.replace(/_/g, " ")}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-slate-700/40">
                        {flatOrders.map((row, i) => (
                          <tr
                            key={i}
                            className="hover:bg-gray-50/60 dark:hover:bg-slate-800/40 transition-colors"
                          >
                            {Object.values(row).map((val, j) => (
                              <td
                                key={j}
                                className="px-4 py-2.5 text-gray-700 dark:text-gray-300 whitespace-nowrap max-w-[300px] truncate"
                              >
                                {String(val ?? "—")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-5 py-3 flex items-center justify-between border-t border-gray-100 dark:border-slate-700/60">
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {flatOrders.length} orders loaded
                    </p>
                    {orderHasMore && (
                      <button
                        onClick={() => handleFetchOrders(false)}
                        disabled={isLoading}
                        className="flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-700 dark:text-orange-400 transition-colors disabled:opacity-50"
                      >
                        <ChevronDown className="w-3 h-3" /> Load More
                      </button>
                    )}
                  </div>
                </div>
              )}
              {activeTab === "orders" &&
                orders &&
                orders.length === 0 &&
                !isLoading && (
                  <div className="flex flex-col items-center justify-center h-full py-20 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      No orders found for this date range and status.
                    </p>
                  </div>
                )}

              {/* Products table */}
              {activeTab === "products" && flatProducts.length > 0 && (
                <div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs min-w-[700px]">
                      <thead className="bg-gray-50/80 dark:bg-slate-800/80 sticky top-0">
                        <tr>
                          {Object.keys(flatProducts[0]).map((col) => (
                            <th
                              key={col}
                              className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap border-b border-gray-100 dark:border-slate-700/60"
                            >
                              {col.replace(/_/g, " ")}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-slate-700/40">
                        {flatProducts.map((row, i) => (
                          <tr
                            key={i}
                            className="hover:bg-gray-50/60 dark:hover:bg-slate-800/40 transition-colors"
                          >
                            {Object.values(row).map((val, j) => (
                              <td
                                key={j}
                                className="px-4 py-2.5 text-gray-700 dark:text-gray-300 whitespace-nowrap max-w-[300px] truncate"
                              >
                                {String(val ?? "—")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-5 py-3 flex items-center justify-between border-t border-gray-100 dark:border-slate-700/60">
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {flatProducts.length} products loaded
                    </p>
                    {productHasMore && (
                      <button
                        onClick={() => handleFetchProducts(false)}
                        disabled={isLoading}
                        className="flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-700 dark:text-orange-400 transition-colors disabled:opacity-50"
                      >
                        <ChevronDown className="w-3 h-3" /> Load More
                      </button>
                    )}
                  </div>
                </div>
              )}
              {activeTab === "products" &&
                products &&
                products.length === 0 &&
                !isLoading && (
                  <div className="flex flex-col items-center justify-center h-full py-20 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      No products found.
                    </p>
                  </div>
                )}

              {/* Shop info */}
              {activeTab === "shop" && shopInfo && (
                <div className="p-5 space-y-4">
                  <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700/50 rounded-xl p-5">
                    <h3 className="text-sm font-bold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
                      <Store className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                      Shop Details
                    </h3>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      {Object.entries(shopInfo).map(([key, value]) => (
                        <div key={key}>
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            {key.replace(/_/g, " ")}
                          </span>
                          <p className="text-gray-800 dark:text-gray-200 font-medium truncate">
                            {typeof value === "object"
                              ? JSON.stringify(value)
                              : String(value ?? "—")}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Loading state */}
              {isLoading && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Loader2 className="w-8 h-8 text-orange-500 animate-spin mb-4" />
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
                    Fetching data from Shopee…
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
