import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { hashLegacyTelemetryValue } from "./login-telemetry";
import { hashApiKey, isApiKeyIpAllowed, pinHashForRequest } from "./api-key-security";

const managedKeys = [
  "API_KEY_PIN_SALT",
  "API_KEY_PIN_SALT_VERSION",
  "API_KEY_PIN_SALT_PREVIOUS",
  "API_KEY_PIN_SALT_PREVIOUS_VERSION",
  "LOGIN_IP_SALT",
  "API_KEY_HASH_PEPPER",
  "API_KEY_HASH_PEPPER_PREVIOUS",
  "ENCRYPTION_KEY",
  "NEXTAUTH_SECRET",
] as const;

describe("versioned API-key pin salts", () => {
  const saved = new Map<string, string | undefined>();
  const request = new Request("https://example.test", { headers: { "x-forwarded-for": "192.0.2.44" } });

  beforeEach(() => {
    for (const key of managedKeys) saved.set(key, process.env[key]);
  });
  afterEach(() => {
    for (const key of managedKeys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("accepts the previous version during rotation and rejects it after overlap removal", () => {
    process.env.API_KEY_PIN_SALT = "pin-salt-v2";
    process.env.API_KEY_PIN_SALT_VERSION = "v2";
    const oldPin = pinHashForRequest(request);
    assert.match(oldPin ?? "", /^v2:[0-9a-f]{64}$/);

    process.env.API_KEY_PIN_SALT = "pin-salt-v3";
    process.env.API_KEY_PIN_SALT_VERSION = "v3";
    process.env.API_KEY_PIN_SALT_PREVIOUS = "pin-salt-v2";
    process.env.API_KEY_PIN_SALT_PREVIOUS_VERSION = "v2";
    assert.equal(isApiKeyIpAllowed({ allowedIpHash: oldPin }, request), true);

    delete process.env.API_KEY_PIN_SALT_PREVIOUS;
    delete process.env.API_KEY_PIN_SALT_PREVIOUS_VERSION;
    assert.equal(isApiKeyIpAllowed({ allowedIpHash: oldPin }, request), false);
  });

  it("keeps pre-versioning pins valid through the migration window", () => {
    process.env.LOGIN_IP_SALT = "legacy-login-salt";
    process.env.API_KEY_PIN_SALT = "new-pin-salt";
    process.env.API_KEY_PIN_SALT_VERSION = "v2";
    const legacy = hashLegacyTelemetryValue("192.0.2.44", "legacy-login-salt");
    assert.equal(isApiKeyIpAllowed({ allowedIpHash: legacy }, request), true);
  });

  it("keeps versioned pre-HMAC pins valid during salt rotation", () => {
    process.env.API_KEY_PIN_SALT = "pin-salt-v2";
    process.env.API_KEY_PIN_SALT_VERSION = "v2";
    const legacy = `v2:${hashLegacyTelemetryValue("192.0.2.44", "pin-salt-v2")}`;
    assert.equal(isApiKeyIpAllowed({ allowedIpHash: legacy }, request), true);
  });
});

describe("peppered API-key verifiers", () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of managedKeys) saved.set(key, process.env[key]);
  });
  afterEach(() => {
    for (const key of managedKeys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("stores a versioned HMAC and separates independent peppers", () => {
    process.env.API_KEY_HASH_PEPPER = "pepper-one";
    const first = hashApiKey("mc_live_test-secret");
    process.env.API_KEY_HASH_PEPPER = "pepper-two";
    const second = hashApiKey("mc_live_test-secret");

    assert.match(first, /^h2:[0-9a-f]{64}$/);
    assert.match(second, /^h2:[0-9a-f]{64}$/);
    assert.notEqual(first, second);
  });
});
