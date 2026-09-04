import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";
import { verifySepaySignature, extractSepaySignature } from "./verify-signature";
import { isTransferAmountValid } from "@/lib/vietqr-gateway";
import { POST as sepayWebhook } from "./route";

const SECRET = "sepay-test-secret-0123456789abcdef";

function signedRequest(body: unknown, secret = SECRET, signature?: string): Request {
  const rawBody = JSON.stringify(body);
  const sig = signature ?? crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return new Request("https://app.example.test/api/webhooks/sepay", {
    method: "POST",
    body: rawBody,
    headers: { "content-type": "application/json", "sepay-signature": sig },
  });
}

describe("SePay webhook signature verification", () => {
  it("accepts a correctly signed body", () => {
    const raw = JSON.stringify({ content: "MC123456", transferAmount: 1000 });
    const sig = crypto.createHmac("sha256", SECRET).update(raw, "utf8").digest("hex");
    assert.equal(verifySepaySignature(raw, sig, SECRET), true);
  });

  it("rejects a wrong signature", () => {
    const raw = JSON.stringify({ content: "MC123456", transferAmount: 1000 });
    assert.equal(verifySepaySignature(raw, "deadbeef", SECRET), false);
  });

  it("fails closed when the secret is unset or weak", () => {
    const raw = JSON.stringify({});
    const sig = crypto.createHmac("sha256", SECRET).update(raw, "utf8").digest("hex");
    assert.equal(verifySepaySignature(raw, sig, undefined), false, "no secret configured → reject");
    assert.equal(verifySepaySignature(raw, sig, "short"), false, "weak secret → reject");
  });

  it("rejects a missing signature", () => {
    assert.equal(verifySepaySignature("{}", null, SECRET), false);
  });

  it("rejects signature computed over a different body (tamper)", () => {
    const sig = crypto.createHmac("sha256", SECRET).update('{"content":"MC999999"}', "utf8").digest("hex");
    assert.equal(verifySepaySignature('{"content":"MC123456","transferAmount":1}', sig, SECRET), false);
  });

  it("extracts signature from supported headers and strips sha256= prefix", () => {
    const req = new Request("https://x.test/h", { headers: { "x-sepay-signature": "sha256=abc123" } });
    assert.equal(extractSepaySignature(req), "abc123");
  });
});

describe("SePay webhook route", () => {
  it("returns 401 for an unsigned forged fulfillment attempt", async () => {
    const req = new Request("https://app.example.test/api/webhooks/sepay", {
      method: "POST",
      body: JSON.stringify({ content: "MC123456", transferAmount: 999999 }),
      headers: { "content-type": "application/json" },
    });
    const res = await sepayWebhook(req as any);
    assert.equal(res.status, 401, "unsigned webhook must never reach fulfillment");
  });

  it("returns 401 for a body tampered after signing", async () => {
    const req = signedRequest({ content: "MC123456", transferAmount: 1 }, SECRET, "0".repeat(64));
    const res = await sepayWebhook(req as any);
    assert.equal(res.status, 401);
  });

  it("returns 401 when SEPAY_WEBHOOK_SECRET is not configured (fail closed)", async () => {
    const previous = process.env.SEPAY_WEBHOOK_SECRET;
    delete process.env.SEPAY_WEBHOOK_SECRET;
    const req = signedRequest({ content: "MC123456" }, SECRET);
    const res = await sepayWebhook(req as any);
    assert.equal(res.status, 401);
    if (previous !== undefined) process.env.SEPAY_WEBHOOK_SECRET = previous;
  });
});

describe("VietQR transfer amount validation", () => {
  it("accepts exact and over payments", () => {
    assert.equal(isTransferAmountValid(1_190_000, 1_190_000), true);
    assert.equal(isTransferAmountValid(1_190_000, 1_200_000), true);
    assert.equal(isTransferAmountValid(1_190_000, "1190000"), true);
  });

  it("rejects underpayments", () => {
    assert.equal(isTransferAmountValid(1_190_000, 1_189_999), false);
    assert.equal(isTransferAmountValid(1_190_000, 0), false);
  });

  it("rejects non-numeric amounts", () => {
    assert.equal(isTransferAmountValid(1_190_000, "abc"), false);
    assert.equal(isTransferAmountValid(1_190_000, NaN), false);
  });

  it("rejects missing amounts; there is no manual activation exception", () => {
    assert.equal(isTransferAmountValid(1_190_000, undefined), false);
    assert.equal(isTransferAmountValid(1_190_000, null), false);
  });
});
