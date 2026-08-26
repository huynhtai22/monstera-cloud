import { classifyQuestion, refusalMessage, type QuestionClass } from "@/lib/ai/classify";
import { getAiTool } from "@/lib/ai/tools";
import type { AiToolContext, AiToolResult } from "@/lib/ai/tools/types";
import type { EvidencePack } from "@/lib/ai/evidence-pack";
import type { ReportingReadiness } from "@/lib/reporting-readiness";

export type AnalystTurnStatus = "answered" | "refused" | "queued";

export type AnalystTurnResult = {
  status: AnalystTurnStatus;
  turnId?: string;
  answer?: string;
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
}): Promise<AnalystTurnResult> {
  const classified: QuestionClass = classifyQuestion(opts.question);
  if (classified.refuse) {
    return {
      status: "refused",
      answer: refusalMessage(classified.refusalCode ?? "out_of_envelope"),
      refusalCode: classified.refusalCode,
      blockers: [classified.refusalCode ?? "out_of_envelope"],
    };
  }

  if (classified.tools.length > 2 || classified.needsQueue) {
    return { status: "queued", queuedCopy: QUEUED_COPY };
  }

  const ctx: AiToolContext = {
    workspaceId: opts.workspaceId,
    actorUserId: opts.actorUserId,
    jobId: opts.jobId ?? "interactive",
    role: "interactive",
  };
  const window = defaultWindow();
  const citations: EvidencePack["citations"] = [];
  const toolNotes: string[] = [];
  let readiness: ReportingReadiness | null = null;

  for (const name of classified.tools) {
    const tool = getAiTool(name);
    if (!tool) continue;
    const args: Record<string, unknown> = {
      since: window.startDate,
      until: window.endDate,
      startDate: window.startDate,
      endDate: window.endDate,
      clientId: opts.clientId,
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
    }
    toolNotes.push(`${name}: ${JSON.stringify(result.data).slice(0, 4000)}`);
  }

  const mixed = (readiness?.currencies.length ?? 0) > 1;
  const banners = [
    `Freshness: ${readiness?.freshness ?? "unknown"}`,
    `Currency: ${readiness?.currencies.join(", ") || "unknown"}${mixed ? " (per-currency totals only; not blended)" : ""}`,
    "Attribution: platform-reported conversions (CampaignMetric.conversions / revenue)",
    `Completeness: ${readiness?.sources.length ?? 0} sources; blockers: ${(readiness?.blockers ?? []).join(", ") || "none"}`,
  ];

  return {
    status: "answered",
    answer: `${banners.map((b) => `- ${b}`).join("\n")}\n\n${toolNotes.join("\n\n")}`,
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
