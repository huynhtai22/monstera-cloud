import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPostLoginRedirectPath } from "./post-login-redirect";

describe("post-login redirect", () => {
  it("sends Start (free) users to the console, not /pricing", () => {
    assert.equal(getPostLoginRedirectPath("free", "/console"), "/console");
    assert.equal(getPostLoginRedirectPath("free", "/sources"), "/sources");
  });

  it("keeps paid and pilot users on the requested app path", () => {
    assert.equal(getPostLoginRedirectPath("starter", "/console"), "/console");
    assert.equal(getPostLoginRedirectPath("professional", "/sources"), "/sources");
    assert.equal(getPostLoginRedirectPath("pilot", "/console"), "/console");
  });
});
