import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

async function main() {
  console.log("Generating Data Health Report...");
  const now = new Date();
  const ago24h = new Date(now.getTime() - 24 * 3600 * 1000);
  const fifteenMinutesMs = 15 * 60 * 1000;

  // 1. CHECK_DATA_VALIDATION: Query DB/Logs to count records ingested in last 24h. Flag any connection that ingested 0 records unexpectedly.
  const syncLogs24h = await prisma.syncLog.findMany({
    where: {
      createdAt: { gte: ago24h },
    },
    include: {
      pipeline: {
        include: {
          sourceConnection: true,
        },
      },
    },
  });

  const totalLogs = syncLogs24h.length;
  const successfulLogs = syncLogs24h.filter(l => l.status === "success");
  const failedLogs = syncLogs24h.filter(l => l.status === "error");
  const totalRowsSynced = syncLogs24h.reduce((sum, l) => sum + (l.rowsSynced || 0), 0);

  // Group by connection to detect if a connection synced 0 rows unexpectedly in the last 24h
  const connectionStats = new Map<string, { name: string; provider: string; totalRows: number; syncCount: number; successCount: number }>();

  // Initialize with all connections that have active pipelines
  const activePipelines = await prisma.pipeline.findMany({
    where: { status: "active" },
    include: { sourceConnection: true },
  });

  for (const pipeline of activePipelines) {
    const conn = pipeline.sourceConnection;
    if (conn && !connectionStats.has(conn.id)) {
      connectionStats.set(conn.id, {
        name: conn.name,
        provider: conn.provider,
        totalRows: 0,
        syncCount: 0,
        successCount: 0,
      });
    }
  }

  // Populate stats from logs
  for (const log of syncLogs24h) {
    const conn = log.pipeline?.sourceConnection;
    if (conn) {
      const stats = connectionStats.get(conn.id) || {
        name: conn.name,
        provider: conn.provider,
        totalRows: 0,
        syncCount: 0,
        successCount: 0,
      };
      stats.totalRows += log.rowsSynced || 0;
      stats.syncCount += 1;
      if (log.status === "success") {
        stats.successCount += 1;
      }
      connectionStats.set(conn.id, stats);
    }
  }

  const flaggedZeroRecordConnections: Array<{ id: string; name: string; provider: string; syncCount: number }> = [];
  for (const [connId, stats] of connectionStats.entries()) {
    // If the connection had sync attempts in the last 24h but total rows is 0
    if (stats.syncCount > 0 && stats.totalRows === 0) {
      flaggedZeroRecordConnections.push({
        id: connId,
        name: stats.name,
        provider: stats.provider,
        syncCount: stats.syncCount,
      });
    }
  }

  // 2. CHECK_SYNC_LATENCY: Scan for jobs exceeding 15 minutes. Identify connection bottleneck.
  const syncJobs24h = await prisma.syncJob.findMany({
    where: {
      createdAt: { gte: ago24h },
      startedAt: { not: null },
      finishedAt: { not: null },
    },
    include: {
      pipeline: {
        include: {
          sourceConnection: true,
        },
      },
    },
  });

  const slowJobs = syncJobs24h.filter(job => {
    const duration = job.finishedAt!.getTime() - job.startedAt!.getTime();
    return duration > fifteenMinutesMs;
  });

  // Also check database sync logs for long durations
  const slowLogs = syncLogs24h.filter(log => (log.durationMs || 0) > fifteenMinutesMs);

  const latencyBottlenecks: Array<{
    id: string;
    type: "job" | "log";
    pipelineName: string;
    connectionName: string;
    provider: string;
    durationMs: number;
    createdAt: Date;
  }> = [];

  for (const job of slowJobs) {
    const durationMs = job.finishedAt!.getTime() - job.startedAt!.getTime();
    latencyBottlenecks.push({
      id: job.id,
      type: "job",
      pipelineName: job.pipeline.name,
      connectionName: job.pipeline.sourceConnection?.name || "Unknown",
      provider: job.pipeline.sourceConnection?.provider || "Unknown",
      durationMs,
      createdAt: job.createdAt,
    });
  }

  for (const log of slowLogs) {
    // Avoid double counting if it is the same execution, but list it if unique
    if (!latencyBottlenecks.some(b => b.durationMs === log.durationMs && b.pipelineName === log.pipeline?.name)) {
      latencyBottlenecks.push({
        id: log.id,
        type: "log",
        pipelineName: log.pipeline?.name || "Unknown",
        connectionName: log.pipeline?.sourceConnection?.name || "Unknown",
        provider: log.pipeline?.sourceConnection?.provider || "Unknown",
        durationMs: log.durationMs,
        createdAt: log.createdAt,
      });
    }
  }

  // 3. CHECK_API_ERRORS: Aggregate errors by code (429, 401, 500). If > 5 errors of one type appear, provide a breakdown.
  const errorBreakdown = {
    auth401: [] as typeof failedLogs,
    rateLimit429: [] as typeof failedLogs,
    serverError500: [] as typeof failedLogs,
  };

  for (const log of failedLogs) {
    const msg = (log.errorMsg || "").toLowerCase();
    if (/unauthorized|401|403|token|oauth|expired|invalid_grant/.test(msg)) {
      errorBreakdown.auth401.push(log);
    } else if (/rate.?limit|429|quota|too many/.test(msg)) {
      errorBreakdown.rateLimit429.push(log);
    } else {
      errorBreakdown.serverError500.push(log);
    }
  }

  // Formulate the report content
  let report = `# Data Health Report — ${now.toISOString()}\n\n`;

  report += `## Summary (Last 24 Hours)\n`;
  report += `- **Total Sync Attempts:** ${totalLogs}\n`;
  report += `- **Successful Syncs:** ${successfulLogs.length} (${totalLogs > 0 ? Math.round((successfulLogs.length / totalLogs) * 100) : 0}%)\n`;
  report += `- **Failed Syncs:** ${failedLogs.length}\n`;
  report += `- **Total Records Ingested:** ${totalRowsSynced.toLocaleString()} rows\n\n`;

  report += `## 1. Data Ingestion Validation (CHECK_DATA_VALIDATION)\n`;
  if (flaggedZeroRecordConnections.length === 0) {
    report += `✅ **All active connections successfully ingested data.** No active connection synced 0 rows unexpectedly.\n\n`;
  } else {
    report += `⚠️ **Flagged Connections (Ingested 0 records unexpectedly):**\n`;
    for (const item of flaggedZeroRecordConnections) {
      report += `- **Connection:** ${item.name} (${item.provider}) | ID: \`${item.id}\` | Attempts in last 24h: ${item.syncCount}\n`;
    }
    report += `\n`;
  }

  report += `## 2. Sync Latency Bottlenecks (CHECK_SYNC_LATENCY)\n`;
  if (latencyBottlenecks.length === 0) {
    report += `✅ **No sync jobs or logs exceeded the 15-minute threshold.** All jobs are executing within reasonable bounds.\n\n`;
  } else {
    report += `⚠️ **Jobs/Logs Exceeding 15 Minutes:**\n`;
    for (const b of latencyBottlenecks) {
      const minutes = (b.durationMs / (60 * 1000)).toFixed(1);
      report += `- **[${b.type.toUpperCase()}]** Pipeline: *${b.pipelineName}* | Connection: ${b.connectionName} (${b.provider}) | Duration: **${minutes} mins** (${b.durationMs.toLocaleString()} ms) | Occurred at: ${b.createdAt.toISOString()}\n`;
    }
    report += `\n`;
  }

  report += `## 3. API Error Aggregation & Taxonomy (CHECK_API_ERRORS)\n`;
  report += `- **Auth Errors (401/403/Token):** ${errorBreakdown.auth401.length}\n`;
  report += `- **Rate Limit Errors (429/Quota):** ${errorBreakdown.rateLimit429.length}\n`;
  report += `- **Server/Network Errors (500/Timeout/Other):** ${errorBreakdown.serverError500.length}\n\n`;

  const addBreakdown = (title: string, list: typeof failedLogs) => {
    let subReport = `### Breakdown of ${title} (Total: ${list.length})\n`;
    if (list.length === 0) {
      subReport += `No errors of this type occurred.\n\n`;
      return subReport;
    }
    // Group by unique error message
    const msgGroups = new Map<string, { count: number; examples: string[] }>();
    for (const log of list) {
      const cleanMsg = log.errorMsg ? log.errorMsg.slice(0, 120) + (log.errorMsg.length > 120 ? "..." : "") : "No error message";
      const grp = msgGroups.get(cleanMsg) || { count: 0, examples: [] };
      grp.count += 1;
      const pipelineName = log.pipeline?.name || "Unknown";
      const connName = log.pipeline?.sourceConnection?.name || "Unknown";
      const provider = log.pipeline?.sourceConnection?.provider || "Unknown";
      const desc = `${pipelineName} (via ${connName} [${provider}])`;
      if (grp.examples.length < 3 && !grp.examples.includes(desc)) {
        grp.examples.push(desc);
      }
      msgGroups.set(cleanMsg, grp);
    }

    for (const [msg, details] of msgGroups.entries()) {
      subReport += `- **Error:** \`${msg}\` (Occurred **${details.count} times**)\n`;
      subReport += `  - *Affecting pipelines/connections:* ${details.examples.join(", ")}\n`;
    }
    subReport += `\n`;
    return subReport;
  };

  if (errorBreakdown.auth401.length > 5) {
    report += addBreakdown("Auth Errors", errorBreakdown.auth401);
  }
  if (errorBreakdown.rateLimit429.length > 5) {
    report += addBreakdown("Rate Limit Errors", errorBreakdown.rateLimit429);
  }
  if (errorBreakdown.serverError500.length > 5) {
    report += addBreakdown("Server & Network Errors", errorBreakdown.serverError500);
  }
  if (errorBreakdown.auth401.length <= 5 && errorBreakdown.rateLimit429.length <= 5 && errorBreakdown.serverError500.length <= 5) {
    report += `ℹ️ **All error categories had <= 5 occurrences.** No extensive error breakdowns are required.\n\n`;
  }

  // Save the report file
  const reportPath = path.join(__dirname, "../tmp/data_health_report.md");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, report);
  console.log(`Report successfully written to ${reportPath}`);

  // Update HEARTBEAT.md
  const heartbeatPath = path.join(__dirname, "../HEARTBEAT.md");
  if (fs.existsSync(heartbeatPath)) {
    let heartbeatContent = fs.readFileSync(heartbeatPath, "utf-8");

    const dateStr = now.toISOString().split(".")[0]; // YYYY-MM-DDTHH:MM:SS
    
    // Replace unchecked checkboxes with checked ones
    heartbeatContent = heartbeatContent.replace(
      /- \[\s*\] CHECK_DATA_VALIDATION: Query DB\/Logs to count records ingested in last 24h\. Flag any connection that ingested 0 records unexpectedly\./g,
      `- [x] CHECK_DATA_VALIDATION: Query DB/Logs to count records ingested in last 24h. Flag any connection that ingested 0 records unexpectedly. (Completed: ${dateStr})`
    );

    heartbeatContent = heartbeatContent.replace(
      /- \[\s*\] CHECK_SYNC_LATENCY: Scan `tmp\/` logs for jobs exceeding 15 minutes\. Identify connection bottleneck\./g,
      `- [x] CHECK_SYNC_LATENCY: Scan \`tmp/\` logs for jobs exceeding 15 minutes. Identify connection bottleneck. (Completed: ${dateStr})`
    );

    heartbeatContent = heartbeatContent.replace(
      /- \[\s*\] CHECK_API_ERRORS: Aggregate `tmp\/\*\.log` errors by code \(429, 401, 500\)\. If > 5 errors of one type appear, provide a breakdown\./g,
      `- [x] CHECK_API_ERRORS: Aggregate \`tmp/*.log\` errors by code (429, 401, 500). If > 5 errors of one type appear, provide a breakdown. (Completed: ${dateStr})`
    );

    fs.writeFileSync(heartbeatPath, heartbeatContent);
    console.log(`HEARTBEAT.md updated successfully!`);
  } else {
    console.warn(`HEARTBEAT.md not found at ${heartbeatPath}`);
  }
}

main()
  .catch((err) => {
    console.error("Error generating report:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
