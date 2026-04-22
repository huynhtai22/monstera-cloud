/**
 * TEMPLATES: Pre-built Dashboard Templates
 * Ready-to-use dashboard configurations for common use cases
 */

export interface DashboardWidget {
  id: string;
  type: "metric" | "chart" | "table" | "funnel" | "comparison";
  title: string;
  dataSource: string; // campaign_metrics | orders | attribution | sync_logs
  metric: string;
  dimensions?: string[];
  filters?: Record<string, any>;
  chartType?: "line" | "bar" | "pie" | "funnel" | "table";
  timeRange?: "today" | "yesterday" | "last_7_days" | "last_30_days" | "last_90_days";
  comparison?: "previous_period" | "year_over_year";
}

export interface DashboardTemplate {
  slug: string;
  name: string;
  description: string;
  category: "ads" | "marketplace" | "analytics" | "agency";
  icon: string;
  requiredSources: string[];
  requiredMetrics: string[];
  widgets: DashboardWidget[];
  defaultFilters: {
    dateRange: string;
    platforms?: string[];
  };
  isFeatured: boolean;
  sortOrder: number;
}

/**
 * Featured Templates Library
 */
export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  // META ADS
  {
    slug: "meta-ads-performance",
    name: "Meta Ads Performance",
    description: "Complete Facebook & Instagram Ads dashboard with ROAS, CPA, and funnel metrics",
    category: "ads",
    icon: "/logos/meta.svg",
    requiredSources: ["meta_ads"],
    requiredMetrics: ["spend", "impressions", "clicks", "conversions", "revenue"],
    widgets: [
      {
        id: "meta_roas",
        type: "metric",
        title: "ROAS",
        dataSource: "attribution",
        metric: "roas",
        timeRange: "last_30_days",
        comparison: "previous_period",
      },
      {
        id: "meta_spend",
        type: "metric",
        title: "Ad Spend",
        dataSource: "campaign_metrics",
        metric: "spend",
        timeRange: "last_30_days",
        comparison: "previous_period",
      },
      {
        id: "meta_trend",
        type: "chart",
        title: "Spend vs Revenue Trend",
        dataSource: "campaign_metrics",
        metric: "spend",
        chartType: "line",
        timeRange: "last_30_days",
      },
      {
        id: "meta_funnel",
        type: "funnel",
        title: "Campaign Funnel",
        dataSource: "campaign_metrics",
        metric: "conversions",
        dimensions: ["impressions", "clicks", "conversions"],
      },
      {
        id: "meta_top_campaigns",
        type: "table",
        title: "Top Campaigns by ROAS",
        dataSource: "campaign_metrics",
        metric: "roas",
        chartType: "table",
        timeRange: "last_30_days",
      },
    ],
    defaultFilters: {
      dateRange: "last_30_days",
      platforms: ["meta_ads"],
    },
    isFeatured: true,
    sortOrder: 1,
  },

  // GOOGLE ADS
  {
    slug: "google-ads-search",
    name: "Google Ads Search Performance",
    description: "Search campaign performance with keyword insights and conversion tracking",
    category: "ads",
    icon: "/logos/google-ads.svg",
    requiredSources: ["google_ads"],
    requiredMetrics: ["spend", "impressions", "clicks", "conversions", "cpc"],
    widgets: [
      {
        id: "google_ctr",
        type: "metric",
        title: "CTR",
        dataSource: "campaign_metrics",
        metric: "ctr",
        timeRange: "last_30_days",
      },
      {
        id: "google_cpc",
        type: "metric",
        title: "Avg CPC",
        dataSource: "campaign_metrics",
        metric: "cpc",
        timeRange: "last_30_days",
      },
      {
        id: "google_conversion_value",
        type: "metric",
        title: "Conversion Value",
        dataSource: "campaign_metrics",
        metric: "revenue",
        timeRange: "last_30_days",
      },
      {
        id: "google_trend",
        type: "chart",
        title: "Clicks & Conversions",
        dataSource: "campaign_metrics",
        metric: "clicks",
        chartType: "line",
        timeRange: "last_30_days",
      },
    ],
    defaultFilters: {
      dateRange: "last_30_days",
      platforms: ["google_ads"],
    },
    isFeatured: true,
    sortOrder: 2,
  },

  // TIKTOK ADS
  {
    slug: "tiktok-ads-roi",
    name: "TikTok Ads ROI Dashboard",
    description: "TikTok Marketing API performance with video metrics and engagement rates",
    category: "ads",
    icon: "/logos/tiktok.svg",
    requiredSources: ["tiktok_business"],
    requiredMetrics: ["spend", "impressions", "clicks", "video_views", "conversions"],
    widgets: [
      {
        id: "tiktok_roas",
        type: "metric",
        title: "ROAS",
        dataSource: "attribution",
        metric: "roas",
        timeRange: "last_30_days",
      },
      {
        id: "tiktok_spend",
        type: "metric",
        title: "Spend",
        dataSource: "campaign_metrics",
        metric: "spend",
        timeRange: "last_30_days",
      },
      {
        id: "tiktok_engagement",
        type: "chart",
        title: "Engagement Rate Trend",
        dataSource: "campaign_metrics",
        metric: "ctr",
        chartType: "line",
        timeRange: "last_30_days",
      },
    ],
    defaultFilters: {
      dateRange: "last_30_days",
      platforms: ["tiktok_business"],
    },
    isFeatured: true,
    sortOrder: 3,
  },

  // SHOPEE
  {
    slug: "shopee-sales-analytics",
    name: "Shopee Sales Analytics",
    description: "Complete Shopee shop performance with orders, revenue, and product insights",
    category: "marketplace",
    icon: "/logos/shopee.svg",
    requiredSources: ["shopee"],
    requiredMetrics: ["orders", "revenue", "products", "customers"],
    widgets: [
      {
        id: "shopee_revenue",
        type: "metric",
        title: "Revenue",
        dataSource: "orders",
        metric: "netRevenue",
        timeRange: "last_30_days",
        comparison: "previous_period",
      },
      {
        id: "shopee_orders",
        type: "metric",
        title: "Orders",
        dataSource: "orders",
        metric: "orderCount",
        timeRange: "last_30_days",
      },
      {
        id: "shopee_aov",
        type: "metric",
        title: "AOV",
        dataSource: "orders",
        metric: "aov",
        timeRange: "last_30_days",
      },
      {
        id: "shopee_trend",
        type: "chart",
        title: "Daily Revenue",
        dataSource: "orders",
        metric: "netRevenue",
        chartType: "line",
        timeRange: "last_30_days",
      },
      {
        id: "shopee_top_products",
        type: "table",
        title: "Top Products",
        dataSource: "orders",
        metric: "netRevenue",
        chartType: "table",
        timeRange: "last_30_days",
      },
    ],
    defaultFilters: {
      dateRange: "last_30_days",
      platforms: ["shopee"],
    },
    isFeatured: true,
    sortOrder: 4,
  },

  // TIKTOK SHOP
  {
    slug: "tiktok-shop-performance",
    name: "TikTok Shop Performance",
    description: "TikTok Shop analytics with live selling metrics and product performance",
    category: "marketplace",
    icon: "/logos/tiktok-shop.svg",
    requiredSources: ["tiktok_shop"],
    requiredMetrics: ["orders", "revenue", "products", "live_views"],
    widgets: [
      {
        id: "ttshop_revenue",
        type: "metric",
        title: "Revenue",
        dataSource: "orders",
        metric: "netRevenue",
        timeRange: "last_30_days",
      },
      {
        id: "ttshop_orders",
        type: "metric",
        title: "Orders",
        dataSource: "orders",
        metric: "orderCount",
        timeRange: "last_30_days",
      },
      {
        id: "ttshop_trend",
        type: "chart",
        title: "Orders Trend",
        dataSource: "orders",
        metric: "orderCount",
        chartType: "line",
        timeRange: "last_30_days",
      },
    ],
    defaultFilters: {
      dateRange: "last_30_days",
      platforms: ["tiktok_shop"],
    },
    isFeatured: false,
    sortOrder: 5,
  },

  // CROSS-PLATFORM (Blended)
  {
    slug: "blended-roas",
    name: "Blended ROAS Dashboard",
    description: "Unified view of ad spend and revenue across all platforms with true ROAS calculation",
    category: "analytics",
    icon: "/logos/analytics.svg",
    requiredSources: ["meta_ads", "google_ads", "tiktok_business"],
    requiredMetrics: ["spend", "attributed_revenue", "roas"],
    widgets: [
      {
        id: "blended_roas",
        type: "metric",
        title: "Blended ROAS",
        dataSource: "attribution",
        metric: "roas",
        timeRange: "last_30_days",
        comparison: "previous_period",
      },
      {
        id: "blended_spend",
        type: "metric",
        title: "Total Ad Spend",
        dataSource: "campaign_metrics",
        metric: "spend",
        timeRange: "last_30_days",
      },
      {
        id: "blended_revenue",
        type: "metric",
        title: "Attributed Revenue",
        dataSource: "attribution",
        metric: "attributedRevenue",
        timeRange: "last_30_days",
      },
      {
        id: "platform_comparison",
        type: "comparison",
        title: "Platform Comparison",
        dataSource: "campaign_metrics",
        metric: "roas",
        dimensions: ["platform"],
        timeRange: "last_30_days",
      },
      {
        id: "spend_breakdown",
        type: "chart",
        title: "Spend by Platform",
        dataSource: "campaign_metrics",
        metric: "spend",
        chartType: "pie",
        dimensions: ["platform"],
        timeRange: "last_30_days",
      },
    ],
    defaultFilters: {
      dateRange: "last_30_days",
      platforms: ["meta_ads", "google_ads", "tiktok_business"],
    },
    isFeatured: true,
    sortOrder: 0,
  },

  // AGENCY VIEW
  {
    slug: "agency-client-overview",
    name: "Agency Client Overview",
    description: "Multi-client dashboard showing key metrics across all managed accounts",
    category: "agency",
    icon: "/icons/agency.svg",
    requiredSources: [],
    requiredMetrics: ["spend", "revenue", "roas"],
    widgets: [
      {
        id: "agency_total_clients",
        type: "metric",
        title: "Active Clients",
        dataSource: "clients",
        metric: "count",
      },
      {
        id: "agency_total_spend",
        type: "metric",
        title: "Total Ad Spend",
        dataSource: "campaign_metrics",
        metric: "spend",
        timeRange: "last_30_days",
      },
      {
        id: "agency_blended_roas",
        type: "metric",
        title: "Blended ROAS",
        dataSource: "attribution",
        metric: "roas",
        timeRange: "last_30_days",
      },
      {
        id: "client_table",
        type: "table",
        title: "Client Performance",
        dataSource: "clients",
        metric: "roas",
        chartType: "table",
        timeRange: "last_30_days",
      },
    ],
    defaultFilters: {
      dateRange: "last_30_days",
    },
    isFeatured: false,
    sortOrder: 10,
  },

  // SYNC HEALTH
  {
    slug: "data-health-monitor",
    name: "Data Health Monitor",
    description: "Technical dashboard showing sync status, data quality, and pipeline health",
    category: "analytics",
    icon: "/icons/health.svg",
    requiredSources: [],
    requiredMetrics: ["sync_status", "row_count", "error_rate"],
    widgets: [
      {
        id: "health_sync_success",
        type: "metric",
        title: "Sync Success Rate",
        dataSource: "sync_logs",
        metric: "success_rate",
        timeRange: "last_24_hours",
      },
      {
        id: "health_rows_synced",
        type: "metric",
        title: "Rows Synced (24h)",
        dataSource: "sync_logs",
        metric: "rowsSynced",
        timeRange: "last_24_hours",
      },
      {
        id: "health_recent_errors",
        type: "table",
        title: "Recent Errors",
        dataSource: "sync_logs",
        metric: "errorMsg",
        chartType: "table",
        timeRange: "last_24_hours",
      },
      {
        id: "health_trend",
        type: "chart",
        title: "Sync Volume Trend",
        dataSource: "sync_logs",
        metric: "rowsSynced",
        chartType: "line",
        timeRange: "last_7_days",
      },
    ],
    defaultFilters: {
      dateRange: "last_24_hours",
    },
    isFeatured: false,
    sortOrder: 99,
  },
];

