import crypto from "node:crypto";

/**
 * SePay webhook signature verification.
 *
 * SePay is configured (Bank Integration → Webhook) with a shared secret; the
 * signature is HMAC-SHA256 over the RAW request body. This fails closed: no
 * configured secret or an unverifiable signature rejects the event before any
 * fulfillment logic runs.
 */
const SIGNATURE_HEADERS = ["sepay-signature", "x-sepay-signature", "signature"];

function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex.trim(), "utf8");
  const b = Buffer.from(bHex.trim(), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function extractSepaySignature(req: Request): string | null {
  for (const header of SIGNATURE_HEADERS) {
    const value = req.headers.get(header);
    if (value) {
      // Tolerate "sha256=" / "SHA256 " prefixes.
      return value.replace(/^sha256[=\s]/i, "").trim();
    }
  }
  // SePay also supports the signature as a query parameter.
  const fromQuery = new URL(req.url).searchParams.get("signature");
  return fromQuery ? fromQuery.replace(/^sha256[=\s]/i, "").trim() : null;
}

export function verifySepaySignature(rawBody: string, signature: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16) return false; // fail closed on unset/weak secret
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return timingSafeEqualHex(expected, signature);
}
