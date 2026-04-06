"use client";

import React, { useState, useMemo } from "react";
import Image from "next/image";
import {
  Loader2,
  Play,
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
import { IntegrationPageLayout, inputFocus } from "@/components/ui/IntegrationPageLayout";
import { IntegrationSectionCard } from "@/components/ui/IntegrationSectionCard";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { cn } from "@/lib/utils";

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

const selectClass = cn(
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white",
  inputFocus
);

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

  const [orders, setOrders] = useState<any[] | null>(null);
  const [orderCursor, setOrderCursor] = useState("");
  const [orderHasMore, setOrderHasMore] = useState(false);

  const [products, setProducts] = useState<any[] | null>(null);
  const [productOffset, setProductOffset] = useState(0);
  const [productHasMore, setProductHasMore] = useState(false);

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

  const resultsTitle =
    activeTab === "orders"
      ? "Orders"
      : activeTab === "products"
        ? "Products"
        : "Shop Info";

  const leftColumn = (
    <>
      <IntegrationSectionCard title="Connection">
        <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
          Shopee Account
        </label>
        <select
          value={connectionId}
          onChange={(e) => setConnectionId(e.target.value)}
          className={selectClass}
        >
          <option value="">Select connection…</option>
          {shopeeConnections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.sandbox ? "🧪 " : ""}
              {c.name}
            </option>
          ))}
        </select>
      </IntegrationSectionCard>

      <IntegrationSectionCard title="Data Type">
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                activeTab === t.id
                  ? "border-primary-ring/40 bg-primary-muted text-primary-hover dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-400 dark:hover:bg-slate-700"
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </IntegrationSectionCard>

      {activeTab === "orders" && (
        <IntegrationSectionCard title="Filters">
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                Start
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={selectClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                End
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={selectClass}
              />
            </div>
          </div>
          <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
            Order Status
          </label>
          <select
            value={orderStatus}
            onChange={(e) => setOrderStatus(e.target.value)}
            className={selectClass}
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
        </IntegrationSectionCard>
      )}
    </>
  );

  const resultsHeader = (
    <>
      <span className="text-sm font-semibold text-gray-800 dark:text-white">
        {resultsTitle}
      </span>
      <div className="flex items-center gap-2">
        {activeTab === "orders" && flatOrders.length > 0 && (
          <ExportDropdown
            onCsv={() => downloadCsv(flatOrders, `shopee_orders_${today()}`)}
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
    </>
  );

  const resultsBody = (
    <>
      {error && (
        <div className="m-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700/50 dark:bg-red-900/20 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {!isLoading &&
        !error &&
        !orders &&
        !products &&
        !shopInfo && (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-slate-800">
              <RefreshCw className="h-5 w-5 text-gray-400 dark:text-gray-500" />
            </div>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
              Select a connection and click <strong>Fetch Data</strong>
            </p>
          </div>
        )}

      {activeTab === "orders" && flatOrders.length > 0 && (
        <div>
          <div className="overflow-x-auto">
            <table className="min-w-[700px] w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-gray-50/80 dark:bg-slate-800/80">
                <tr>
                  {Object.keys(flatOrders[0]).map((col) => (
                    <th
                      key={col}
                      className="whitespace-nowrap border-b border-gray-100 px-4 py-3 font-semibold uppercase tracking-wider text-gray-600 dark:border-slate-700/60 dark:text-gray-300"
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
                    className="transition-colors hover:bg-gray-50/60 dark:hover:bg-slate-800/40"
                  >
                    {Object.values(row).map((val, j) => (
                      <td
                        key={j}
                        className="max-w-[300px] truncate whitespace-nowrap px-4 py-2.5 text-gray-700 dark:text-gray-300"
                      >
                        {String(val ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 dark:border-slate-700/60">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {flatOrders.length} orders loaded
            </p>
            {orderHasMore && (
              <button
                type="button"
                onClick={() => handleFetchOrders(false)}
                disabled={isLoading}
                className="flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-primary-hover disabled:opacity-50 dark:text-emerald-400"
              >
                <ChevronDown className="h-3 w-3" /> Load More
              </button>
            )}
          </div>
        </div>
      )}
      {activeTab === "orders" &&
        orders &&
        orders.length === 0 &&
        !isLoading && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No orders found for this date range and status.
            </p>
          </div>
        )}

      {activeTab === "products" && flatProducts.length > 0 && (
        <div>
          <div className="overflow-x-auto">
            <table className="min-w-[700px] w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-gray-50/80 dark:bg-slate-800/80">
                <tr>
                  {Object.keys(flatProducts[0]).map((col) => (
                    <th
                      key={col}
                      className="whitespace-nowrap border-b border-gray-100 px-4 py-3 font-semibold uppercase tracking-wider text-gray-600 dark:border-slate-700/60 dark:text-gray-300"
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
                    className="transition-colors hover:bg-gray-50/60 dark:hover:bg-slate-800/40"
                  >
                    {Object.values(row).map((val, j) => (
                      <td
                        key={j}
                        className="max-w-[300px] truncate whitespace-nowrap px-4 py-2.5 text-gray-700 dark:text-gray-300"
                      >
                        {String(val ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 dark:border-slate-700/60">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {flatProducts.length} products loaded
            </p>
            {productHasMore && (
              <button
                type="button"
                onClick={() => handleFetchProducts(false)}
                disabled={isLoading}
                className="flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-primary-hover disabled:opacity-50 dark:text-emerald-400"
              >
                <ChevronDown className="h-3 w-3" /> Load More
              </button>
            )}
          </div>
        </div>
      )}
      {activeTab === "products" &&
        products &&
        products.length === 0 &&
        !isLoading && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No products found.
            </p>
          </div>
        )}

      {activeTab === "shop" && shopInfo && (
        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-gray-200 bg-primary-muted/40 p-5 dark:border-slate-600 dark:bg-emerald-950/20">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-white">
              <Store className="h-4 w-4 text-primary dark:text-emerald-400" />
              Shop Details
            </h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {Object.entries(shopInfo).map(([key, value]) => (
                <div key={key}>
                  <span className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    {key.replace(/_/g, " ")}
                  </span>
                  <p className="truncate font-medium text-gray-800 dark:text-gray-200">
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

      {isLoading && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary dark:text-emerald-400" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
            Fetching data from Shopee…
          </p>
        </div>
      )}
    </>
  );

  return (
    <IntegrationPageLayout
      title="Shopee Data Explorer"
      description="Pull orders, products, and shop info from your connected Shopee store."
      icon={
        <Image src="/logos/shopee.svg" alt="Shopee" width={22} height={22} />
      }
      banner={
        shopeeConnections.length === 0 ? (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            No Shopee connection found. Connect via the{" "}
            <a href="/console" className="font-semibold underline">
              Data Sources
            </a>{" "}
            page.
          </div>
        ) : null
      }
      leftColumn={leftColumn}
      primaryAction={
        <PrimaryButton
          className="w-full py-3"
          onClick={handleRun}
          disabled={isLoading}
          loading={isLoading}
        >
          {isLoading ? (
            "Fetching…"
          ) : (
            <>
              <Play className="h-4 w-4" /> Fetch Data
            </>
          )}
        </PrimaryButton>
      }
      resultsHeader={resultsHeader}
      results={resultsBody}
    />
  );
}
