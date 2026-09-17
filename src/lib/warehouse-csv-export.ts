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

/**
 * Spreadsheet formula-injection guard for untrusted TEXT values.
 *
 * Numbers (including negative metrics) pass through untouched: only strings
 * are ever prefixed, so numeric fields can never be corrupted by this
 * policy. A leading `'`, tab, or carriage return also triggers escaping.
 * Consumers rendering JSON arrays into grids must apply the same rule.
 */
export function escapeSpreadsheetText(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    // Large integers stay exact: never route through float formatting that
    // could render exponent notation or lose precision.
    return Number.isInteger(value) ? String(value) : String(value);
  }
  const text = escapeSpreadsheetText(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Serializes header + row arrays to RFC 4180 CSV text (UTF-8, `\n` line
 * endings). Quoting, embedded quotes/CR/LF, and formula-bearing text are
 * handled here so every server CSV response shares one audited path.
 */
export function toCsvText(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\n");
}
