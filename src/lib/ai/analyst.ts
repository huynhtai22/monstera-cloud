import { classifyQuestion, refusalMessage, type QuestionClass } from "@/lib/ai/classify";
import { getAiTool } from "@/lib/ai/tools";
import type { AiToolContext, AiToolResult } from "@/lib/ai/tools/types";
import type { EvidencePack } from "@/lib/ai/evidence-pack";
import type { ReportingReadiness } from "@/lib/reporting-readiness";
import prisma from "@/lib/prisma";

export type AnalystTurnStatus = "answered" | "refused" | "queued";

export type AnalystObservation = {
  text: string;
  metric?: string;
  changeAbsolute?: number | string;
  changePercentage?: number | string | null;
  sources?: string[];
};

export type AnalystStructuredOutput = {
  headline: string;
  scopeLabel: string;
  isAgencyOverview: boolean;
  observations: AnalystObservation[];
  suggestedChecks: string[];
  limitations: string[];
};

export type AnalystTurnResult = {
  status: AnalystTurnStatus;
  turnId?: string;
  answer?: string;
  structured?: AnalystStructuredOutput;
  refusalCode?: string;
  blockers?: string[];
  evidence?: EvidencePack;
  queuedCopy?: string;
};

const QUEUED_COPY = "Deeper briefs queue for the nightly AI worker.";

function utcDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function defaultWindow(): { startDate: string; endDate: string } {
  return { startDate: utcDate(-6), endDate: utcDate(0) };
}

export function packFromReadiness(
  readiness: ReportingReadiness,
  citations: EvidencePack["citations"] = [],
): EvidencePack {
  return {
    freshness: readiness.freshness,
    currencies: readiness.currencies,
    lastDataThrough: readiness.lastDataThrough,
    completeness: {
      sourceCount: readiness.sources.length,
      partialCount: readiness.sources.filter((s) => s.health === "partial").length,
      missingDays: 0,
    },
    attribution: { model: "platform_reported" },
    citations,
  };
}

