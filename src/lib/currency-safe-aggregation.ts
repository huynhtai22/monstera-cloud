/**
 * Currency-safe monetary aggregation.
 *
 * Never sums spend/revenue/ROAS inputs across different ISO currencies.
 * Non-monetary counts (impressions, clicks, conversions) may be combined globally.
 */

export const MONETARY_METRIC_IDS = new Set([
  "spend",
  "conversion_value",
  "revenue",
  "cpc",
  "cpm",
  "cpa",
  "roas",
]);

export type MetricRowLike = {
  currency?: string | null;
  spend?: number | null;
  revenue?: number | null;
  impressions?: number | null;
  clicks?: number | null;
  conversions?: number | null;
  reach?: number | null;
};

export type CurrencyMoneyBucket = {
  currency: string;
  spend: number;
  revenue: number;
  roas: number;
  cpc: number;
  cpm: number;
  cpa: number;
};

export type CurrencySafeTotals = {
  mixedCurrency: boolean;
  currencies: string[];
  byCurrency: CurrencyMoneyBucket[];
  impressions: number;
  clicks: number;
  conversions: number;
  reach: number;
};

function normalizeCurrency(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim().toUpperCase();
  return trimmed || "UNKNOWN";
}

function n(value: number | null | undefined): number {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

function safeDiv(num: number, den: number): number {
  return den === 0 ? 0 : num / den;
}

export function aggregateCurrencySafe(rows: MetricRowLike[]): CurrencySafeTotals {
  const money = new Map<string, { spend: number; revenue: number; clicks: number; impressions: number; conversions: number }>();
  let impressions = 0;
  let clicks = 0;
  let conversions = 0;
  let reach = 0;

  for (const row of rows) {
    const currency = normalizeCurrency(row.currency);
    const bucket = money.get(currency) ?? {
      spend: 0,
      revenue: 0,
      clicks: 0,
      impressions: 0,
      conversions: 0,
    };
    bucket.spend += n(row.spend);
    bucket.revenue += n(row.revenue);
    bucket.clicks += n(row.clicks);
    bucket.impressions += n(row.impressions);
    bucket.conversions += n(row.conversions);
    money.set(currency, bucket);

    impressions += n(row.impressions);
    clicks += n(row.clicks);
    conversions += n(row.conversions);
    reach += n(row.reach);
  }

  const byCurrency: CurrencyMoneyBucket[] = [...money.entries()]
    .map(([currency, b]) => ({
      currency,
      spend: b.spend,
      revenue: b.revenue,
      roas: safeDiv(b.revenue, b.spend),
      cpc: safeDiv(b.spend, b.clicks),
      cpm: safeDiv(b.spend, b.impressions) * 1000,
      cpa: safeDiv(b.spend, b.conversions),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  const currencies = byCurrency.map((b) => b.currency);

  return {
    mixedCurrency: currencies.filter((c) => c !== "UNKNOWN").length > 1 || currencies.length > 1,
    currencies,
    byCurrency,
    impressions,
    clicks,
    conversions,
    reach,
  };
}

/** True when a grouped aggregate would mix monetary values unless currency is a group key. */
export function aggregationNeedsCurrencyDimension(
  groupByFields: string[],
  metricIds: string[]
): boolean {
  const wantsMoney = metricIds.some((id) => MONETARY_METRIC_IDS.has(id));
  if (!wantsMoney) return false;
  return !groupByFields.includes("currency");
}

export function formatMoneyAmount(amount: number, currency: string): string {
  const code = normalizeCurrency(currency);
  if (code === "UNKNOWN") {
    return amount.toLocaleString();
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: code === "VND" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString()} ${code}`;
  }
}
