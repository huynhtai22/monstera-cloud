import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { generateApiKey, hashApiKey } from "./api-key-security";
import { decrypt, encrypt, isEncrypted, safeDecrypt } from "./encryption";
import { normalizeEmail, normalizeWorkspaceSlug } from "./invitation-security";
import { isOAuthAttemptValid } from "./oauth-attempt";
import { hasRole, sanitizeRole } from "./rbac";
import { hasBearerSecret, requireCronSecret } from "./request-auth";
import { mergeWorkspaceWhere } from "./workspace-scope";

const originalEncryptionKey = process.env.ENCRYPTION_KEY;
const originalCronSecret = process.env.CRON_SECRET;
const testEncryptionKey = "01".repeat(32);

function tamperFinalCiphertextByte(encrypted: string): string {
  const [iv, authTag, ciphertext, ...extra] = encrypted.split(":");
  if (!iv || !authTag || !ciphertext || extra.length > 0 || !/^[0-9a-f]+$/i.test(ciphertext) || ciphertext.length < 2) {
    throw new Error("Expected encrypted ciphertext with a non-empty hexadecimal payload");
  }

  const finalByte = ciphertext.slice(-2);
  const replacement = finalByte.toLowerCase() === "00" ? "01" : "00";
  return `${iv}:${authTag}:${ciphertext.slice(0, -2)}${replacement}`;
}

function encryptWithFinalCiphertextByte(finalByte: number): string {
  const key = Buffer.from(testEncryptionKey, "hex");
  const iv = Buffer.alloc(16, 0x5a);
  const probe = crypto.createCipheriv("aes-256-gcm", key, iv);
  const streamByte = probe.update(Buffer.from([0]))[0];
  probe.final();

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from([streamByte ^ finalByte])),
    cipher.final(),
  ]).toString("hex");

  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${ciphertext}`;
}

afterEach(() => {
  if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalEncryptionKey;
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCronSecret;
});

describe("pilot security primitives", () => {
  it("generates a one-time API secret with only a deterministic hash for persistence", () => {
    const generated = generateApiKey();
    assert.match(generated.secret, /^mc_live_/);
    assert.equal(generated.keyHash, hashApiKey(generated.secret));
    assert.equal(generated.keyLastFour, generated.secret.slice(-4));
    assert.notEqual(generated.keyHash, generated.secret);
  });

  it("accepts bearer secrets only when configured and exact", () => {
    const request = new Request("https://example.test", { headers: { authorization: "Bearer expected-value" } });
    assert.equal(hasBearerSecret(request, undefined), false);
    assert.equal(hasBearerSecret(request, "wrong-value"), false);
    assert.equal(hasBearerSecret(request, "expected-value"), true);
  });

  it("fails cron authentication closed when CRON_SECRET is absent", () => {
    delete process.env.CRON_SECRET;
    const response = requireCronSecret(new Request("https://example.test"));
    assert.equal(response?.status, 503);

    process.env.CRON_SECRET = "too-short";
    const weakSecretResponse = requireCronSecret(new Request("https://example.test", {
      headers: { authorization: "Bearer too-short" },
    }));
    assert.equal(weakSecretResponse?.status, 503);
  });

  it("rejects plaintext credential payloads and detects ciphertext tampering", () => {
    process.env.ENCRYPTION_KEY = testEncryptionKey;
    assert.throws(() => safeDecrypt('{"accessToken":"plaintext"}'), /not encrypted/);
    const ciphertext = encrypt("sensitive");
    assert.equal(decrypt(ciphertext), "sensitive");
    const tampered = tamperFinalCiphertextByte(ciphertext);
    assert.notEqual(tampered, ciphertext);
    assert.equal(isEncrypted(tampered), true);
    assert.throws(() => decrypt(tampered), /authenticate|auth/i);
  });

  it("always changes and invalidates the final authenticated ciphertext byte", () => {
    process.env.ENCRYPTION_KEY = testEncryptionKey;

    for (const finalByte of [0x7f, 0x00]) {
      const ciphertext = encryptWithFinalCiphertextByte(finalByte);
      const tampered = tamperFinalCiphertextByte(ciphertext);

      assert.equal(ciphertext.split(":")[2]?.slice(-2).toLowerCase(), finalByte.toString(16).padStart(2, "0"));
      assert.doesNotThrow(() => decrypt(ciphertext));
      assert.notEqual(tampered, ciphertext);
      assert.equal(isEncrypted(tampered), true);
      assert.throws(() => decrypt(tampered), /authenticate|auth/i);
    }
  });

  it("enforces the complete workspace role hierarchy", () => {
    const member = (role: "owner" | "admin" | "member" | "viewer") => ({ userId: "u", workspaceId: "w", role });
    const roles = ["viewer", "member", "admin", "owner"] as const;
    roles.forEach((actual, actualIndex) => {
      roles.forEach((required, requiredIndex) => {
        assert.equal(hasRole(member(actual), required), actualIndex >= requiredIndex, `${actual} -> ${required}`);
      });
    });
    assert.equal(sanitizeRole("forged-role"), "viewer");
  });

  it("never allows caller filters to replace the enforced workspace scope", () => {
    assert.deepEqual(mergeWorkspaceWhere("tenant-a", { id: "resource-1" }), {
      id: "resource-1",
      workspaceId: "tenant-a",
    });
    assert.throws(
      () => mergeWorkspaceWhere("tenant-a", { id: "resource-1", workspaceId: "tenant-b" }),
      /scope mismatch/,
    );
  });

  it("rejects expired, reused, provider-mismatched and user-mismatched OAuth attempts", () => {
    const valid = { provider: "meta_ads", userId: "user-a", consumedAt: null, expiresAt: new Date("2030-01-01") };
    const input = { provider: "meta_ads", sessionUserId: "user-a" };
    const now = new Date("2029-01-01");
    assert.equal(isOAuthAttemptValid(valid, input, now), true);
    assert.equal(isOAuthAttemptValid({ ...valid, expiresAt: new Date("2028-01-01") }, input, now), false);
    assert.equal(isOAuthAttemptValid({ ...valid, consumedAt: new Date() }, input, now), false);
    assert.equal(isOAuthAttemptValid(valid, { ...input, provider: "google_ads" }, now), false);
    assert.equal(isOAuthAttemptValid(valid, { ...input, sessionUserId: "user-b" }, now), false);
  });

  it("normalizes invitation identity and agency slugs", () => {
    assert.equal(normalizeEmail("  Owner@Agency.COM "), "owner@agency.com");
    assert.equal(normalizeWorkspaceSlug(" My Agency! 2026 "), "my-agency-2026");
  });
});
