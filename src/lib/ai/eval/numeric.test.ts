import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeToolResult } from "@/lib/ai/sanitize";

describe("analyst numeric fidelity eval", () => {
  it("passes tool numbers through unchanged", () => {
    const out = sanitizeToolResult({
      columns: ["date", "metric:spend"],
      rows: [{ date: "2026-08-20", "metric:spend": 123.45 }],
    }) as { rows: Array<Record<string, unknown>> };
    assert.equal(out.rows[0]["metric:spend"], 123.45);
  });
});
