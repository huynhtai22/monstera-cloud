export type WarehouseAdMetric = {
  date: Date;
  campaignName: string;
  impressions: number;
  clicks: number;
  spend: number;
  cpc: number;
  ctr: number;
  conversions: number;
  revenue: number;
  roas: number;
  currency: string | null;
};

export type WarehouseRetailOrder = {
  orderId: string;
  platform: string;
  grossRevenue: number;
  netRevenue: number | null;
  currency: string;
  createdAtIso: string;
};

export function warehouseAdsCsvRows(metrics: WarehouseAdMetric[]): Array<Array<string | number>> {
  return [
    ["Date", "Campaign", "Impressions", "Clicks", "Spend", "CPC", "CTR", "Conversions", "Revenue", "ROAS", "Currency"],
    ...metrics.map((m) => [m.date.toISOString().slice(0, 10), m.campaignName, m.impressions, m.clicks, m.spend, m.cpc, m.ctr, m.conversions, m.revenue, m.roas, m.currency ?? "UNKNOWN"]),
  ];
}

export function warehouseRetailOrdersCsvRows(orders: WarehouseRetailOrder[]): Array<Array<string | number>> {
  return [
    ["Order ID", "Platform", "Gross Revenue", "Net Revenue", "Currency", "Created At"],
    ...orders.map((order) => [order.orderId, order.platform, order.grossRevenue, order.netRevenue ?? "", order.currency, order.createdAtIso]),
  ];
}
