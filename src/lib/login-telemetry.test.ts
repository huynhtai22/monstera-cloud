import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateLoginSignals,
  extractIp,
  extractUserAgent,
  hashTelemetryValue,
  resolveTelemetrySalt,
  telemetryHashesFromRequest,
} from "./login-telemetry";

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://app.example.test/api/auth/test", { headers });
}

describe("login telemetry hashing (P0)", () => {
  it("hashes deterministically with salt and never exposes raw values", () => {
    const a = hashTelemetryValue("192.0.2.1", "salt-1");
    assert.equal(a, hashTelemetryValue("192.0.2.1", "salt-1"));
    assert.notEqual(a, hashTelemetryValue("192.0.2.2", "salt-1"));
    assert.notEqual(a, hashTelemetryValue("192.0.2.1", "salt-2"));
    assert.ok(!a.includes("192.0.2"));
    assert.equal(a.length, 64);
  });

  it("prefers LOGIN_IP_SALT over NEXTAUTH_SECRET with local fallback", () => {
    assert.equal(resolveTelemetrySalt({ LOGIN_IP_SALT: "a", NEXTAUTH_SECRET: "b" } as unknown as NodeJS.ProcessEnv), "a");
    assert.equal(resolveTelemetrySalt({ NEXTAUTH_SECRET: "b" } as unknown as NodeJS.ProcessEnv), "b");
    assert.ok(resolveTelemetrySalt({} as unknown as NodeJS.ProcessEnv).length > 0);
  });

  it("extracts first forwarded IP and truncates user-agent", () => {
    const req = requestWith({
      "x-forwarded-for": "203.0.113.7, 70.41.3.18",
      "user-agent": `Mozilla/5.0 (${"x".repeat(600)})`,
    });
    assert.equal(extractIp(req), "203.0.113.7");
    const ua = extractUserAgent(req);
    assert.ok(ua && ua.length <= 500);
  });

  it("returns null hashes when identity headers are absent", () => {
    const hashes = telemetryHashesFromRequest(requestWith({}));
    assert.equal(hashes.ipHash, null);
    assert.equal(hashes.uaHash, null);
  });

  it("derives stable hashes from request headers", () => {
    const req = requestWith({ "x-forwarded-for": "198.51.100.9", "user-agent": "TestAgent/1.0" });
    const env = { LOGIN_IP_SALT: "test-salt" } as unknown as NodeJS.ProcessEnv;
    const first = telemetryHashesFromRequest(req, env);
    const second = telemetryHashesFromRequest(req, env);
    assert.equal(first.ipHash, second.ipHash);
    assert.equal(first.uaHash, second.uaHash);
    assert.ok(first.ipHash && !first.ipHash.includes("198.51.100"));
  });
});

describe("aggregateLoginSignals (P0)", () => {
  it("counts logins and distinct hashed devices per user", () => {
    const rows = aggregateLoginSignals([
      { userId: "u1", ipHash: "ip-a", uaHash: "ua-a" },
      { userId: "u1", ipHash: "ip-a", uaHash: "ua-b" },
      { userId: "u1", ipHash: "ip-b", uaHash: "ua-b" },
      { userId: "u2", ipHash: null, uaHash: null },
    ]);
    const u1 = rows.find((row) => row.userId === "u1");
    const u2 = rows.find((row) => row.userId === "u2");
    assert.equal(u1?.loginCount, 3);
    assert.equal(u1?.distinctIps, 2);
    assert.equal(u1?.distinctUas, 2);
    assert.equal(u2?.loginCount, 1);
    assert.equal(u2?.distinctIps, 0);
  });
});
