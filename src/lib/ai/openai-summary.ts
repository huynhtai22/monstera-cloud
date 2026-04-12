const DEFAULT_MODEL = "gpt-4o-mini";

export type PerformanceSummaryResult = {
    summary: string;
    bullets: string[];
    model: string;
};

/**
 * Cheap, fast model for short structured summaries. Uses OpenAI Chat Completions.
 * Set OPENAI_API_KEY. Override model with AI_SUMMARY_MODEL (e.g. gpt-4o-mini).
 */
export async function generatePerformanceSummary(contextJson: unknown): Promise<PerformanceSummaryResult> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
        throw new Error("OPENAI_API_KEY is not configured");
    }

    const model = process.env.AI_SUMMARY_MODEL?.trim() || DEFAULT_MODEL;

    const system = `You are an analyst for a marketing analytics / ETL product (Monstera Cloud).
You receive ONLY JSON metrics for one workspace for the last 7 days. Write:
1) A "summary" field: 2 short sentences for a busy agency lead (plain language).
2) A "bullets" field: array of 3 to 5 short bullet strings (actionable or observational).
Rules: Do not invent numbers or platforms not in the JSON. If data is sparse or empty, say so clearly.
Output valid JSON only with keys "summary" (string) and "bullets" (array of strings).`;

    const user = `Metrics JSON:\n${JSON.stringify(contextJson, null, 0)}`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model,
            temperature: 0.3,
            max_tokens: 500,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: system },
                { role: "user", content: user },
            ],
        }),
    });

    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg =
            typeof raw?.error?.message === "string"
                ? raw.error.message
                : `OpenAI error ${res.status}`;
        throw new Error(msg);
    }

    const text = raw?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
        throw new Error("Empty model response");
    }

    let parsed: { summary?: string; bullets?: unknown };
    try {
        parsed = JSON.parse(text) as { summary?: string; bullets?: unknown };
    } catch {
        throw new Error("Model returned non-JSON");
    }

    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const bullets = Array.isArray(parsed.bullets)
        ? parsed.bullets.filter((b): b is string => typeof b === "string").map((b) => b.trim()).filter(Boolean)
        : [];

    if (!summary && bullets.length === 0) {
        throw new Error("Invalid summary shape from model");
    }

    return {
        summary: summary || "No summary generated.",
        bullets,
        model,
    };
}