export async function runAnalystTurn(opts: {
  workspaceId: string;
  actorUserId?: string;
  question: string;
  clientId?: string;
  acknowledgeBestEffort?: boolean;
  jobId?: string;
  role?: AiToolContext["role"];
}): Promise<AnalystTurnResult> {
  const role = opts.role ?? "interactive";
  // Revalidate persisted jobs too; a browser-supplied client must never widen
  // the authorized workspace, even when best-effort reporting is requested.
  if (opts.clientId && !await prisma.client.findFirst({
    where: { id: opts.clientId, workspaceId: opts.workspaceId }, select: { id: true },
  })) {
    return { status: "refused", refusalCode: "tenant_mismatch", blockers: ["tenant_mismatch"] };
  }
  const classified: QuestionClass = classifyQuestion(opts.question);
  if (classified.refuse) {
    return {
      status: "refused",
      answer: refusalMessage(classified.refusalCode ?? "out_of_envelope"),
      refusalCode: classified.refusalCode,
      blockers: [classified.refusalCode ?? "out_of_envelope"],
    };
  }

  // Interactive turns queue deeper briefs; the nightly worker must execute them.
  if (role !== "cron" && (classified.tools.length > 2 || classified.needsQueue)) {
    return { status: "queued", queuedCopy: QUEUED_COPY };
  }

  const ctx: AiToolContext = {
    workspaceId: opts.workspaceId,
    clientId: opts.clientId,
    actorUserId: opts.actorUserId,
    jobId: opts.jobId ?? (role === "cron" ? "cron" : "interactive"),
    role,
  };
  const window = defaultWindow();
  const citations: EvidencePack["citations"] = [];
  const toolNotes: string[] = [];
  let readiness: ReportingReadiness | null = null;
  type SourceHealthItem = {
    connectionId: string;
    provider: string;
    health: string;
    lastDataThrough: string | null;
    lastError: string | null;
  };
  let sourceHealthList: SourceHealthItem[] | null = null;
  let metricsResult: {
    rows: Array<Record<string, unknown>>;
    totalSpend: number;
    totalConversions: number;
    totalClicks: number;
    totalImpressions: number;
    totalConversionValue: number;
    currencies: string[];
    truncated?: boolean;
  } | null = null;

  const priorWindow = { startDate: utcDate(-13), endDate: utcDate(-7) };
  let priorMetricsResult: {
    totalSpend: number;
    totalConversions: number;
    totalClicks: number;
    totalImpressions: number;
    totalConversionValue: number;
  } | null = null;

  for (const name of classified.tools) {
    const tool = getAiTool(name);
    if (!tool) continue;
    const args: Record<string, unknown> = {
      since: window.startDate,
      until: window.endDate,
      startDate: window.startDate,
      endDate: window.endDate,
      clientId: opts.clientId,
      dimensions: classified.intent === "campaign_contribution" ? ["campaignName", "platform"] : undefined,
      metrics: classified.intent === "campaign_contribution"
        ? ["revenue", "spend", "conversions"]
        : ["spend", "impressions", "clicks", "conversions", "revenue"],
    };
    let result: AiToolResult;
    try {
      result = await tool.execute(ctx, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : "tool failed";
      if (message.includes("tenant mismatch")) {
        return {
          status: "refused",
          refusalCode: "tenant_mismatch",
          answer: "Tenant mismatch. Tools only run in the signed-in workspace.",
          blockers: ["tenant_mismatch"],
        };
      }
      throw error;
    }
    citations.push(...result.evidenceRefs);
    if (name === "get_reporting_readiness" && result.data) {
      readiness = result.data as ReportingReadiness;
      if (readiness.status === "blocked" && !opts.acknowledgeBestEffort) {
        return {
          status: "refused",
          refusalCode: "blocked_readiness",
          answer: refusalMessage("blocked_readiness"),
          blockers: readiness.blockers,
          evidence: packFromReadiness(readiness, citations),
        };
      }
    } else if (name === "get_source_health" && Array.isArray(result.data)) {
      sourceHealthList = result.data as SourceHealthItem[];
    } else if (name === "query_metrics" && result.data) {
      const raw = result.data as { rows?: Array<Record<string, unknown>>; truncated?: boolean };
      const rows = raw.rows ?? [];
      let totalSpend = 0;
      let totalConversions = 0;
      let totalClicks = 0;
      let totalImpressions = 0;
      let totalConversionValue = 0;
      const currencySet = new Set<string>();

      for (const r of rows) {
        if (typeof r.currency === "string" && r.currency.trim()) {
          currencySet.add(r.currency.trim());
        }
        totalSpend += Number(r["metric:spend"] ?? r.spend ?? 0);
        totalConversions += Number(r["metric:conversions"] ?? r.conversions ?? 0);
        totalClicks += Number(r["metric:clicks"] ?? r.clicks ?? 0);
        totalImpressions += Number(r["metric:impressions"] ?? r.impressions ?? 0);
        totalConversionValue += Number(r["metric:revenue"] ?? r.revenue ?? 0);
      }

      metricsResult = {
        rows,
        totalSpend,
        totalConversions,
        totalClicks,
        totalImpressions,
        totalConversionValue,
        currencies: Array.from(currencySet),
        truncated: raw.truncated,
      };

      // If comparison intent, query prior window
      if (classified.intent === "comparison") {
        try {
          const priorRes = await tool.execute(ctx, {
            since: priorWindow.startDate,
            until: priorWindow.endDate,
            startDate: priorWindow.startDate,
            endDate: priorWindow.endDate,
            clientId: opts.clientId,
            metrics: ["spend", "impressions", "clicks", "conversions", "revenue"],
          });
          const priorRaw = priorRes.data as { rows?: Array<Record<string, unknown>> } | undefined;
          const priorRows = priorRaw?.rows ?? [];
          let pSpend = 0;
          let pConversions = 0;
          let pClicks = 0;
          let pImpressions = 0;
          let pConversionValue = 0;
          for (const pr of priorRows) {
            pSpend += Number(pr["metric:spend"] ?? pr.spend ?? 0);
            pConversions += Number(pr["metric:conversions"] ?? pr.conversions ?? 0);
            pClicks += Number(pr["metric:clicks"] ?? pr.clicks ?? 0);
            pImpressions += Number(pr["metric:impressions"] ?? pr.impressions ?? 0);
            pConversionValue += Number(pr["metric:revenue"] ?? pr.revenue ?? 0);
          }
          priorMetricsResult = {
            totalSpend: pSpend,
            totalConversions: pConversions,
            totalClicks: pClicks,
            totalImpressions: pImpressions,
            totalConversionValue: pConversionValue,
          };
        } catch {
          // If prior query fails, gracefully proceed with current only
        }
      }
    }
    toolNotes.push(`${name}: ${JSON.stringify(result.data).slice(0, 4000)}`);
  }

  let clientName: string | undefined;
  if (opts.clientId) {
    const client = await prisma.client.findFirst({
      where: { id: opts.clientId, workspaceId: opts.workspaceId },
      select: { name: true },
    });
    clientName = client?.name;
  }
  const isAgencyOverview = !opts.clientId;
  const scopeLabel = isAgencyOverview
    ? "Agency overview across assigned and unassigned accounts"
    : clientName
      ? `Client: ${clientName}`
      : "Client Scope";

  const observations: AnalystObservation[] = [];
  const suggestedChecks: string[] = [];
  const limitations: string[] = [];

  const isHealthQuestion = classified.intent === "health";
  const isComparison = classified.intent === "comparison";
  const isCampaignContribution = classified.intent === "campaign_contribution";

  if (sourceHealthList && sourceHealthList.length > 0) {
    for (const sh of sourceHealthList) {
      observations.push({
        text: `${sh.provider} source is ${sh.health}${sh.lastDataThrough ? ` (data through ${sh.lastDataThrough.slice(0, 10)})` : ""}.${sh.lastError ? ` Note: ${sh.lastError}` : ""}`,
        sources: [sh.provider],
      });
    }
    const unhealthy = sourceHealthList.filter((s) => s.health !== "healthy");
    if (unhealthy.length > 0) {
      suggestedChecks.push(`Inspect connection status and authentication tokens for ${unhealthy.map((u) => u.provider).join(", ")}.`);
      suggestedChecks.push("Trigger a manual warehouse refresh for partial or delayed sources.");
    } else {
      observations.push({ text: "All connected sources are healthy and syncing normally." });
    }
  }

  if (metricsResult) {
    if (metricsResult.rows.length === 0) {
      observations.push({
        text: `No warehouse records found for the period ${window.startDate} to ${window.endDate}.`,
      });
    } else if (isComparison && priorMetricsResult) {
      const curr = metricsResult.currencies[0] || "USD";
      const spendDiff = metricsResult.totalSpend - priorMetricsResult.totalSpend;
      const spendPct = priorMetricsResult.totalSpend > 0 ? spendDiff / priorMetricsResult.totalSpend : null;
      const convDiff = metricsResult.totalConversions - priorMetricsResult.totalConversions;
      const convPct = priorMetricsResult.totalConversions > 0 ? convDiff / priorMetricsResult.totalConversions : null;

      observations.push({
        text: `Spend changed by ${spendDiff >= 0 ? "+" : ""}${spendDiff.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${curr} (${spendPct != null ? `${spendPct >= 0 ? "+" : ""}${(spendPct * 100).toFixed(1)}%` : "no baseline"}) vs prior period.`,
        metric: "spend",
        changeAbsolute: spendDiff,
        changePercentage: spendPct,
      });

      observations.push({
        text: `Reported conversions changed by ${convDiff >= 0 ? "+" : ""}${convDiff.toLocaleString()} (${convPct != null ? `${convPct >= 0 ? "+" : ""}${(convPct * 100).toFixed(1)}%` : "no baseline"}) vs prior period.`,
        metric: "conversions",
        changeAbsolute: convDiff,
        changePercentage: convPct,
      });
    } else if (isCampaignContribution) {
      if (metricsResult.truncated) {
        observations.push({
          text: "Row limit reached for campaign-level breakdown. Results reflect an alphabetically capped sample and cannot be treated as an exhaustive or definitive ranking of top contributing campaigns.",
          metric: "revenue",
        });
      }
      const campaignMap = new Map<string, { revenue: number; spend: number; conversions: number; platform: string }>();
      for (const r of metricsResult.rows) {
        const cName = (r.campaignName as string) || (r.campaignId as string) || "Campaign";
        const cur = campaignMap.get(cName) || { revenue: 0, spend: 0, conversions: 0, platform: (r.platform as string) || "other" };
        cur.revenue += Number(r["metric:revenue"] ?? r.revenue ?? 0);
        cur.spend += Number(r["metric:spend"] ?? r.spend ?? 0);
        cur.conversions += Number(r["metric:conversions"] ?? r.conversions ?? 0);
        campaignMap.set(cName, cur);
      }
      const sorted = Array.from(campaignMap.entries()).sort((a, b) => b[1].revenue - a[1].revenue || b[1].spend - a[1].spend);
      const curr = metricsResult.currencies[0] || "USD";
      for (const [cName, cData] of sorted.slice(0, 5)) {
        const revShare = metricsResult.totalConversionValue > 0 ? (cData.revenue / metricsResult.totalConversionValue) * 100 : null;
        observations.push({
          text: `${metricsResult.truncated ? "Sampled campaign" : "Campaign"} "${cName}" (${cData.platform}) contributed ${cData.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${curr} revenue${revShare != null ? ` (${revShare.toFixed(1)}% of total)` : ""} with ${cData.spend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} spend.`,
          metric: "revenue",
          sources: [cData.platform],
        });
      }
    } else {
      if (metricsResult.currencies.length > 1) {
        observations.push({
          text: `Total ad spend spans multiple currencies: ${metricsResult.currencies.join(", ")}. Metrics are tracked per currency without unverified currency conversion.`,
          metric: "spend",
        });
      } else {
        const curr = metricsResult.currencies[0] || "USD";
        observations.push({
          text: `Total ad spend: ${metricsResult.totalSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${curr}.`,
          metric: "spend",
        });
      }

      const ctr = metricsResult.totalImpressions > 0
        ? (metricsResult.totalClicks / metricsResult.totalImpressions) * 100
        : null;

      observations.push({
        text: `Recorded ${metricsResult.totalConversions.toLocaleString()} platform-reported conversions across ${metricsResult.totalClicks.toLocaleString()} clicks and ${metricsResult.totalImpressions.toLocaleString()} impressions${ctr != null ? ` (CTR: ${ctr.toFixed(2)}%)` : ""}.`,
        metric: "conversions",
      });

      const platMap = new Map<string, { spend: number; conversions: number; clicks: number; currency: string }>();
      for (const r of metricsResult.rows) {
        const p = (r.platform as string) || "other";
        const cur = platMap.get(p) || { spend: 0, conversions: 0, clicks: 0, currency: (r.currency as string) || "USD" };
        cur.spend += Number(r.spend || 0);
        cur.conversions += Number(r.conversions || 0);
        cur.clicks += Number(r.clicks || 0);
        platMap.set(p, cur);
      }

      for (const [p, pData] of platMap.entries()) {
        observations.push({
          text: `${p}: ${pData.spend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${pData.currency}, ${pData.conversions.toLocaleString()} conversions, ${pData.clicks.toLocaleString()} clicks.`,
          sources: [p],
        });
      }
    }
  }

  if (suggestedChecks.length === 0) {
    suggestedChecks.push("Verify conversion tracking tags and landing page availability in platform managers.");
    suggestedChecks.push("Inspect ad sets or campaigns with elevated cost per conversion.");
    suggestedChecks.push("Confirm attribution windows and timezone alignments across ad accounts.");
  }

  const mixed = (readiness?.currencies.length ?? 0) > 1;
  limitations.push("Attribution: Platform-reported conversions (CampaignMetric.conversions / revenue); cross-channel deduping is not applied.");
  if (mixed) {
    limitations.push("Currencies: Disparate currencies are tracked separately; no implicit FX blending.");
  }
  limitations.push(`Reporting window: ${window.startDate} to ${window.endDate} (completed UTC days).`);
  if (metricsResult?.truncated) {
    limitations.push("Row limit reached: Query results were capped by plan limits. Campaign-level rankings may not include all campaigns outside the query limit.");
  }
  if (readiness?.blockers?.length) {
    limitations.push(`Readiness blockers: ${readiness.blockers.join(", ")}.`);
  }

  const headline = isHealthQuestion
    ? (isAgencyOverview ? "Agency Data Sources & Health Overview" : `${scopeLabel} — Data Source Health Status`)
    : isComparison
      ? (isAgencyOverview ? "Spend & Conversion Comparison vs Prior Period (Agency Overview)" : `${scopeLabel} — Spend & Conversion Comparison vs Prior Period`)
      : isCampaignContribution
        ? (isAgencyOverview ? "Campaign Revenue Contributions (Agency Overview)" : `${scopeLabel} — Campaign Contributions to Revenue`)
        : (isAgencyOverview ? `Agency Overview across Assigned and Unassigned Accounts (${window.startDate} to ${window.endDate})` : `${scopeLabel} — Performance Summary (${window.startDate} to ${window.endDate})`);

  const structured: AnalystStructuredOutput = {
    headline,
    scopeLabel,
    isAgencyOverview,
    observations,
    suggestedChecks,
    limitations,
  };

  const formattedAnswer = [
    `### ${headline}`,
    `*Scope: ${scopeLabel}*`,
    "",
    "#### Supporting Observations",
    ...observations.map((o) => `- ${o.text}`),
    "",
    "#### Suggested Operational Checks",
    ...suggestedChecks.map((c) => `- ${c}`),
    "",
    "#### Evidence & Limitations",
    ...limitations.map((l) => `- ${l}`),
  ].join("\n");

  return {
    status: "answered",
    answer: formattedAnswer,
    structured,
    evidence: readiness
      ? packFromReadiness(readiness, citations)
      : {
          freshness: "never",
          currencies: [],
          lastDataThrough: null,
          completeness: { sourceCount: 0, partialCount: 0, missingDays: 0 },
          attribution: { model: "platform_reported" },
          citations,
        },
  };
}
