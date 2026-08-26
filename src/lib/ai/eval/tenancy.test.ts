import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { queryMetricsTool } from "@/lib/ai/tools/query-metrics";

describe("analyst tenancy eval", () => {
  it("throws when the model supplies a different workspaceId", async () => {
    await assert.rejects(
      () =>
        queryMetricsTool.execute(
          { workspaceId: "ws_a", jobId: "t", role: "interactive" },
          { workspaceId: "ws_b", startDate: "2026-08-01", endDate: "2026-08-07" },
        ),
      /tenant mismatch/,
    );
  });
});
