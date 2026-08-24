import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { signPayOSData, verifyPayOSData } from "./payos";

const previousChecksumKey = process.env.PAYOS_CHECKSUM_KEY;

afterEach(() => {
  if (previousChecksumKey === undefined) delete process.env.PAYOS_CHECKSUM_KEY;
  else process.env.PAYOS_CHECKSUM_KEY = previousChecksumKey;
});

describe("PayOS request and webhook signatures", () => {
  it("creates the documented alphabetically sorted payment-link signature", () => {
    const data = {
      returnUrl: "https://app.example.test/pricing?payment=success",
      orderCode: 123456,
      description: "MC123456",
      cancelUrl: "https://app.example.test/pricing?payment=cancelled",
      amount: 1190000,
    };
    const key = "payos-test-checksum-key";
    const expected = crypto.createHmac("sha256", key)
      .update("amount=1190000&cancelUrl=https://app.example.test/pricing?payment=cancelled&description=MC123456&orderCode=123456&returnUrl=https://app.example.test/pricing?payment=success")
      .digest("hex");

    assert.equal(signPayOSData(data, key), expected);
  });

  it("fails closed for an absent key, missing signature, or altered payment data", () => {
    const data = { amount: 1190000, orderCode: 123456 };
    delete process.env.PAYOS_CHECKSUM_KEY;
    assert.equal(verifyPayOSData(data, "anything"), false);

    process.env.PAYOS_CHECKSUM_KEY = "payos-test-checksum-key";
    const signature = signPayOSData(data);
    assert.equal(verifyPayOSData(data, signature), true);
    assert.equal(verifyPayOSData({ ...data, amount: 1 }, signature), false);
    assert.equal(verifyPayOSData(data, ""), false);
  });
});
