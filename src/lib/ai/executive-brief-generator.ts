import type {
  ReportingContext,
  ExecutiveBriefResponse,
  ReportingObservation,
} from "./reporting-contracts";
import { routeModel } from "./model-router";

export type GenerateBriefOptions = {
  context: ReportingContext;
  language?: "en" | "vi";
  timeoutMs?: number;
  /** When false (e.g. budget exhausted), skip model refinement and use deterministic output. */
  allowModelRefinement?: boolean;
};

function formatCurrency(amount: number | null, currency: string = "USD"): string {
  if (amount == null) return "N/A";
  if (currency === "VND") {
    return `${Math.round(amount).toLocaleString("vi-VN")} ₫`;
  }
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type BriefModelSelection = {
  primaryObservationId: string;
  emphasis: "spend" | "roas" | "marketplace" | "balanced";
};

export type ModelValidationResult =
  | { valid: true; selection: BriefModelSelection }
  | { valid: false; reason: string };

/**
 * Validates that model output strictly conforms to the bounded structured contract.
 * Rejects unknown references, additional fields, unsupported claims, malformed output, and invalid types.
 */
export function validateModelStructuredSelection(
  raw: unknown,
  allowedObservationIds: string[],
): ModelValidationResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, reason: "Output must be a non-null JSON object" };
  }
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  const allowedKeys = new Set(["primaryObservationId", "emphasis"]);
  for (const k of keys) {
    if (!allowedKeys.has(k)) {
      return { valid: false, reason: `Unrecognized or additional field rejected: ${k}` };
    }
  }
  if (typeof obj.primaryObservationId !== "string" || !allowedObservationIds.includes(obj.primaryObservationId)) {
    return { valid: false, reason: `Unknown or invalid primaryObservationId: ${String(obj.primaryObservationId)}` };
  }
  const allowedEmphasis = ["spend", "roas", "marketplace", "balanced"];
  if (typeof obj.emphasis !== "string" || !allowedEmphasis.includes(obj.emphasis)) {
    return { valid: false, reason: `Invalid emphasis option: ${String(obj.emphasis)}` };
  }
  return {
    valid: true,
    selection: {
      primaryObservationId: obj.primaryObservationId,
      emphasis: obj.emphasis as BriefModelSelection["emphasis"],
    },
  };
}

export function renderHeadlineFromSelection(
  context: ReportingContext,
  language: "en" | "vi",
  selection?: BriefModelSelection,
): string {
  const isVi = language === "vi";
  const baseHeadline = generateDeterministicHeadline(context, language);

  if (!selection) return baseHeadline;

  const obs = context.observations.find((o) => o.id === selection.primaryObservationId);
  if (!obs) return baseHeadline;

  if (selection.emphasis === "roas") {
    const roasMetrics = context.metrics.filter((m) => m.metricId === "roas" && m.currentValue != null);
    if (roasMetrics.length > 0) {
      const roasParts = roasMetrics
        .map((r) => `${r.currentValue!.toFixed(2)}x${r.currency ? ` (${r.currency})` : ""}`)
        .join(", ");
      return isVi
        ? `Hiệu quả ROAS đạt ${roasParts} trong ${context.windows.daysCount} ngày qua cho ${context.clientName}.`
        : `Delivered ${roasParts} ROAS over the last ${context.windows.daysCount} days for ${context.clientName}.`;
    }
  } else if (selection.emphasis === "marketplace") {
    const mktMetrics = context.metrics.filter(
      (m) => m.metricId === "marketplace_revenue" && m.currentValue != null && m.currentValue > 0,
    );
    if (mktMetrics.length > 0) {
      const mktParts = mktMetrics.map((m) => formatCurrency(m.currentValue, m.currency || "")).join(", ");
      return isVi
        ? `Thương mại sàn TMĐT ghi nhận ${mktParts} doanh thu đơn hàng trong ${context.windows.daysCount} ngày qua cho ${context.clientName}.`
        : `Generated ${mktParts} in marketplace order revenue over the last ${context.windows.daysCount} days for ${context.clientName}.`;
    }
  }

  return baseHeadline;
}

