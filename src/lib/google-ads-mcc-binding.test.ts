import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildGoogleAdsMccBindings } from "./google-ads-mcc-binding";

describe("Google Ads MCC connection binding", () => {
  it("creates one distinct stable binding per MCC and one for an unrelated direct customer", () => {
    const bindings = buildGoogleAdsMccBindings({
      credentials: { accessToken: "test-token" },
      roots: [
        { rootCustomerId: "158-170-9190", isManager: true, customerIds: ["882-600-8231", "966-708-1141"] },
        { rootCustomerId: "777-888-9999", isManager: true, customerIds: ["111-222-3333"] },
        { rootCustomerId: "444-555-6666", isManager: false, customerIds: ["444-555-6666"] },
      ],
    });

    assert.deepEqual(bindings.map((binding) => binding.remoteAccountId), ["1581709190", "7778889999", "4445556666"]);
    assert.deepEqual(bindings[0].credentials.customerIds, ["1581709190"]);
    assert.equal(bindings[0].credentials.mccId, "1581709190");
    assert.deepEqual(bindings[0].credentials.discoveredCustomerIds, ["8826008231", "9667081141"]);
    assert.equal(bindings[0].discoveredCustomerCount, 2);
    assert.equal(bindings[2].credentials.mccId, undefined);
  });

  it("deduplicates repeated roots, preserving an idempotent connection identity", () => {
    const bindings = buildGoogleAdsMccBindings({
      credentials: {},
      roots: [
        { rootCustomerId: "158-170-9190", isManager: true, customerIds: ["882-600-8231"] },
        { rootCustomerId: "1581709190", isManager: true, customerIds: ["8826008231"] },
      ],
    });

    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].remoteAccountId, "1581709190");
  });
});
