import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { routeModel } from "@/lib/ai/model-router";
import {
  contextStrip,
  estimateXaiCostUsd,
  formatGovernedAnswer,
  generateGovernedNarrative,
} from "@/lib/ai/narrative";
import type { ReportingReadiness } from "@/lib/reporting-readiness";

const readiness = {
  status: "ready",
  freshness: "fresh",
  currencies: ["USD", "VND"],
  lastDataThrough: "2026-08-25",
  blockers: [],
  sources: [{ connectionId: "c1", health: "fresh" }, { connectionId: "c2", health: "fresh" }],
} as unknown as ReportingReadiness;

describe("governed narrative", () => {
  const prevKey = process.env.XAI_API_KEY;
  afterEach(() => {
    if (prevKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = prevKey;
  });

  it("eval judge stays off the generator vendor", () => {
    const judge = routeModel("eval_judge");
    const narrative = routeModel("narrative");
    assert.equal(judge.provider, "deterministic");
    assert.equal(narrative.provider, "xai");
    assert.equal(narrative.model, "grok-4.6");
  });

  it("always prefixes freshness, currency, attribution, completeness", () => {
    const strip = contextStrip(readiness);
    const answer = formatGovernedAnswer(strip, "Meta spend was 120.");
    assert.match(answer, /^- Freshness: fresh/m);
    assert.match(answer, /per-currency totals only; not blended/);
    assert.match(answer, /platform-reported conversions/);
    assert.match(answer, /Completeness: 2 sources/);
    assert.ok(answer.indexOf("Freshness") < answer.indexOf("Meta spend"));
  });

  it("marks best-effort answers as not exportable", () => {
    const strip = contextStrip(readiness, { bestEffort: true });
    const answer = formatGovernedAnswer(strip, "Partial view only.");
    assert.match(answer, /Best-effort — not exportable as a client brief/);
  });

  it("skips the LLM when XAI_API_KEY is missing", async () => {
    delete process.env.XAI_API_KEY;
    const result = await generateGovernedNarrative({
      question: "How is Meta?",
      toolNotes: ['query_metrics: {"spend":1}'],
      fetchImpl: async () => {
        throw new Error("must not call xAI without a key");
      },
    });
    assert.equal(result, null);
  });

  it("returns model prose and usage from xAI chat completions", async () => {
    process.env.XAI_API_KEY = "xai-test";
    const result = await generateGovernedNarrative({
      question: "How is Meta?",
      toolNotes: ['query_metrics: {"spend":120}'],
      fetchImpl: async (input, init) => {
        assert.equal(String(input), "https://api.x.ai/v1/chat/completions");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, "grok-4.6");
        assert.equal(body.temperature, 0);
        assert.match(body.messages[1].content, /spend":120/);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Spend was 120 in the tool JSON." } }],
            usage: { prompt_tokens: 100, completion_tokens: 20 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });
    assert.ok(result);
    assert.equal(result!.prose, "Spend was 120 in the tool JSON.");
    assert.equal(result!.usage.provider, "xai");
    assert.equal(result!.usage.model, "grok-4.6");
    assert.equal(result!.usage.inputTokens, 100);
    assert.equal(result!.usage.outputTokens, 20);
    assert.equal(result!.usage.costUsd, estimateXaiCostUsd(100, 20));
  });
});
