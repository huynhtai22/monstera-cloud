import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { draftMappingProposal } from "./mapping-copilot";

describe("draftMappingProposal", () => {
  it("proposes added Meta keys that are not in fieldMapping", () => {
    const draft = draftMappingProposal("meta_ads", [
      { name: "campaign_id", type: "string" },
      { name: "spend", type: "number" },
      { name: "reach", type: "integer" },
    ]);
    assert.ok(draft);
    assert.ok(draft!.addedFields.includes("reach"));
    assert.equal(draft!.breaking, false);
  });

  it("flags breaking when a required field disappeared", () => {
    const draft = draftMappingProposal("meta_ads", [{ name: "impressions", type: "integer" }]);
    assert.ok(draft);
    assert.equal(draft!.breaking, true);
    assert.ok(draft!.removedFields.includes("campaign_id"));
  });

  it("returns null when the payload matches the registry", () => {
    const draft = draftMappingProposal("meta_ads", [
      { name: "campaign_id", type: "string" },
      { name: "campaign_name", type: "string" },
      { name: "spend", type: "number" },
      { name: "impressions", type: "integer" },
      { name: "clicks", type: "integer" },
      { name: "conversions", type: "number" },
      { name: "actions", type: "array" },
    ]);
    assert.equal(draft, null);
  });
});
