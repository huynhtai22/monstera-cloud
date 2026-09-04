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
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  roas?: number;
  currency?: string | null;
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
}

export interface PlatformRollup {
  platform: string;
  platformLabel: string;
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
  campaignName: string;
  platform: string;
  platformLabel: string;
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
  const totalSpend = rows.reduce((s, r) => s + (r.spend ?? 0), 0);
  const totalImpressions = rows.reduce((s, r) => s + (r.impressions ?? 0), 0);
  const totalClicks = rows.reduce((s, r) => s + (r.clicks ?? 0), 0);
  const totalConversions = rows.reduce((s, r) => s + (r.conversions ?? 0), 0);
  const totalRevenue = rows.reduce((s, r) => s + (r.revenue ?? 0), 0);

  const blendedRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const blendedCpa = totalConversions > 0 ? totalSpend / totalConversions : 0;
  const blendedCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const averageCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;

  // Determine dominant currency
  const currencyCounts = new Map<string, number>();
  for (const r of rows) {
    const c = (r.currency || "").trim().toUpperCase();
    if (c) currencyCounts.set(c, (currencyCounts.get(c) || 0) + 1);
  }
  let dominantCurrency = "USD";
  let maxCount = 0;
  for (const [cur, cnt] of currencyCounts.entries()) {
    if (cnt > maxCount) {
      maxCount = cnt;
      dominantCurrency = cur;
    }
  }

  return {
    totalSpend,
    totalImpressions,
    totalClicks,
    totalConversions,
    totalRevenue,
    blendedRoas,
    blendedCpa,
    blendedCtr,
    averageCpc,
    currency: dominantCurrency,
  };
}

export function calculatePlatformRollups(rows: MetricRowExport[]): PlatformRollup[] {
  const groups = new Map<string, {
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
  }>();

  for (const r of rows) {
    const p = r.platform || "unknown";
    const existing = groups.get(p) || { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
    existing.spend += r.spend ?? 0;
    existing.impressions += r.impressions ?? 0;
    existing.clicks += r.clicks ?? 0;
    existing.conversions += r.conversions ?? 0;
    existing.revenue += r.revenue ?? 0;
    groups.set(p, existing);
  }

  const totalSpend = rows.reduce((s, r) => s + (r.spend ?? 0), 0);

  const result: PlatformRollup[] = [];
  for (const [platform, data] of groups.entries()) {
    const roas = data.spend > 0 ? data.revenue / data.spend : 0;
    const cpa = data.conversions > 0 ? data.spend / data.conversions : 0;
    const ctr = data.impressions > 0 ? (data.clicks / data.impressions) * 100 : 0;
    const cpc = data.clicks > 0 ? data.spend / data.clicks : 0;
    const shareOfSpend = totalSpend > 0 ? (data.spend / totalSpend) * 100 : 0;

    result.push({
      platform,
      platformLabel: getPlatformLabel(platform),
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
    campaignName: string;
    platform: string;
    spend: number;
    conversions: number;
    revenue: number;
  }>();

  for (const r of rows) {
    const name = (r.campaignName || r.campaignId || "Uncategorized").trim();
    const p = r.platform || "unknown";
    const key = `${p}:::${name}`;
    const existing = map.get(key) || { campaignName: name, platform: p, spend: 0, conversions: 0, revenue: 0 };
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
      campaignName: data.campaignName,
      platform: data.platform,
      platformLabel: getPlatformLabel(data.platform),
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
}): string {
  const { overall, platformRollups, campaignRollups, dateRange, dataThrough, clientName } = params;
  const cur = overall.currency;

  const header = clientName
    ? `📊 **Performance Summary — ${clientName}**`
    : `📊 **Weekly Marketing Performance Summary**`;

  const dateLine = dataThrough
    ? `📅 **Period:** ${dateRange.start || "Start"} to ${dateRange.end || "End"} *(Data verified through ${dataThrough})*`
    : `📅 **Period:** ${dateRange.start || "Start"} to ${dateRange.end || "End"}`;

  const kpis = [
    `💰 **Total Ad Spend:** ${formatCurrencyValue(overall.totalSpend, cur)}`,
    `🎯 **Conversions:** ${overall.totalConversions.toLocaleString()} · **Blended CPA:** ${overall.blendedCpa > 0 ? formatCurrencyValue(overall.blendedCpa, cur) : "—"}`,
    `📈 **Attributed Revenue:** ${formatCurrencyValue(overall.totalRevenue, cur)} · **Blended ROAS:** ${overall.blendedRoas > 0 ? `${overall.blendedRoas.toFixed(2)}x` : "—"}`,
    `👆 **Traffic:** ${overall.totalClicks.toLocaleString()} clicks · **CTR:** ${overall.blendedCtr.toFixed(2)}% · **CPC:** ${formatCurrencyValue(overall.averageCpc, cur)}`,
  ].join("\n");

  const platformLines = platformRollups.length > 0
    ? [
        `\n**Platform Breakdown:**`,
        ...platformRollups.map((p) => {
          const spendStr = formatCurrencyValue(p.spend, cur);
          const roasStr = p.roas > 0 ? `${p.roas.toFixed(2)}x ROAS` : "—";
          const cpaStr = p.cpa > 0 ? `${formatCurrencyValue(p.cpa, cur)} CPA` : "—";
          return `• **${p.platformLabel}:** ${spendStr} (${p.shareOfSpend.toFixed(1)}%) | ${p.conversions} conv (${cpaStr}) | ${roasStr}`;
        }),
      ].join("\n")
    : "";

  const topCampaigns = (campaignRollups && campaignRollups.length > 0)
    ? [
        `\n**Top Campaigns by Spend:**`,
        ...campaignRollups.slice(0, 5).map((c, i) => {
          const spendStr = formatCurrencyValue(c.spend, cur);
          const roasStr = c.roas > 0 ? `${c.roas.toFixed(2)}x ROAS` : "—";
          return `${i + 1}. **${c.campaignName}** [${c.platformLabel}]: ${spendStr} · ${c.conversions} conv · ${roasStr}`;
        }),
      ].join("\n")
    : "";

  const footer = `\n---\n*Report generated by Monstera Cloud*`;

  return [header, dateLine, "", kpis, platformLines, topCampaigns, footer].filter(Boolean).join("\n");
}
