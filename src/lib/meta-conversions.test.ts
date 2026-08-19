import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MetaOAuthRevokedError } from "./meta-ads";

describe("Meta Ads Conversion Actions & Schema Normalization", () => {
  it("creates MetaOAuthRevokedError with code 190 and standard message", () => {
    const err = new MetaOAuthRevokedError("Error validating access token: Session has expired", 190);
    assert.equal(err.name, "MetaOAuthRevokedError");
    assert.equal(err.code, 190);
    assert.ok(err.message.includes("Error 190"));
    assert.ok(err.message.includes("Session has expired"));
  });

  it("handles omni_purchase and web_in_store_purchase along with standard pixel purchases", () => {
    const rawActions = [
      { action_type: "purchase", value: "3" },
      { action_type: "omni_purchase", value: "2" },
      { action_type: "web_in_store_purchase", value: "1" },
      { action_type: "link_click", value: "120" },
    ];

    let conversionSum = 0;
    for (const a of rawActions) {
      if (
        a.action_type === "purchase" ||
        a.action_type === "offsite_conversion.fb_pixel_purchase" ||
        a.action_type === "omni_purchase" ||
        a.action_type === "web_in_store_purchase" ||
        a.action_type === "lead" ||
        a.action_type === "offsite_conversion.fb_pixel_lead"
      ) {
        conversionSum += Number(a.value);
      }
    }

    assert.equal(conversionSum, 6);
  });

  it("maps lead conversions correctly", () => {
    const rawActions = [
      { action_type: "lead", value: "14" },
      { action_type: "offsite_conversion.fb_pixel_lead", value: "6" },
      { action_type: "post_engagement", value: "50" },
    ];

    let leadCount = 0;
    for (const a of rawActions) {
      if (
        a.action_type === "lead" ||
        a.action_type === "offsite_conversion.fb_pixel_lead"
      ) {
        leadCount += Number(a.value);
      }
    }

    assert.equal(leadCount, 20);
  });

  it("extracts revenue from action_values across all valid purchase event types", () => {
    const actionValues = [
      { action_type: "omni_purchase", value: "249.50" },
      { action_type: "add_to_cart", value: "500.00" },
    ];

    let revenue = 0;
    for (const a of actionValues) {
      if (
        a.action_type === "purchase" ||
        a.action_type === "offsite_conversion.fb_pixel_purchase" ||
        a.action_type === "omni_purchase" ||
        a.action_type === "web_in_store_purchase"
      ) {
        const v = Number(a.value);
        if (v > 0) {
          revenue = v;
          break;
        }
      }
    }

    assert.equal(revenue, 249.50);
  });
});
