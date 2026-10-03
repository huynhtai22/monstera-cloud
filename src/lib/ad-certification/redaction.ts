/**
 * Stable, auditable redaction utilities for certification evidence.
 *
 * Enforces:
 * - Zero leakage of secrets, tokens, keys, authorization headers.
 * - Stable masking of account and customer identifiers for reviewer correlation.
 * - Deep recursive object sanitization.
 */

import { createHash } from "node:crypto";

const ALLOWED_METADATA_KEYS = new Set([
  "providerAccessFacts",
  "accessLevelStatus",
  "authorizationModel",
  "tokenLifecycleModel",
  "authenticatedLiveRetrieval",
  "grantedScopesOrPermissions",
]);

const SENSITIVE_KEY_REGEX =
  /(?:client[-_]?secret|app[-_]?secret|password|bearer|token|api[-_]?key|private[-_]?key|cookie|credentials?|auth(?:orization)?)/i;

/**
 * Stably masks an account ID (preserves prefix and last 4 characters for reviewer correlation).
 * e.g., "act_123456789" -> "act_***6789", "123-456-7890" -> "cust_***7890"
 */
export function maskAccountId(id: string | null | undefined): string {
  if (!id) return "[UNSPECIFIED_ACCOUNT]";
  const clean = id.trim();
  if (clean.length <= 4) return `***${clean}`;
  
  if (clean.startsWith("act_")) {
    const numericPart = clean.slice(4);
    const suffix = numericPart.slice(-4);
    return `act_***${suffix}`;
  }

  const alphanumeric = clean.replace(/[^a-zA-Z0-9]/g, "");
  const suffix = alphanumeric.slice(-4);
  return `id_***${suffix}`;
}

/**
 * Stably masks an email address: "user.name@example.com" -> "u***e@example.com"
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "[NO_EMAIL]";
  const parts = email.split("@");
  if (parts.length !== 2) return "[REDACTED_EMAIL]";
  const name = parts[0];
  const domain = parts[1];
  if (name.length <= 2) return `*@${domain}`;
  return `${name[0]}***${name[name.length - 1]}@${domain}`;
}

/**
 * Creates a deterministic short hash of an identifier for reviewer correlation without revealing the plain text.
 */
export function hashIdentifier(id: string, salt = "monstera_audit_salt"): string {
  if (!id) return "none";
  return createHash("sha256").update(`${salt}:${id}`).digest("hex").slice(0, 12);
}

/**
 * Deep recursive object sanitization to prevent accidental secret or credential persistence.
 */
export function sanitizeEvidence<T>(val: T): T {
  if (val === null || val === undefined) return val;
  if (typeof val === "string") {
    // Check if looks like bearer token or private key
    if (val.startsWith("Bearer ") || val.includes("BEGIN PRIVATE KEY") || (val.length > 200 && !val.includes(" "))) {
      return "[REDACTED]" as unknown as T;
    }
    return val;
  }
  if (typeof val !== "object") return val;

  if (Array.isArray(val)) {
    return val.map((item) => sanitizeEvidence(item)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (!ALLOWED_METADATA_KEYS.has(k) && SENSITIVE_KEY_REGEX.test(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = sanitizeEvidence(v);
    }
  }
  return out as T;
}
