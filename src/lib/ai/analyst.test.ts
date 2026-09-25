import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyQuestion } from "@/lib/ai/classify";

describe("analyst prompts and classification", () => {
  it("correctly classifies all supported English prompt chips", () => {
    const summary = classifyQuestion("Summarize this client’s performance");
    assert.equal(summary.refuse, false);
    assert.equal(summary.intent, "summary");
    assert.deepEqual(summary.tools, ["get_reporting_readiness", "query_metrics"]);

    const compare = classifyQuestion("Compare spend and reported conversions with the previous period");
    assert.equal(compare.refuse, false);
    assert.equal(compare.intent, "comparison");
    assert.deepEqual(compare.tools, ["get_reporting_readiness", "query_metrics"]);

    const campaigns = classifyQuestion("Which campaigns contributed most to the revenue change?");
    assert.equal(campaigns.refuse, false);
    assert.equal(campaigns.intent, "campaign_contribution");
    assert.deepEqual(campaigns.tools, ["get_reporting_readiness", "query_metrics"]);

    const sources = classifyQuestion("Which sources need attention before reporting?");
    assert.equal(sources.refuse, false);
    assert.equal(sources.intent, "health");
    assert.deepEqual(sources.tools, ["get_source_health"]);
  });

  it("correctly classifies all supported Vietnamese prompt chips", () => {
    const summary = classifyQuestion("Tóm tắt hiệu quả của client này");
    assert.equal(summary.refuse, false);
    assert.equal(summary.intent, "summary");
    assert.deepEqual(summary.tools, ["get_reporting_readiness", "query_metrics"]);

    const compare = classifyQuestion("So sánh chi tiêu và chuyển đổi với kỳ trước");
    assert.equal(compare.refuse, false);
    assert.equal(compare.intent, "comparison");
    assert.deepEqual(compare.tools, ["get_reporting_readiness", "query_metrics"]);

    const campaigns = classifyQuestion("Chiến dịch nào đóng góp nhiều nhất vào thay đổi doanh thu?");
    assert.equal(campaigns.refuse, false);
    assert.equal(campaigns.intent, "campaign_contribution");
    assert.deepEqual(campaigns.tools, ["get_reporting_readiness", "query_metrics"]);

    const sources = classifyQuestion("Nguồn dữ liệu nào cần chú ý trước khi báo cáo?");
    assert.equal(sources.refuse, false);
    assert.equal(sources.intent, "health");
    assert.deepEqual(sources.tools, ["get_source_health"]);
  });
});