/**
 * Get templates available for a workspace based on connected sources
 */
export function getAvailableTemplates(connectedSources: string[]): DashboardTemplate[] {
  return DASHBOARD_TEMPLATES.filter((template) => {
    // If no required sources, always available
    if (template.requiredSources.length === 0) {
      return true;
    }

    // Check if all required sources are connected
    return template.requiredSources.every((source) => connectedSources.includes(source));
  }).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Get featured templates
 */
export function getFeaturedTemplates(): DashboardTemplate[] {
  return DASHBOARD_TEMPLATES.filter((t) => t.isFeatured).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Get template by slug
 */
export function getTemplateBySlug(slug: string): DashboardTemplate | undefined {
  return DASHBOARD_TEMPLATES.find((t) => t.slug === slug);
}

/**
 * Create dashboard instance from template
 */
export function instantiateTemplate(template: DashboardTemplate, overrides?: Partial<DashboardTemplate>): {
  name: string;
  description: string;
  config: string; // JSON string
} {
  const name = overrides?.name || template.name;
  const description = overrides?.description || template.description;

  const config = {
    template: template.slug,
    widgets: template.widgets,
    defaultFilters: overrides?.defaultFilters || template.defaultFilters,
    createdAt: new Date().toISOString(),
  };

  return {
    name,
    description,
    config: JSON.stringify(config),
  };
}