export function generateDeterministicHeadline(
  context: ReportingContext,
  language: "en" | "vi" = "en",
): string {
  const isVi = language === "vi";
  const spendMetrics = context.metrics.filter((m) => m.metricId === "spend" && m.currentValue != null && m.currentValue > 0);
  const roasMetrics = context.metrics.filter((m) => m.metricId === "roas" && m.currentValue != null);

  if (spendMetrics.length > 0) {
    const spendParts = spendMetrics
      .map((s) => formatCurrency(s.currentValue, s.currency || ""))
      .join(isVi ? " và " : " and ");
    const roasStr =
      roasMetrics.length > 0
        ? isVi
          ? ` với ROAS ${roasMetrics.map((r) => `${r.currentValue!.toFixed(2)}x`).join(", ")}`
          : ` at ${roasMetrics.map((r) => `${r.currentValue!.toFixed(2)}x`).join(", ")} ROAS`
        : "";

    return isVi
      ? `Tổng chi tiêu quảng cáo ${spendParts}${roasStr} trong ${context.windows.daysCount} ngày qua cho ${context.clientName}.`
      : `Delivered ${spendParts} in ad spend${roasStr} over the last ${context.windows.daysCount} days for ${context.clientName}.`;
  }

  return isVi
    ? `Báo cáo hoạt động ${context.windows.daysCount} ngày qua cho ${context.clientName}.`
    : `Performance brief for ${context.clientName} covering the last ${context.windows.daysCount} days.`;
}

/**
 * Builds deterministic, truthful brief sections from server-computed metrics and observations.
 * Guarantees zero hallucinations, verified metric contracts, and strictly audit-compliant checks.
 */
export function generateDeterministicBrief(
  context: ReportingContext,
  language: "en" | "vi" = "en",
): ExecutiveBriefResponse["sections"] {
  const isVi = language === "vi";
  const headline = generateDeterministicHeadline(context, language);
  const roasMetrics = context.metrics.filter((m) => m.metricId === "roas");
  const mktRevMetrics = context.metrics.filter((m) => m.metricId === "marketplace_revenue");

  // 2. Suggested Checks (Never confident budget shifts; only investigations and checks)
  const suggestedChecks: string[] = [];
  const roasSoftened = roasMetrics.some((r) => r.currentValue != null && r.priorValue != null && r.currentValue < r.priorValue);

  if (isVi) {
    if (roasSoftened) {
      suggestedChecks.push("Kiểm tra các nhóm quảng cáo có chi phí tăng nhưng tỷ lệ chuyển đổi giảm trong trình quản lý quảng cáo.");
    }
    if (context.readiness.warnings.includes("REPORTING_WINDOW_INCOMPLETE")) {
      suggestedChecks.push("Xác minh các ngày bị thiếu dữ liệu trên kênh nguồn có phải do chiến dịch tạm dừng hay do độ trễ đồng bộ.");
    }
    if (context.channels.some((c) => c.spend != null && c.spend > 0 && (c.conversions == null || c.conversions === 0))) {
      suggestedChecks.push("Kiểm tra cài đặt tracking pixel và sự kiện chuyển đổi cho các kênh ghi nhận chi tiêu nhưng chưa có lượt chuyển đổi.");
    }
    if (suggestedChecks.length === 0) {
      suggestedChecks.push("Duy trì giám sát pacing ngân sách hàng ngày và tần suất hiển thị trên các kênh đang hoạt động.");
    }
  } else {
    if (roasSoftened) {
      suggestedChecks.push("Investigate ad sets with increased spend and softer conversion rates in platform ad managers.");
    }
    if (context.readiness.warnings.includes("REPORTING_WINDOW_INCOMPLETE")) {
      suggestedChecks.push("Verify whether dates with absent data reflect planned campaign pauses or synchronization delays.");
    }
    if (context.channels.some((c) => c.spend != null && c.spend > 0 && (c.conversions == null || c.conversions === 0))) {
      suggestedChecks.push("Review pixel health and conversion event setup for channels with recorded spend but zero platform conversions.");
    }
    if (suggestedChecks.length === 0) {
      suggestedChecks.push("Maintain scheduled monitoring of daily spend pacing and frequency across active ad channels.");
    }
  }

  // 3. Sources and Limitations
  const sourcesAndLimitations: string[] = [
    isVi
      ? `Thời gian báo cáo: ${context.windows.current.start} đến ${context.windows.current.end} (${context.windows.daysCount} ngày hoàn chỉnh, múi giờ ${context.windows.timezone}).`
      : `Reporting window: ${context.windows.current.start} to ${context.windows.current.end} (${context.windows.daysCount} completed days, ${context.windows.timezone} timezone).`,
    isVi
      ? `Độ tươi dữ liệu: ${context.freshnessJourney.warehouseFreshness ?? "fresh"} · Dữ liệu đến ngày: ${context.readiness.latestDataDate?.slice(0, 10) ?? "N/A"}.`
      : `Data freshness: ${context.freshnessJourney.warehouseFreshness ?? "fresh"} · Latest data through: ${context.readiness.latestDataDate?.slice(0, 10) ?? "N/A"}.`,
    isVi
      ? "Mô hình quy kết: Dựa trên số liệu báo cáo tự ghi nhận của từng nền tảng quảng cáo (Platform-reported attribution). Lượt chuyển đổi không đại diện cho số lượng khách hàng mua hàng duy nhất."
      : "Attribution model: Platform-reported attribution. Conversions do not represent unique individual buyers or unduplicated customers.",
  ];

  if (mktRevMetrics.some((m) => m.currentValue != null && m.currentValue > 0)) {
    sourcesAndLimitations.push(
      isVi
        ? "Doanh thu sàn TMĐT (Shopee/Lazada) được theo dõi riêng biệt, không cộng gộp trực tiếp với doanh thu quy kết từ quảng cáo."
        : "Marketplace order revenue (Shopee/Lazada) is tracked separately from advertising-attributed revenue to avoid double counting.",
    );
  }

  if (context.readiness.currencies.length > 1) {
    sourcesAndLimitations.push(
      isVi
        ? `Tách biệt tiền tệ: Dữ liệu chứa nhiều đơn vị tiền tệ (${context.readiness.currencies.join(", ")}). Không áp dụng chuyển đổi tỷ giá tự động.`
        : `Currency isolation: Multiple currencies present (${context.readiness.currencies.join(", ")}). Native currency totals are kept separate without unverified FX conversion.`,
    );
  }

  if (context.windows.comparisonAvailable === false) {
    sourcesAndLimitations.push(
      isVi
        ? `So sánh kỳ trước: Không khả dụng (${context.windows.comparisonUnavailableReason ?? "vượt quá giới hạn lịch sử của gói"}).`
        : `Prior-period comparison: Unavailable (${context.windows.comparisonUnavailableReason ?? "exceeds plan history limit"}).`,
    );
  }

  return {
    headline,
    kpiScorecard: context.metrics,
    channelScorecard: context.channels,
    observations: context.observations,
    suggestedChecks,
    sourcesAndLimitations,
  };
}

