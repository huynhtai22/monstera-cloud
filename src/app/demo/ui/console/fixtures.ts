import type { DashboardOverviewDTO } from "@/lib/dashboard-overview";

export type PreviewState =
  | "Overview"
  | "Syncing"
  | "Needs attention"
  | "New workspace"
  | "Multi-currency";
export const previewStates: PreviewState[] = [
  "Overview",
  "Syncing",
  "Needs attention",
  "New workspace",
  "Multi-currency",
];

// Synthetic, local-only data: no customer records or credentials.
export function previewOverview(state: PreviewState): DashboardOverviewDTO {
  const overview: DashboardOverviewDTO = {
    workspace: {
      id: "local-preview",
      name: "Studio North",
      slug: "studio-north",
      plan: "professional",
      status: "ACTIVE",
      subscriptionEndsAt: null,
    },
    pilotActivation: {
      status: "activated",
      currentStep: "complete",
      trialEndsAt: null,
      sourceConnectionId: "preview-meta",
      rows7d: 24860,
      dataThroughDate: "2026-09-27",
      dashboardReviewedAt: "2026-09-27T08:00:00Z",
      blockers: [],
    },
    overallStatus: {
      state: "healthy",
      headline: "All sources are up to date",
      supportingText:
        "12 accounts connected. Your latest metrics are ready to explore.",
    },
    summaryCards: {
      sources: {
        total: 4,
        healthy: 4,
        attention: 0,
        accountsTotal: 12,
        label: "Connected sources",
        subtext: "All 4 connections are current",
      },
      warehouse: {
        status: "fresh",
        dataThroughDate: "2026-09-27",
        totalRows: 128450,
        rows7d: 24860,
        asOf: "2026-09-27T13:42:00Z",
      },
      syncs: {
        successful7d: 168,
        failed7d: 0,
        lastSyncTimeAgo: "8 minutes ago",
      },
      destinations: {
        activeCount: 2,
        list: ["Google Sheets", "Looker Studio"],
      },
    },
    needsAttention: [],
    sourcesList: [
      {
        id: "preview-meta",
        provider: "meta_ads",
        name: "Studio North · Meta",
        managerBadge: "[BM: 100023456789]",
        shortId: "mt_01",
        accountCount: 5,
        accountTags: [],
        state: "fresh",
        lastSyncAt: "2026-09-27T13:42:00Z",
        lastError: null,
      },
      {
        id: "preview-google",
        provider: "google_ads",
        name: "Google Ads portfolio",
        managerBadge: "[MCC: 123-456-7890]",
        shortId: "gg_02",
        accountCount: 4,
        accountTags: [],
        state: "fresh",
        lastSyncAt: "2026-09-27T13:40:00Z",
        lastError: null,
      },
      {
        id: "preview-tiktok",
        provider: "tiktok_business",
        name: "TikTok for Business",
        shortId: "tt_03",
        accountCount: 2,
        accountTags: [],
        state: "fresh",
        lastSyncAt: "2026-09-27T13:38:00Z",
        lastError: null,
      },
      {
        id: "preview-shopee",
        provider: "shopee",
        name: "North Supply store",
        shortId: "sh_04",
        accountCount: 1,
        accountTags: [],
        state: "fresh",
        lastSyncAt: "2026-09-27T13:35:00Z",
        lastError: null,
      },
    ],
    warehouseSnapshot: {
      hasData: true,
      dataThroughDate: "2026-09-27",
      lastRefreshAt: "2026-09-27T13:42:00Z",
      metrics7d: {
        impressions: 2846000,
        clicks: 86420,
        conversions: 3284,
        mixedCurrency: false,
        byCurrency: [
          { currency: "USD", spend: 18420.5, revenue: 76381, roas: 4.1465 },
        ],
        byPlatform: [
          {
            platform: "meta_ads",
            spend: 8657.64,
            revenue: 36438,
            currency: "USD",
            percentage: 47,
          },
          {
            platform: "google_ads",
            spend: 6262.97,
            revenue: 28260,
            currency: "USD",
            percentage: 34,
          },
          {
            platform: "tiktok_business",
            spend: 3499.89,
            revenue: 11683,
            currency: "USD",
            percentage: 19,
          },
        ],
      },
    },
    destinationsList: [
      {
        id: "sheets",
        type: "sheets",
        name: "Google Sheets",
        status: "healthy",
        subtext: "Weekly client report · 3 connected spreadsheets",
        href: "/docs",
      },
      {
        id: "looker",
        type: "looker",
        name: "Looker Studio",
        status: "active",
        subtext: "Your client dashboards, powered by warehouse data",
        href: "/looker-studio",
      },
      {
        id: "api",
        type: "api",
        name: "API & exports",
        status: "unconfigured",
        subtext: "Build your own reporting workflow",
        href: "/exports",
      },
    ],
    recentActivity: [
      {
        id: "1",
        type: "warehouse_refresh",
        title: "Warehouse is up to date",
        description: "1,248 metric rows imported across 12 accounts.",
        timestamp: "2026-09-27T13:42:00Z",
        status: "success",
      },
      {
        id: "2",
        type: "sync_success",
        title: "Google Ads sync completed",
        description: "4 ad accounts refreshed successfully.",
        timestamp: "2026-09-27T13:40:00Z",
        status: "success",
      },
      {
        id: "3",
        type: "looker_query",
        title: "Looker Studio queried the warehouse",
        description: "Latest performance data delivered to your dashboard.",
        timestamp: "2026-09-27T13:32:00Z",
        status: "info",
      },
    ],
  };
  if (state === "Syncing") {
    overview.overallStatus = {
      state: "syncing",
      headline: "Fresh data is on its way",
      supportingText:
        "A warehouse import is running. Your last available metrics are shown below.",
    };
    overview.summaryCards.warehouse.status = "refreshing";
    overview.summaryCards.sources.healthy = 2;
    overview.summaryCards.sources.subtext = "2 sources are importing data";
    overview.sourcesList[0].state = "syncing";
    overview.sourcesList[1].state = "syncing";
    overview.destinationsList[0].status = "syncing";
  }
  if (state === "Needs attention") {
    overview.overallStatus = {
      state: "attention",
      headline: "One connection needs a hand",
      supportingText:
        "Reconnect Google Ads to bring all of your reporting back up to date.",
    };
    overview.summaryCards.sources.healthy = 3;
    overview.summaryCards.sources.attention = 1;
    overview.summaryCards.sources.subtext = "1 connection needs attention";
    overview.summaryCards.syncs.failed7d = 2;
    overview.summaryCards.warehouse.status = "partial";
    overview.sourcesList[1].state = "error";
    overview.sourcesList[1].lastError = "Authorization expired";
    overview.sourcesList[1].lastSyncAt = "2026-09-25T13:40:00Z";
    overview.needsAttention = [
      {
        id: "auth",
        title: "Google Ads authorization expired",
        explanation:
          "Your existing data is safe. Reconnect this source to resume importing all 4 ad accounts.",
        actionType: "reconnect",
        actionLabel: "Reconnect source",
        connectionId: "preview-google",
        provider: "google_ads",
        timestamp: "2026-09-27T13:40:00Z",
      },
    ];
    overview.recentActivity.unshift({
      id: "error",
      type: "sync_error",
      title: "Google Ads needs authorization",
      description: "The scheduled import could not complete.",
      timestamp: "2026-09-27T13:45:00Z",
      status: "error",
    });
  }
  if (state === "New workspace") {
    overview.pilotActivation = {
      status: "not_started",
      currentStep: "connect_source",
      trialEndsAt: null,
      sourceConnectionId: null,
      rows7d: 0,
      dataThroughDate: null,
      dashboardReviewedAt: null,
      blockers: [],
    };
    overview.overallStatus = {
      state: "onboarding",
      headline: "Make room for your first connection",
      supportingText:
        "Bring your marketing data together, one source at a time.",
    };
    overview.summaryCards = {
      sources: {
        total: 0,
        healthy: 0,
        attention: 0,
        accountsTotal: 0,
        label: "Sources",
        subtext: "Connect a source to begin",
      },
      warehouse: {
        status: "never",
        dataThroughDate: null,
        totalRows: 0,
        rows7d: 0,
        asOf: null,
      },
      syncs: { successful7d: 0, failed7d: 0, lastSyncTimeAgo: null },
      destinations: { activeCount: 0, list: [] },
    };
    overview.sourcesList = [];
    overview.recentActivity = [];
    overview.destinationsList.forEach((item) => {
      item.status = "unconfigured";
      item.subtext =
        "Choose this destination when you are ready to share your data";
    });
    overview.warehouseSnapshot = {
      hasData: false,
      dataThroughDate: null,
      lastRefreshAt: null,
      metrics7d: {
        impressions: 0,
        clicks: 0,
        conversions: 0,
        mixedCurrency: false,
        byCurrency: [],
        byPlatform: [],
      },
    };
  }
  if (state === "Multi-currency") {
    overview.warehouseSnapshot.metrics7d.mixedCurrency = true;
    overview.warehouseSnapshot.metrics7d.byCurrency.push({
      currency: "VND",
      spend: 32400000,
      revenue: 110000000,
      roas: 3.395,
    });
    overview.warehouseSnapshot.metrics7d.byPlatform.push({
      platform: "shopee",
      spend: 32400000,
      revenue: 110000000,
      currency: "VND",
      percentage: 0,
    });
  }
  return overview;
}
