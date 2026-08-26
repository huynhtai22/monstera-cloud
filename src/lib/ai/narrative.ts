import { logger } from "@/lib/logger";
import { routeModel } from "@/lib/ai/model-router";
import type { ReportingReadiness } from "@/lib/reporting-readiness";

export const NARRATIVE_PROMPT_VERSION = "analyst.narrative.v1";

export type NarrativeUsage = {
  provider: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type NarrativeResult = {
  prose: string;
  usage: NarrativeUsage;
};

/** Grok 4.6 list prices (docs.x.ai, <200k prompt). */
const XAI_INPUT_PER_M = 2.0;
const XAI_OUTPUT_PER_M = 6.0;

export function estimateXaiCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * XAI_INPUT_PER_M + (outputTokens / 1_000_000) * XAI_OUTPUT_PER_M;
}

export function contextStrip(
  readiness: ReportingReadiness | null,
  opts?: { bestEffort?: boolean },
): string[] {
  const mixed = (readiness?.currencies.length ?? 0) > 1;
  const lines = [
    `Freshness: ${readiness?.freshness ?? "unknown"}`,
    `Currency: ${readiness?.currencies.join(", ") || "unknown"}${mixed ? " (per-currency totals only; not blended)" : ""}`,
    "Attribution: platform-reported conversions (CampaignMetric.conversions / revenue)",
    `Completeness: ${readiness?.sources.length ?? 0} sources; blockers: ${(readiness?.blockers ?? []).join(", ") || "none"}`,
  ];
  if (opts?.bestEffort) {
    lines.push("Best-effort — not exportable as a client brief.");
  }
  return lines;
}

export function formatGovernedAnswer(strip: string[], body: string): string {
  const header = strip.map((line) => `- ${line}`).join("\n");
  const prose = body.trim();
  return prose ? `${header}\n\n${prose}` : header;
}

const SYSTEM = `You write a short warehouse brief for a SEA media-buying agency.
You receive ONLY tool JSON from this workspace. Rules:
- Do not invent numbers, platforms, dates, currencies, or accounts.
- Do not blend currencies or FX-convert.
- If the JSON is sparse or empty, say the warehouse cannot support a stronger claim.
- Do not output a freshness/currency/attribution/completeness header — the host prepends it.
- 3 to 6 short sentences or bullets. Plain language.`;

export async function generateGovernedNarrative(opts: {
  question: string;
  toolNotes: string[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<NarrativeResult | null> {
  const route = routeModel("narrative");
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (route.provider !== "xai" || !apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: route.model,
        temperature: 0,
        max_tokens: route.maxTokens,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Question: ${opts.question}\n\nTool JSON:\n${opts.toolNotes.join("\n\n").slice(0, 12_000)}`,
          },
        ],
      }),
    });
    const raw = (await res.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };
    if (!res.ok) {
      logger.warn("[analyst.narrative] xAI error", res.status, raw?.error?.message);
      return null;
    }
    const prose = raw?.choices?.[0]?.message?.content?.trim();
    if (!prose) return null;
    const inputTokens = Number(raw.usage?.prompt_tokens ?? 0);
    const outputTokens = Number(raw.usage?.completion_tokens ?? 0);
    return {
      prose,
      usage: {
        provider: route.provider,
        model: route.model,
        promptVersion: NARRATIVE_PROMPT_VERSION,
        inputTokens,
        outputTokens,
        costUsd: estimateXaiCostUsd(inputTokens, outputTokens),
      },
    };
  } catch (error) {
    logger.warn("[analyst.narrative] skipped", error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
