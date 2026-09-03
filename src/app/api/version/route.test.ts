import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GET } from "./route";

describe("/api/version endpoint", () => {
  it("returns dynamic release identity and authoritative schema version", async () => {
    const response = await GET();
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.ok(json.commitSha);
    assert.ok(json.commitSource);
    assert.match(json.schemaVersion, /^2026\d{10}_/);
    assert.equal(json.schemaVersion, "20260903120000_payment_order_authoritative");
  });
});
