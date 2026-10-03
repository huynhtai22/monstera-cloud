import { createHmac } from "node:crypto";

const RECIPIENT_HASH_DOMAIN = "monstera:approved-report-email:recipient:v1";

/** Stable practical email canonicalization for idempotency comparison. */
export function canonicalizeReportEmailRecipient(email: string): string {
  return email.trim().toLowerCase();
}

/** HMAC prevents a database reader from recovering recipients by guessing common addresses. */
export function hashReportEmailRecipient(email: string): string {
  return hashReportEmailRecipientWithKey(email, process.env.ENCRYPTION_KEY);
}

/** Exported separately so tests can supply a generated key without changing process environment. */
export function hashReportEmailRecipientWithKey(email: string, configuredKey: string | undefined): string {
  const keyHex = configuredKey?.trim();
  if (!keyHex || !/^[\da-f]{64}$/i.test(keyHex)) {
    throw new Error("ENCRYPTION_KEY must be set to a 32-byte hex key to compare report email recipients");
  }

  const canonical = canonicalizeReportEmailRecipient(email);
  return createHmac("sha256", Buffer.from(keyHex, "hex"))
    .update(`${RECIPIENT_HASH_DOMAIN}\0${canonical}`, "utf8")
    .digest("hex");
}
