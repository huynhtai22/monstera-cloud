import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { interpretConnectorRequest } from "./coordinator";
import { ProposalSchema, SelectProvidersSchema } from "./tools";
import { ONBOARDING_PROVIDERS } from "./catalog";

const allowed = ONBOARDING_PROVIDERS.map(p => p.id);
describe("bounded onboarding coordinator", () => {
  it("maps natural connector aliases to the same identifiers as direct selection", () => {
    assert.deepEqual(interpretConnectorRequest("Connect TikTok Ads and Facebook", allowed).providerIds, ["tiktok_business", "meta_ads"]);
    assert.deepEqual(interpretConnectorRequest("Google Ads and Shopee", allowed).providerIds, ["google_ads", "shopee"]);
    assert.deepEqual(interpretConnectorRequest("tiktok tiktok meta instagram", allowed).providerIds, ["tiktok_business", "meta_ads"]);
  });
  it("asks rather than proposes when the request is a question, negative or ambiguous", () => {
    for (const text of ["How does Meta Ads work?", "Don't connect Meta", "TikTok instead of Meta", "Google", "connect all", "maybe Shopee", "TikTok but not Meta", "TikTok Shop", "Google Sheets", "connect Shopify and Meta"]) {
      assert.deepEqual(interpretConnectorRequest(text, allowed).providerIds, [], text);
    }
  });
  it("never proposes unavailable providers or non-allowlisted tools", () => {
    const result = interpretConnectorRequest("Connect Meta Ads", ["shopee"]);
    assert.equal(result.unavailable, true); assert.deepEqual(result.providerIds, []);
    assert.equal(ProposalSchema.safeParse({ tool: "execute", providerIds: ["meta_ads"], authorizationUrl: "https://evil.test" }).success, false);
    assert.equal(SelectProvidersSchema.safeParse({ providerIds: ["shopify"], expectedVersion: 1 }).success, false);
  });
});
