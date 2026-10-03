/**
 * Client-ready reporting and export utilities.
 * Calculates blended agency metrics, cross-channel rollups, and formats client-ready briefs.
 */

export interface MetricRowExport {
  platform: string;
  accountName?: string | null;
  accountId?: string | null;
  campaignName?: string | null;
  campaignId?: string | null;
  connectionId?: string | null;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  roas?: number;
  currency?: string | null;
}

export interface CurrencyBreakdown {
  currency: string;
  spend: number;
  revenue: number;
  conversions: number;
  roas: number;
  cpa: number;
  spendShare: number;
}

export interface OverallKPIs {
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  totalConversions: number;
  totalRevenue: number;
  blendedRoas: number;
  blendedCpa: number;
  blendedCtr: number;
  averageCpc: number;
  currency: string;
  isMixedCurrency: boolean;
  currencyBreakdowns: CurrencyBreakdown[];
}

export interface PlatformRollup {
  platform: string;
  platformLabel: string;
  currency: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  roas: number;
  cpa: number;
  ctr: number;
  cpc: number;
  shareOfSpend: number;
}

export interface CampaignRollup {
  campaignId?: string;
  campaignName: string;
  accountId?: string;
  accountName?: string;
  platform: string;
  platformLabel: string;
  currency: string;
  spend: number;
  conversions: number;
  revenue: number;
  roas: number;
  cpa: number;
}

const PLATFORM_NAMES: Record<string, string> = {
  meta_ads: "Meta Ads",
  tiktok_business: "TikTok Ads",
  google_ads: "Google Ads",
  shopee: "Shopee",
  lazada: "Lazada",
  shopify: "Shopify",
  amazon: "Amazon",
};

export function getPlatformLabel(platform: string): string {
  return PLATFORM_NAMES[platform] || platform;
}

