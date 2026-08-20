import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decrypt, encrypt } from "./encryption";
import { remediateStoredCredentials } from "./credential-remediation";

process.env.ENCRYPTION_KEY = "a".repeat(64);

describe("legacy credential remediation", () => {
  it("encrypts valid plaintext JSON without changing its payload", () => {
    const plaintext = '{"access_token":"secret","shop_id":42}';
    const result = remediateStoredCredentials(plaintext);
    assert.equal(result.action, "encrypted");
    if (result.action === "encrypted") {
      assert.equal(decrypt(result.credentials), plaintext);
      assert.equal(JSON.stringify(result).includes(plaintext), false);
    }
  });

  it("leaves existing ciphertext unchanged", () => {
    const ciphertext = encrypt('{"access_token":"secret"}');
    assert.deepEqual(remediateStoredCredentials(ciphertext), { action: "unchanged" });
  });

  it("replaces malformed plaintext with an encrypted reconnect marker", () => {
    const result = remediateStoredCredentials("not-json");
    assert.equal(result.action, "reconnect_required");
    if (result.action === "reconnect_required") {
      assert.equal(result.reason, "invalid_json");
      assert.deepEqual(JSON.parse(decrypt(result.credentials)), {
        __monsteraCredentialState: "reconnect_required",
      });
    }
  });
});
