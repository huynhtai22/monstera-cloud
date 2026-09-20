/**
 * Opaque keyset-continuation cursors for Warehouse export pagination.
 *
 * A cursor carries only bounded, non-secret continuation state:
 * version, ordering version, last-row (date, id), a query fingerprint, and
 * a membership snapshot timestamp. Integrity is bound with HMAC-SHA256 over
 * the existing ENCRYPTION_KEY (no new production secret is introduced; the
 * key is never embedded in the token).
 *
 * Layered trust, documented explicitly:
 * - HMAC is tamper-EVIDENCE, not authorization. A forged cursor fails
 *   closed with 400 and creates no side effects.
 * - The fingerprint binds a cursor to its exact filter set; reuse with
 *   different filters fails closed with a structured 400.
 * - Authorization never comes from the cursor: workspace identity always
 *   derives from the authenticated server context, and tenant/client
 *   predicates are re-applied independently on every page.
 */
import crypto from "node:crypto";
import { getCanonicalDateRange } from "./warehouse-date-range";

export const EXPORT_CURSOR_VERSION = 1;
export const EXPORT_CURSOR_ORDERING = "date-asc-id-asc";
export const EXPORT_ORDERS_CURSOR_ORDERING = "createdAt-asc-id-asc";
const SUPPORTED_ORDERINGS = new Set([EXPORT_CURSOR_ORDERING, EXPORT_ORDERS_CURSOR_ORDERING]);
const EXPORT_FINGERPRINT_DOMAIN_KEY = "monstera/export-query-fingerprint/v1";
/** Raw (pre-encoding) cursor budget; encoded form stays well under header limits. */
export const EXPORT_CURSOR_MAX_LENGTH = 1024;

export class ExportCursorError extends Error {
  readonly code:
    | "MALFORMED_CURSOR"
    | "UNKNOWN_CURSOR_VERSION"
    | "INVALID_CURSOR_FIELD"
    | "CURSOR_TOO_LONG"
    | "FILTER_MISMATCH";
  constructor(
    code: ExportCursorError["code"],
    message: string,
  ) {
    super(message);
    this.name = "ExportCursorError";
    this.code = code;
  }
}

export interface ExportCursorPayload {
  readonly v: number;
  readonly ord: string;
  /** Inclusive YYYY-MM-DD of the last row of the previous page. */
  readonly lastDate: string;
  /** Stable row identity of the last row of the previous page. */
  readonly lastId: string;
  /** Full timestamp of the last row, for timestamp-grained orderings (orders). */
  readonly lastTs?: string;
  /** Hex query fingerprint the cursor was issued for. */
  readonly fp: string;
  /** Membership snapshot: rows created after this ISO instant are excluded. */
  readonly snap: string;
}

function hmacKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || !/^[0-9a-f]{64}$/i.test(raw)) {
    throw new ExportCursorError(
      "INVALID_CURSOR_FIELD",
      "Export pagination is unavailable: server signing key is not configured.",
    );
  }
  return Buffer.from(raw, "hex");
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input as any)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(input: string): Buffer {
  if (!/^[A-Za-z0-9\-_]*$/.test(input)) {
    throw new ExportCursorError("MALFORMED_CURSOR", "Cursor contains invalid characters.");
  }
  // Pad to a multiple of 4 for decoding.
  const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
  try {
    return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } catch {
    throw new ExportCursorError("MALFORMED_CURSOR", "Cursor is not valid base64url.");
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Strict calendar-date check via the canonical Warehouse helper. */
function assertCalendarDate(value: string): void {
  if (!DATE_RE.test(value)) {
    throw new ExportCursorError("INVALID_CURSOR_FIELD", "Cursor date must be YYYY-MM-DD.");
  }
  try {
    getCanonicalDateRange(value, value);
  } catch {
    throw new ExportCursorError("INVALID_CURSOR_FIELD", "Cursor date must be YYYY-MM-DD.");
  }
}

/**
 * Canonical query fingerprint over all result-shaping fields. Arrays are
 * sorted before hashing; account IDs are normalized with Meta-aware rules
 * (Meta `act_` variants stay Meta-qualified; other providers never inherit
 * them). Omitting a filter vs explicitly passing "all" canonicalizes
 * identically when both mean "no constraint" — documented per call site.
 * Never includes credentials, tokens, names, or raw payloads.
 *
 * Includes every result-affecting property: workspace, API-key identity
 * (stable id, never secret), resolved client/connection/account scope,
 * provider/platform, record kind, strict date range, format, response mode,
 * ordering version, and any selected columns. Array inputs are canonicalized
 * and sorted before hashing.
 */
export function fingerprintExportQuery(fields: {
  workspaceId: string;
  apiKeyId: string;
  since: string | null;
  until: string | null;
  providers: readonly string[];
  connectionIds: readonly string[];
  accountIds: readonly string[];
  levels: readonly string[];
  ordering: string;
  snapshotAt: string;
  clientScope: string;
  recordKind: string;
  format: string;
  responseMode: string;
}): string {
  const sortStrings = (values: readonly string[]) =>
    [...values].sort();
  const canonical = {
    workspaceId: fields.workspaceId,
    apiKeyId: fields.apiKeyId,
    since: fields.since,
    until: fields.until,
    providers: sortStrings(fields.providers),
    connectionIds: sortStrings(fields.connectionIds),
    accountIds: sortStrings(fields.accountIds),
    levels: sortStrings(fields.levels),
    ordering: fields.ordering,
    snapshotAt: fields.snapshotAt,
    clientScope: fields.clientScope,
    recordKind: fields.recordKind,
    format: fields.format,
    responseMode: fields.responseMode,
  };
  return crypto
    // This is canonicalization, not authentication. The complete cursor is
    // independently signed below with ENCRYPTION_KEY.
    .createHmac("sha256", EXPORT_FINGERPRINT_DOMAIN_KEY)
    .update(JSON.stringify(canonical)) // lgtm[js/insufficient-password-hash]
    .digest("hex");
}

/** Encodes a signed opaque cursor for the given payload. */
export function encodeExportCursor(payload: Omit<ExportCursorPayload, "v" | "ord"> & { v?: number; ord?: string }): string {
  const body = {
    v: payload.v ?? EXPORT_CURSOR_VERSION,
    ord: payload.ord ?? EXPORT_CURSOR_ORDERING,
    lastDate: payload.lastDate,
    lastId: payload.lastId,
    ...(payload.lastTs !== undefined ? { lastTs: payload.lastTs } : {}),
    fp: payload.fp,
    snap: payload.snap,
  };
  if (body.v !== EXPORT_CURSOR_VERSION) {
    throw new ExportCursorError("UNKNOWN_CURSOR_VERSION", "Cursor version is not supported.");
  }
  if (!SUPPORTED_ORDERINGS.has(body.ord)) {
    throw new ExportCursorError("MALFORMED_CURSOR", "Cursor ordering does not match this endpoint.");
  }
  assertCalendarDate(body.lastDate);
  if (typeof body.lastId !== "string" || body.lastId.length === 0 || body.lastId.length > 128) {
    throw new ExportCursorError("INVALID_CURSOR_FIELD", "Cursor row identity is invalid.");
  }
  if ("lastTs" in body && (typeof (body as Record<string, unknown>).lastTs !== "string" || Number.isNaN(Date.parse((body as Record<string, unknown>).lastTs as string)))) {
    throw new ExportCursorError("INVALID_CURSOR_FIELD", "Cursor timestamp is invalid.");
  }
  if (!/^[0-9a-f]{64}$/.test(body.fp)) {
    throw new ExportCursorError("INVALID_CURSOR_FIELD", "Cursor fingerprint is invalid.");
  }
  if (Number.isNaN(Date.parse(body.snap))) {
    throw new ExportCursorError("INVALID_CURSOR_FIELD", "Cursor snapshot timestamp is invalid.");
  }
  const encodedBody = base64UrlEncode(JSON.stringify(body));
  const sig = base64UrlEncode(crypto.createHmac("sha256", hmacKey()).update(encodedBody).digest());
  const token = `${encodedBody}.${sig}`;
  if (token.length > EXPORT_CURSOR_MAX_LENGTH) {
    // Defensive: bounded payloads must never approach header budgets.
    throw new ExportCursorError("CURSOR_TOO_LONG", "Cursor exceeds the maximum length.");
  }
  return token;
}

/** Decodes and verifies a cursor, returning its payload or throwing 400-mapped errors. */
export function decodeExportCursor(token: unknown): ExportCursorPayload {
  if (typeof token !== "string" || token.length === 0) {
    throw new ExportCursorError("MALFORMED_CURSOR", "Cursor must be a non-empty string.");
  }
  if (token.length > EXPORT_CURSOR_MAX_LENGTH) {
    throw new ExportCursorError("CURSOR_TOO_LONG", "Cursor exceeds the maximum length.");
  }
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) {
    throw new ExportCursorError("MALFORMED_CURSOR", "Cursor must have body and signature parts.");
  }
  const encodedBody = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  const expectedSig = base64UrlEncode(crypto.createHmac("sha256", hmacKey()).update(encodedBody).digest());
  const providedBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);
  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    throw new ExportCursorError("MALFORMED_CURSOR", "Cursor signature is invalid.");
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(base64UrlDecode(encodedBody).toString("utf8")) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ExportCursorError) throw error;
    throw new ExportCursorError("MALFORMED_CURSOR", "Cursor body is not valid JSON.");
  }
  if (body.v !== EXPORT_CURSOR_VERSION) {
    throw new ExportCursorError("UNKNOWN_CURSOR_VERSION", "Cursor version is not supported.");
  }
  if (typeof body.ord !== "string" || !SUPPORTED_ORDERINGS.has(body.ord)) {
    throw new ExportCursorError("MALFORMED_CURSOR", "Cursor ordering does not match this endpoint.");
  }
  if (typeof body.lastDate !== "string") {
    throw new ExportCursorError("INVALID_CURSOR_FIELD", "Cursor date must be YYYY-MM-DD.");
  }
  assertCalendarDate(body.lastDate);
  if (typeof body.lastId !== "string" || body.lastId.length === 0 || body.lastId.length > 128) {
    throw new ExportCursorError("INVALID_CURSOR_FIELD", "Cursor row identity is invalid.");
  }
  if (body.lastTs !== undefined && (typeof body.lastTs !== "string" || Number.isNaN(Date.parse(body.lastTs)))) {
    throw new ExportCursorError("INVALID_CURSOR_FIELD", "Cursor timestamp is invalid.");
  }
  if (typeof body.fp !== "string" || !/^[0-9a-f]{64}$/.test(body.fp)) {
    throw new ExportCursorError("INVALID_CURSOR_FIELD", "Cursor fingerprint is invalid.");
  }
  if (typeof body.snap !== "string" || Number.isNaN(Date.parse(body.snap))) {
    throw new ExportCursorError("INVALID_CURSOR_FIELD", "Cursor snapshot timestamp is invalid.");
  }
  return body as unknown as ExportCursorPayload;
}
