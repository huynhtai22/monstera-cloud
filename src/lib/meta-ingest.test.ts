import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterFieldsForLevel,
  META_DEFAULT_FIELDS,
} from "./meta-ads";
import {
  buildBreakdownHash,
} from "./meta-ingest";
import { normalizeMetaAdAccountIdForApi } from "./ingestion/meta-campaign-metrics";

describe("Meta Ads Ingestion & Field Sanitization", () => {
  it("filters out invalid ad/adset fields when querying at campaign level", () => {
    const fields = ["campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name", "spend", "impressions"];
    const sanitized = filterFieldsForLevel(fields, "campaign");

    assert.deepEqual(sanitized, ["campaign_id", "campaign_name", "spend", "impressions"]);
    assert.ok(!sanitized.includes("ad_id"));
    assert.ok(!sanitized.includes("adset_id"));
  });

  it("filters out ad fields when querying at adset level", () => {
    const fields = ["campaign_id", "adset_id", "ad_id", "spend"];
    const sanitized = filterFieldsForLevel(fields, "adset");

    assert.deepEqual(sanitized, ["campaign_id", "adset_id", "spend"]);
    assert.ok(!sanitized.includes("ad_id"));
  });

  it("allows all fields when querying at ad level", () => {
    const fields = ["campaign_id", "adset_id", "ad_id", "spend"];
    const sanitized = filterFieldsForLevel(fields, "ad");

    assert.deepEqual(sanitized, fields);
  });

  it("normalizes ad account IDs by stripping redundant act_ prefixes", () => {
    assert.equal(normalizeMetaAdAccountIdForApi("act_903293012481547"), "903293012481547");
    assert.equal(normalizeMetaAdAccountIdForApi("903293012481547"), "903293012481547");
    assert.equal(normalizeMetaAdAccountIdForApi("ACT_12345"), "12345");
  });

  it("generates deterministic breakdown hashes", () => {
    const row = { age: "25-34", gender: "female", impressions: "100" };
    const hash1 = buildBreakdownHash(row, ["age", "gender"]);
    const hash2 = buildBreakdownHash(row, ["age", "gender"]);
    assert.equal(hash1, hash2);

    const hashEmpty = buildBreakdownHash(row, []);
    assert.equal(hashEmpty, "none");
  });
});
