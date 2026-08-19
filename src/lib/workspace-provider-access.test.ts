import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ProviderAccessError, toProviderAccessResponse } from "./workspace-provider-access";

describe("provider access errors", () => {
  it("maps a provider denial to a closed 403", () => {
    const response = toProviderAccessResponse(new ProviderAccessError("Provider is not enabled for this workspace"));
    assert.ok(response);
    assert.equal(response.status, 403);
    assert.equal(toProviderAccessResponse(new Error("nope")), null);
  });
});

describe("connect flags still close uncertified providers", () => {
  const original = process.env.AMAZON_CONNECT_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.AMAZON_CONNECT_ENABLED;
    else process.env.AMAZON_CONNECT_ENABLED = original;
  });

  it("does not treat Amazon as connectable by default", async () => {
    delete process.env.AMAZON_CONNECT_ENABLED;
    const { isConnectEnabled } = await import("./integration-flags");
    assert.equal(isConnectEnabled("amazon"), false);
    assert.equal(isConnectEnabled("meta_ads"), true);
  });
});
