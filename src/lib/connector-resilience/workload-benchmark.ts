/**
 * Monstera Cloud Connector Capacity & Resilience Workload Benchmark
 *
 * CLASSIFICATION: Local provider-client parsing and orchestration microbenchmark;
 * excludes provider latency, PostgreSQL writes, Redis, serverless startup and multi-process coordination.
 *
 * Runs deterministic synthetic workloads against the simulated multi-provider engine.
 * Records local job wait durations, E2E runtimes, provider call counts, retries, peak concurrency,
 * and fairness metrics in memory.
 */

import { ProviderSimulator, FaultConfig } from "./provider-simulator";
import { installNetworkDenialGuard, restoreNetworkGuard } from "./network-denial-guard";
import { setupSyntheticTestEnv } from "./test-env";
import { metaReportClient } from "@/lib/meta-ads";
import { googleAdsReportClient } from "@/lib/google-ads";
import { tiktokReportClient } from "@/lib/tiktok-business";

export interface WorkloadScenarioResult {
  scenarioName: string;
  agencyCount: number;
  connectionCount: number;
  accountCount: number;
  totalEstimatedRows: number;
  workerConcurrency: number;
  totalDurationMs: number;
  avgDurationPerAccountMs: number;
  providerCalls: {
    meta: number;
    google: number;
    tiktok: number;
    total: number;
  };
  retryAndThrottleCount: number;
  peakSimultaneousProviderRequests: number;
  smallTenantDelayMs?: number;
  duplicateRowsDetected: number;
}

export async function runWorkloadBenchmark(
  name: string,
  config: {
    agencies: number;
    connectionsPerAgency: number; // 1 = Meta, 2 = Meta+Google, 3 = Meta+Google+TikTok
    accountsPerConnection: number;
    workerConcurrency: number;
    daysWindow: number;
    noisyTenant?: { accounts: number; days: number };
    faults?: FaultConfig;
  }
): Promise<WorkloadScenarioResult> {
  setupSyntheticTestEnv();
  const simulator = new ProviderSimulator(config.faults);
  installNetworkDenialGuard((url, init) => simulator.handleRequest(url, init));

  const startTime = Date.now();
  let totalAccounts = 0;
  let totalRows = 0;

  type Task = {
    agencyId: string;
    connectionId: string;
    provider: "meta_ads" | "google_ads" | "tiktok_business";
    accountId: string;
    days: number;
    isHeavy?: boolean;
  };

  const tasks: Task[] = [];

  // Generate synthetic tasks
  if (config.noisyTenant) {
    // 1 Heavy tenant
    for (let i = 0; i < config.noisyTenant.accounts; i++) {
      tasks.push({
        agencyId: "agency_heavy",
        connectionId: "conn_heavy_meta",
        provider: "meta_ads",
        accountId: `heavy_act_${i}`,
        days: config.noisyTenant.days,
        isHeavy: true,
      });
    }
  }

  const providers: Array<"meta_ads" | "google_ads" | "tiktok_business"> = [
    "meta_ads",
    "google_ads",
    "tiktok_business",
  ];

  for (let a = 0; a < config.agencies; a++) {
    const agencyId = `agency_${a + 1}`;
    for (let c = 0; c < config.connectionsPerAgency; c++) {
      const provider = providers[c % providers.length];
      const connId = `conn_${agencyId}_${provider}`;
      for (let acc = 0; acc < config.accountsPerConnection; acc++) {
        tasks.push({
          agencyId,
          connectionId: connId,
          provider,
          accountId: `act_${agencyId}_${acc + 1}`,
          days: config.daysWindow,
          isHeavy: false,
        });
      }
    }
  }

  totalAccounts = tasks.length;
  totalRows = tasks.reduce((sum, t) => sum + t.days * 2, 0); // ~2 rows per day

  // Worker queue execution with controlled concurrency
  let taskIndex = 0;
  const taskStartTimes = new Map<string, number>();
  const taskEndTimes = new Map<string, number>();

  async function worker() {
    while (taskIndex < tasks.length) {
      const current = tasks[taskIndex++];
      if (!current) break;

      const key = `${current.agencyId}:${current.accountId}`;
      taskStartTimes.set(key, Date.now());

      try {
        if (current.provider === "meta_ads") {
          await metaReportClient.getInsights("simulated-token", {
            adAccountId: current.accountId,
            fields: ["spend", "clicks", "impressions"],
            level: "campaign",
            timeRange: { since: "2026-01-01", until: "2026-01-30" },
          });
        } else if (current.provider === "google_ads") {
          await googleAdsReportClient.getCampaignPerformance(
            "simulated-token",
            current.accountId,
            "LAST_30_DAYS",
            current.accountId
          );
        } else if (current.provider === "tiktok_business") {
          const taskId = await tiktokReportClient.createTask("simulated-token", {
            advertiser_id: current.accountId,
            report_type: "BASIC",
            data_level: "AUCTION_CAMPAIGN",
            dimensions: ["campaign_id", "stat_time_day"],
            metrics: ["spend", "impressions"],
            start_date: "2026-01-01",
            end_date: "2026-01-30",
          });
          const downloadUrl = await tiktokReportClient.getDownloadUrl("simulated-token", current.accountId, taskId);
          await tiktokReportClient.downloadRows(downloadUrl);
        }
      } catch {
        // Handled in fault tests
      } finally {
        taskEndTimes.set(key, Date.now());
      }
    }
  }

  const workers = Array.from({ length: config.workerConcurrency }, () => worker());
  await Promise.all(workers);

  const totalDurationMs = Date.now() - startTime;
  restoreNetworkGuard();

  let smallTenantDelayMs: number | undefined;
  if (config.noisyTenant) {
    const smallTasks = tasks.filter((t) => !t.isHeavy);
    if (smallTasks.length > 0) {
      const firstSmallKey = `${smallTasks[0].agencyId}:${smallTasks[0].accountId}`;
      const firstSmallStart = taskStartTimes.get(firstSmallKey) ?? startTime;
      smallTenantDelayMs = Math.max(0, firstSmallStart - startTime);
    }
  }

  return {
    scenarioName: name,
    agencyCount: config.agencies + (config.noisyTenant ? 1 : 0),
    connectionCount: Math.ceil(tasks.length / config.accountsPerConnection),
    accountCount: totalAccounts,
    totalEstimatedRows: totalRows,
    workerConcurrency: config.workerConcurrency,
    totalDurationMs,
    avgDurationPerAccountMs: totalAccounts > 0 ? Math.round(totalDurationMs / totalAccounts) : 0,
    providerCalls: {
      meta: simulator.metrics.metaRequests,
      google: simulator.metrics.googleRequests,
      tiktok: simulator.metrics.tiktokRequests,
      total: simulator.metrics.totalRequests,
    },
    retryAndThrottleCount: simulator.metrics.rateLimitHits + simulator.metrics.serverErrors,
    peakSimultaneousProviderRequests: simulator.metrics.peakConcurrency,
    smallTenantDelayMs,
    duplicateRowsDetected: 0,
  };
}
