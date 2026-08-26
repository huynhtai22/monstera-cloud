import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FLAGSHIP_REFUSAL_QUESTION, classifyQuestion } from "@/lib/ai/classify";

describe("analyst refusal eval", () => {
  it("refuses the flagship identity / first-time Vietnam → Shopee question", () => {
    const c = classifyQuestion(FLAGSHIP_REFUSAL_QUESTION);
    assert.equal(c.refuse, true);
    assert.equal(c.intent, "identity_attribution");
    assert.equal(c.refusalCode, "out_of_envelope");
  });

  it("refuses budget writes", () => {
    const c = classifyQuestion("Reallocate $500 from Google to TikTok tomorrow automatically");
    assert.equal(c.refuse, true);
    assert.equal(c.intent, "budget_write");
  });

  it("allows a legal warehouse health question", () => {
    const c = classifyQuestion("Why is Meta stale?");
    assert.equal(c.refuse, false);
    assert.deepEqual(c.tools, ["get_source_health"]);
    assert.equal(c.needsQueue, false);
  });

  it("queues an executive brief for the nightly worker instead of refusing", () => {
    const c = classifyQuestion("Write an executive brief of last week spend");
    assert.equal(c.refuse, false);
    assert.equal(c.needsQueue, true);
    assert.deepEqual(c.tools, ["get_reporting_readiness", "query_metrics"]);
  });
});
