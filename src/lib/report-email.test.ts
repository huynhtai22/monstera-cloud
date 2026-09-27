import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderApprovedReportEmail } from "./report-email";
import type { BlueprintReport } from "./report-blueprint";

describe("approved report email rendering", () => {
  it("renders only snapshot values and escapes client-controlled HTML", () => {
    const report = {
      overview: {
        clientName: '<img src=x onerror="alert(1)">\nWeekly',
        generatedAt: "2026-09-20T12:00:00.000Z",
        reportingWindow: { start: "2026-09-07", end: "2026-09-13" },
      },
      totals: {
        spend: 120,
        impressions: 1000,
        clicks: 50,
        conversions: 4,
        conversionValue: null,
        currency: "VND",
        roas: null,
      },
      campaigns: [{
        providerLabel: "<script>provider</script>",
        campaignName: '<svg onload="bad()">Campaign</svg>',
        spend: 120,
        currency: "VND",
        clicks: 50,
        conversions: 4,
      }],
      campaignTruncated: false,
    } as unknown as BlueprintReport;

    const rendered = renderApprovedReportEmail(report);
    assert.equal(rendered.subject.includes("\n"), false);
    assert.match(rendered.subject, /Approved weekly report: .*Weekly/);
    assert.match(rendered.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
    assert.match(rendered.html, /&lt;svg onload=&quot;bad\(\)&quot;&gt;Campaign&lt;\/svg&gt;/);
    assert.doesNotMatch(rendered.html, /<(?:script|svg|img)\b/i);
    assert.match(rendered.html, /Not available/);
    assert.match(rendered.html, /does not confirm inbox delivery/);
  });

  it("bounds campaign detail to 50 rows", () => {
    const report = {
      overview: { clientName: "Client", generatedAt: "2026-09-20", reportingWindow: { start: "2026-09-07", end: "2026-09-13" } },
      totals: { spend: null, impressions: 0, clicks: 0, conversions: 0, conversionValue: null, currency: null, roas: null },
      campaigns: Array.from({ length: 60 }, (_, index) => ({
        providerLabel: "Meta Ads",
        campaignName: `Campaign ${index + 1}`,
        spend: null,
        currency: null,
        clicks: 0,
        conversions: 0,
      })),
      campaignTruncated: false,
    } as unknown as BlueprintReport;

    const rendered = renderApprovedReportEmail(report);
    assert.equal((rendered.html.match(/Campaign \d+/g) ?? []).length, 50);
    assert.match(rendered.html, /Showing 50 campaigns/);
  });
});