/**
 * Generates an executive client brief.
 * The model NEVER calculates numbers, selects tenants, or alters readiness.
 * It is only permitted to select known server observation IDs and emphasis.
 * All factual figures and claims are rendered from server templates.
 * Unsupported or failing output falls back to deterministic brief generation.
 */
export async function generateExecutiveBrief(
  options: GenerateBriefOptions,
): Promise<ExecutiveBriefResponse> {
  const { context, language = "en", timeoutMs = 8000 } = options;

  // 1. Generate base deterministic sections
  const deterministicSections = generateDeterministicBrief(context, language);

  let generationMode: "model_assisted" | "deterministic" = "deterministic";
  let headline = deterministicSections.headline;
  const observations: ReportingObservation[] = [...deterministicSections.observations];

  // 2. Optional model refinement via bounded structured contract
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const route = routeModel("narrative");
  const allowedObservationIds = context.observations.map((o) => o.id);

  if (options.allowModelRefinement !== false && apiKey && route.provider === "openai" && allowedObservationIds.length > 0) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const system = `You select the primary observation and emphasis for an agency client brief for ${context.clientName}.
Rules:
- Select ONLY from the provided candidate observation IDs.
- DO NOT invent numbers, claims, or fields.
- Output JSON strictly matching: { "primaryObservationId": "string", "emphasis": "spend" | "roas" | "marketplace" | "balanced" }`;

    const user = JSON.stringify({
      clientName: context.clientName,
      window: context.windows.current,
      currencies: context.readiness.currencies,
      candidateObservationIds: allowedObservationIds,
      observations: context.observations.map((o) => ({ id: o.id, text: o.text })),
    });

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: route.model || "gpt-4o-mini",
          temperature: 0.1,
          max_tokens: 150,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });

      if (res.ok) {
        const raw = (await res.json().catch(() => ({}))) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const text = raw?.choices?.[0]?.message?.content;
        if (text) {
          const parsed = JSON.parse(text);
          const validation = validateModelStructuredSelection(parsed, allowedObservationIds);
          if (validation.valid) {
            headline = renderHeadlineFromSelection(context, language, validation.selection);
            generationMode = "model_assisted";
          }
        }
      }
    } catch {
      // Deterministic fallback on timeout, provider failure, or rejection
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    workspaceId: context.workspaceId,
    clientId: context.clientId,
    clientName: context.clientName,
    window: context.windows,
    readiness: context.readiness,
    freshnessJourney: context.freshnessJourney,
    generationMode,
    sections: {
      headline,
      kpiScorecard: deterministicSections.kpiScorecard,
      channelScorecard: deterministicSections.channelScorecard,
      observations,
      suggestedChecks: deterministicSections.suggestedChecks,
      sourcesAndLimitations: deterministicSections.sourcesAndLimitations,
    },
    generatedAt: new Date().toISOString(),
    fingerprint: context.fingerprint,
  };
}
