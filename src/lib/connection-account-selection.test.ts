import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authorizedConnectionAccountIds,
  validateConnectionAccountSelection,
} from "./connection-account-selection";

describe("connection account selection", () => {
  it("uses only account IDs disclosed by the OAuth connection", () => {
    const authorized = authorizedConnectionAccountIds("google_ads", {
      extraFields: { customerIds: ["123-456-7890"] },
      customerIds: ["should-not-be-needed"],
    });
    assert.deepEqual(authorized, ["123-456-7890", "should-not-be-needed"]);

    assert.deepEqual(
      validateConnectionAccountSelection({
        provider: "google_ads",
        authorizedIds: authorized,
        selectedIds: ["1234567890", "123-456-7890"],
      }),
      { ok: true, selectedIds: ["123-456-7890"] },
    );
  });

  it("rejects an account that this connection did not authorize", () => {
    assert.deepEqual(
      validateConnectionAccountSelection({
        provider: "tiktok_business",
        authorizedIds: ["advertiser-a"],
        selectedIds: ["advertiser-b"],
      }),
      { ok: false, error: "unavailable_account" },
    );
  });

  it("rejects malformed input and de-duplicates valid selections", () => {
    assert.deepEqual(
      validateConnectionAccountSelection({
        provider: "meta_ads",
        authorizedIds: ["act_1", "act_2"],
        selectedIds: ["act_1", "act_1", "act_2"],
      }),
      { ok: true, selectedIds: ["act_1", "act_2"] },
    );
    assert.deepEqual(
      validateConnectionAccountSelection({
        provider: "meta_ads",
        authorizedIds: ["act_1"],
        selectedIds: [""],
      }),
      { ok: false, error: "invalid_selection" },
    );
  });
});
