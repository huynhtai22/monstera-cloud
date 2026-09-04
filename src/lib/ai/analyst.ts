import { classifyQuestion, refusalMessage, type QuestionClass } from "@/lib/ai/classify";
import { getAiTool } from "@/lib/ai/tools";
import type { AiToolContext, AiToolResult } from "@/lib/ai/tools/types";
import type { EvidencePack } from "@/lib/ai/evidence-pack";
import type { ReportingReadiness } from "@/lib/reporting-readiness";
import {
  contextStrip,
  formatGovernedAnswer,
  generateGovernedNarrative,
  type NarrativeUsage,
} from "@/lib/ai/narrative";

export type AnalystTurnStatus = "answered" | "refused" | "queued";

export type AnalystTurnResult = {
  status: AnalystTurnStatus;
  turnId?: string;
  answer?: string;
  refusalCode?: string;
  blockers?: string[];
  evidence?: EvidencePack;
  queuedCopy?: string;
  usage?: NarrativeUsage;
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
    actorUserId: opts.actorUserId,
    jobId: opts.jobId ?? (role === "cron" ? "cron" : "interactive"),
    role,
  };
  const window = defaultWindow();
  const citations: EvidencePack["citations"] = [];
  const toolNotes: string[] = [];
  let readiness: ReportingReadiness | null = null;
  let bestEffort = false;

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
      if (readiness.status === "blocked" && opts.acknowledgeBestEffort) {
        bestEffort = true;
      }
    }
    toolNotes.push(`${name}: ${JSON.stringify(result.data).slice(0, 4000)}`);
  }

  const strip = contextStrip(readiness, { bestEffort });
  const dump = toolNotes.join("\n\n");
  let body = dump;
  let usage: NarrativeUsage | undefined;
  // Interactive only: nightly Hobby budget cannot wait on Grok for a batch of jobs.
  if (role === "interactive") {
    const narrative = await generateGovernedNarrative({ question: opts.question, toolNotes });
    if (narrative?.prose) {
      body = narrative.prose;
      usage = narrative.usage;
    }
  }

  return {
    status: "answered",
    answer: formatGovernedAnswer(strip, body),
    blockers: bestEffort ? ["best_effort", ...(readiness?.blockers ?? [])] : readiness?.blockers,
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
    usage,
  };
}
