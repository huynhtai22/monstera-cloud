import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { packFromReadiness } from "@/lib/ai/analyst";
import type { ReportingReadiness } from "@/lib/reporting-readiness";

describe("analyst mixed-currency eval", () => {
  it("does not export a blended grand total when currencies mix", () => {
    const readiness: ReportingReadiness = {
      status: "ready",
      exportable: true,
      freshness: "fresh",
      currencies: ["VND", "USD"],
      lastDataThrough: "2026-08-20T00:00:00.000Z",
      destinationConfigured: true,
      blockers: [],
      sources: [],
    };
    const pack = packFromReadiness(readiness);
    assert.deepEqual(pack.currencies, ["VND", "USD"]);
    assert.equal("grandTotal" in pack, false);
    assert.equal(pack.attribution.model, "platform_reported");
    assert.equal(pack.attribution.matchRate, undefined);
  });
});