export function formatCurrencyValue(amount: number, currency: string = "USD"): string {
  const c = currency.trim().toUpperCase() || "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: c,
      maximumFractionDigits: c === "VND" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${c}`;
  }
}

export function calculateOverallKPIs(rows: MetricRowExport[]): OverallKPIs {
  const currencyMap = new Map<string, {
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
  }>();

  for (const r of rows) {
    const c = (r.currency || "").trim().toUpperCase() || "USD";
    const cur = currencyMap.get(c) || { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
    cur.spend += r.spend ?? 0;
    cur.impressions += r.impressions ?? 0;
    cur.clicks += r.clicks ?? 0;
    cur.conversions += r.conversions ?? 0;
    cur.revenue += r.revenue ?? 0;
    currencyMap.set(c, cur);
  }

  const isMixedCurrency = currencyMap.size > 1;
  const currencyBreakdowns: CurrencyBreakdown[] = [];

  for (const [curr, d] of currencyMap.entries()) {
    const roas = d.spend > 0 ? d.revenue / d.spend : 0;
    const cpa = d.conversions > 0 ? d.spend / d.conversions : 0;
    currencyBreakdowns.push({
      currency: curr,
      spend: d.spend,
      revenue: d.revenue,
      conversions: d.conversions,
      roas,
      cpa,
      spendShare: 0,
    });
  }
  currencyBreakdowns.sort((a, b) => b.spend - a.spend);

  const totalImpressions = rows.reduce((s, r) => s + (r.impressions ?? 0), 0);
  const totalClicks = rows.reduce((s, r) => s + (r.clicks ?? 0), 0);
  const totalConversions = rows.reduce((s, r) => s + (r.conversions ?? 0), 0);
  const blendedCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  if (isMixedCurrency) {
    return {
      totalSpend: 0,
      totalImpressions,
      totalClicks,
      totalConversions,
      totalRevenue: 0,
      blendedRoas: 0,
      blendedCpa: 0,
      blendedCtr,
      averageCpc: 0,
      currency: "MIXED",
      isMixedCurrency: true,
      currencyBreakdowns,
    };
  }

  const single = currencyBreakdowns[0] || {
    currency: "USD",
    spend: 0,
    revenue: 0,
    conversions: 0,
    roas: 0,
    cpa: 0,
    spendShare: 100,
  };

  const averageCpc = totalClicks > 0 ? single.spend / totalClicks : 0;

  return {
    totalSpend: single.spend,
    totalImpressions,
    totalClicks,
    totalConversions,
    totalRevenue: single.revenue,
    blendedRoas: single.roas,
    blendedCpa: single.cpa,
    blendedCtr,
    averageCpc,
    currency: single.currency,
    isMixedCurrency: false,
    currencyBreakdowns,
  };
}

export function calculatePlatformRollups(rows: MetricRowExport[]): PlatformRollup[] {
  const groups = new Map<string, {
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
    currencies: Set<string>;
  }>();

  for (const r of rows) {
    const p = r.platform || "unknown";
    const existing = groups.get(p) || {
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      revenue: 0,
      currencies: new Set<string>(),
    };
    existing.spend += r.spend ?? 0;
    existing.impressions += r.impressions ?? 0;
    existing.clicks += r.clicks ?? 0;
    existing.conversions += r.conversions ?? 0;
    existing.revenue += r.revenue ?? 0;
    if (r.currency) existing.currencies.add(r.currency.trim().toUpperCase());
    groups.set(p, existing);
  }

  // Calculate total spend across single-currency dataset or nominal
  const totalSpend = rows.reduce((s, r) => s + (r.spend ?? 0), 0);

  const result: PlatformRollup[] = [];
  for (const [platform, data] of groups.entries()) {
    const roas = data.spend > 0 ? data.revenue / data.spend : 0;
    const cpa = data.conversions > 0 ? data.spend / data.conversions : 0;
    const ctr = data.impressions > 0 ? (data.clicks / data.impressions) * 100 : 0;
    const cpc = data.clicks > 0 ? data.spend / data.clicks : 0;
    const shareOfSpend = totalSpend > 0 ? (data.spend / totalSpend) * 100 : 0;
    const cur = data.currencies.size === 1 ? [...data.currencies][0] : data.currencies.size > 1 ? "MIXED" : "USD";

    result.push({
      platform,
      platformLabel: getPlatformLabel(platform),
      currency: cur,
      spend: data.spend,
      impressions: data.impressions,
      clicks: data.clicks,
      conversions: data.conversions,
      revenue: data.revenue,
      roas,
      cpa,
      ctr,
      cpc,
      shareOfSpend,
    });
  }

  // Sort by spend descending
  return result.sort((a, b) => b.spend - a.spend);
}

export function calculateCampaignRollups(rows: MetricRowExport[], limit: number = 20): CampaignRollup[] {
  const map = new Map<string, {
    campaignId?: string;
    campaignName: string;
    accountId?: string;
    accountName?: string;
    platform: string;
    currency: string;
    spend: number;
    conversions: number;
    revenue: number;
  }>();

  for (const r of rows) {
    const name = (r.campaignName || r.campaignId || "Uncategorized").trim();
    const p = r.platform || "unknown";
    const acc = (r.accountId || r.accountName || "default_acc").trim();
    const campId = (r.campaignId || name).trim();
    const cur = (r.currency || "USD").trim().toUpperCase();

    // Stable identity combining platform, account, campaign ID/name, and currency
    const key = `${p}:::${acc}:::${campId}:::${cur}`;
    const existing = map.get(key) || {
      campaignId: r.campaignId || undefined,
      campaignName: name,
      accountId: r.accountId || undefined,
      accountName: r.accountName || undefined,
      platform: p,
      currency: cur,
      spend: 0,
      conversions: 0,
      revenue: 0,
    };
    existing.spend += r.spend ?? 0;
    existing.conversions += r.conversions ?? 0;
    existing.revenue += r.revenue ?? 0;
    map.set(key, existing);
  }

  const result: CampaignRollup[] = [];
  for (const data of map.values()) {
    const roas = data.spend > 0 ? data.revenue / data.spend : 0;
    const cpa = data.conversions > 0 ? data.spend / data.conversions : 0;
    result.push({
      campaignId: data.campaignId,
      campaignName: data.campaignName,
      accountId: data.accountId,
      accountName: data.accountName,
      platform: data.platform,
      platformLabel: getPlatformLabel(data.platform),
      currency: data.currency,
      spend: data.spend,
      conversions: data.conversions,
      revenue: data.revenue,
      roas,
      cpa,
    });
  }

  return result.sort((a, b) => b.spend - a.spend).slice(0, limit);
}

/**
 * Format a client brief ready to be copied and pasted directly to clients
 * on messaging apps (Slack, Telegram, WhatsApp, Email).
 */
export function generateClientBriefMarkdown(params: {
  overall: OverallKPIs;
  platformRollups: PlatformRollup[];
  campaignRollups?: CampaignRollup[];
  dateRange: { start: string; end: string };
  dataThrough?: string | null;
  clientName?: string;
  isPartialData?: boolean;
  totalRecordsLoaded?: number;
}): string {
  const { overall, platformRollups, campaignRollups, dateRange, dataThrough, clientName, isPartialData, totalRecordsLoaded } = params;

  const header = clientName
    ? `📊 **Performance Summary — ${clientName}**`
    : `📊 **Weekly Marketing Performance Summary**`;

  const dateParts: string[] = [
    `📅 **Period:** ${dateRange.start || "Start"} to ${dateRange.end || "End"}`
  ];
  if (dataThrough) {
    dateParts.push(`*(Data verified through ${dataThrough})*`);
  }
  if (isPartialData && totalRecordsLoaded) {
    dateParts.push(`\n⚠️ *Note: Summary based on ${totalRecordsLoaded.toLocaleString()} loaded records (partial page)*`);
  }
  const dateLine = dateParts.join(" ");

  let kpis: string;
  if (overall.isMixedCurrency && overall.currencyBreakdowns && overall.currencyBreakdowns.length > 0) {
    const currencyLines = overall.currencyBreakdowns.map((cb) => {
      const spendStr = formatCurrencyValue(cb.spend, cb.currency);
      const revStr = formatCurrencyValue(cb.revenue, cb.currency);
      const roasStr = cb.roas > 0 ? `${cb.roas.toFixed(2)}x` : "—";
      const cpaStr = cb.cpa > 0 ? formatCurrencyValue(cb.cpa, cb.currency) : "—";
      return `• **${cb.currency}:** Spend ${spendStr} · Rev ${revStr} · ROAS ${roasStr} · CPA ${cpaStr} (${cb.conversions.toLocaleString()} conv)`;
    });
    kpis = [
      `💰 **Financial Performance (by Currency):**`,
      ...currencyLines,
      `🎯 **Total Conversions:** ${overall.totalConversions.toLocaleString()}`,
      `👆 **Traffic:** ${overall.totalClicks.toLocaleString()} clicks · **CTR:** ${overall.blendedCtr.toFixed(2)}%`,
    ].join("\n");
  } else {
    const cur = overall.currency;
    kpis = [
      `💰 **Total Ad Spend:** ${formatCurrencyValue(overall.totalSpend, cur)}`,
      `🎯 **Conversions:** ${overall.totalConversions.toLocaleString()} · **Blended CPA:** ${overall.blendedCpa > 0 ? formatCurrencyValue(overall.blendedCpa, cur) : "—"}`,
      `📈 **Attributed Revenue:** ${formatCurrencyValue(overall.totalRevenue, cur)} · **Blended ROAS:** ${overall.blendedRoas > 0 ? `${overall.blendedRoas.toFixed(2)}x` : "—"}`,
      `👆 **Traffic:** ${overall.totalClicks.toLocaleString()} clicks · **CTR:** ${overall.blendedCtr.toFixed(2)}% · **CPC:** ${formatCurrencyValue(overall.averageCpc, cur)}`,
    ].join("\n");
  }

  const platformLines = platformRollups.length > 0
    ? [
        `\n**Platform Breakdown:**`,
        ...platformRollups.map((p) => {
          const pCur = p.currency && p.currency !== "MIXED" ? p.currency : overall.currency;
          const spendStr = formatCurrencyValue(p.spend, pCur);
          const roasStr = p.roas > 0 ? `${p.roas.toFixed(2)}x ROAS` : "—";
          const cpaStr = p.cpa > 0 ? `${formatCurrencyValue(p.cpa, pCur)} CPA` : "—";
          const shareStr = p.shareOfSpend > 0 ? ` (${p.shareOfSpend.toFixed(1)}%)` : "";
          return `• **${p.platformLabel}:** ${spendStr}${shareStr} | ${p.conversions} conv (${cpaStr}) | ${roasStr}`;
        }),
      ].join("\n")
    : "";

  const topCampaigns = (campaignRollups && campaignRollups.length > 0)
    ? [
        `\n**Top Campaigns by Spend:**`,
        ...campaignRollups.slice(0, 5).map((c, i) => {
          const cCur = c.currency && c.currency !== "MIXED" ? c.currency : overall.currency;
          const spendStr = formatCurrencyValue(c.spend, cCur);
          const roasStr = c.roas > 0 ? `${c.roas.toFixed(2)}x ROAS` : "—";
          const accSuffix = c.accountName ? ` (${c.accountName})` : "";
          return `${i + 1}. **${c.campaignName}**${accSuffix} [${c.platformLabel}]: ${spendStr} · ${c.conversions} conv · ${roasStr}`;
        }),
      ].join("\n")
    : "";

  const footer = `\n---\n*Report generated by Monstera Cloud*`;

  return [header, dateLine, "", kpis, platformLines, topCampaigns, footer].filter(Boolean).join("\n");
}
