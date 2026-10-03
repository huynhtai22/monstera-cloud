import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  decodeExportCursor,
  encodeExportCursor,
  fingerprintExportQuery,
  ExportCursorError,
  EXPORT_CURSOR_MAX_LENGTH,
  EXPORT_CURSOR_ORDERING,
  EXPORT_ORDERS_CURSOR_ORDERING,
  EXPORT_CURSOR_VERSION,
} from "./warehouse-export-cursor";

const FIELDS = {
  workspaceId: "ws-a",
  apiKeyId: "key-123",
  since: "2026-01-01" as string | null,
  until: "2026-12-31" as string | null,
  providers: ["meta_ads"],
  connectionIds: ["conn-1"],
  accountIds: ["act_123"],
  levels: [] as string[],
  ordering: EXPORT_CURSOR_ORDERING,
  snapshotAt: "2026-09-17T00:00:00.000Z",
  clientScope: "workspace",
  recordKind: "metrics",
  format: "json",
  responseMode: "array",
};

describe("export cursor codec (production code)", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  it("round-trips a cursor opaquely", () => {
    const fp = fingerprintExportQuery(FIELDS);
    const token = encodeExportCursor({ lastDate: "2026-03-01", lastId: "abc", fp, snap: FIELDS.snapshotAt });
    assert.ok(typeof token === "string" && !token.includes("2026-03-01"), "cursor must be opaque");
    assert.ok(token.length < EXPORT_CURSOR_MAX_LENGTH);
    const payload = decodeExportCursor(token);
    assert.equal(payload.v, EXPORT_CURSOR_VERSION);
    assert.equal(payload.ord, EXPORT_CURSOR_ORDERING);
    assert.equal(payload.lastDate, "2026-03-01");
    assert.equal(payload.lastId, "abc");
    assert.equal(payload.fp, fp);
    assert.equal(payload.snap, FIELDS.snapshotAt);
  });

  it("rejects tampered cursors without side effects", () => {
    const fp = fingerprintExportQuery(FIELDS);
    const token = encodeExportCursor({ lastDate: "2026-03-01", lastId: "abc", fp, snap: FIELDS.snapshotAt });
    const [body] = token.split(".");
    const tamperedBody = body!.slice(0, -2) + (body!.slice(-2) === "AA" ? "BB" : "AA");
    assert.throws(() => decodeExportCursor(`${tamperedBody}.${token.split(".")[1]}`), ExportCursorError);
    assert.throws(() => decodeExportCursor(`${body}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`), ExportCursorError);
  });

  it("rejects malformed, oversized, and unknown-version cursors", () => {
    for (const bad of ["", "no-dot-here", ".sig", "body.", "!!!. sig", "a".repeat(EXPORT_CURSOR_MAX_LENGTH + 1)]) {
      assert.throws(() => decodeExportCursor(bad), ExportCursorError, JSON.stringify(bad));
    }
    const fp = fingerprintExportQuery(FIELDS);
    const token = encodeExportCursor({ lastDate: "2026-03-01", lastId: "abc", fp, snap: FIELDS.snapshotAt });
    void token;
  });

  it("rejects invalid cursor fields at encode time", () => {
    const fp = fingerprintExportQuery(FIELDS);
    assert.throws(() => encodeExportCursor({ lastDate: "2026-13-40", lastId: "a", fp, snap: FIELDS.snapshotAt }), ExportCursorError);
    assert.throws(() => encodeExportCursor({ lastDate: "2026-03-01", lastId: "", fp, snap: FIELDS.snapshotAt }), ExportCursorError);
    assert.throws(() => encodeExportCursor({ lastDate: "2026-03-01", lastId: "a", fp: "nope", snap: FIELDS.snapshotAt }), ExportCursorError);
    assert.throws(() => encodeExportCursor({ lastDate: "2026-03-01", lastId: "a", fp, snap: "not-a-date" }), ExportCursorError);
    assert.throws(
      () => encodeExportCursor({ lastDate: "2026-03-01", lastId: "a", fp, snap: FIELDS.snapshotAt, lastTs: "bogus" }),
      ExportCursorError,
    );
  });

  it("supports full-timestamp cursors for timestamp orderings", () => {
    const fp = fingerprintExportQuery(FIELDS);
    const token = encodeExportCursor({
      lastDate: "2026-03-01", lastId: "abc", lastTs: "2026-03-01T10:20:30.000Z", fp, snap: FIELDS.snapshotAt,
    });
    assert.equal(decodeExportCursor(token).lastTs, "2026-03-01T10:20:30.000Z");
  });

  it("supports the orders ordering while rejecting unknown orderings", () => {
    const fp = fingerprintExportQuery({ ...FIELDS, ordering: EXPORT_ORDERS_CURSOR_ORDERING, recordKind: "orders" });
    const token = encodeExportCursor({
      ord: EXPORT_ORDERS_CURSOR_ORDERING,
      lastDate: "2026-03-01",
      lastId: "abc",
      lastTs: "2026-03-01T10:20:30.000Z",
      fp,
      snap: FIELDS.snapshotAt,
    });
    assert.equal(decodeExportCursor(token).ord, EXPORT_ORDERS_CURSOR_ORDERING);
    assert.throws(
      () => encodeExportCursor({ ord: "unknown", lastDate: "2026-03-01", lastId: "abc", fp, snap: FIELDS.snapshotAt }),
      ExportCursorError,
    );
  });

  it("fails closed without a signing key", () => {
    delete process.env.ENCRYPTION_KEY;
    const fp = fingerprintExportQuery(FIELDS);
    assert.throws(() => encodeExportCursor({ lastDate: "2026-03-01", lastId: "a", fp, snap: FIELDS.snapshotAt }), ExportCursorError);
    assert.throws(() => decodeExportCursor("body.sig"), ExportCursorError);
  });
});

describe("export query fingerprint (production code)", () => {
  it("is deterministic and order-insensitive for arrays", () => {
    const left = fingerprintExportQuery(FIELDS);
    const right = fingerprintExportQuery({
      ...FIELDS,
      providers: [...FIELDS.providers].reverse(),
      connectionIds: [...FIELDS.connectionIds].reverse(),
      accountIds: [...FIELDS.accountIds].reverse(),
    });
    assert.equal(left, right);
    assert.match(left, /^[0-9a-f]{64}$/);
  });

  it("changes when any result-shaping field changes", () => {
    const base = fingerprintExportQuery(FIELDS);
    const variants = [
      { ...FIELDS, since: "2026-01-02" },
      { ...FIELDS, until: "2026-12-30" },
      { ...FIELDS, providers: ["google_ads"] },
      { ...FIELDS, connectionIds: ["conn-2"] },
      { ...FIELDS, accountIds: ["act_124"] },
      { ...FIELDS, ordering: "other" },
      { ...FIELDS, snapshotAt: "2026-09-17T00:00:01.000Z" },
      { ...FIELDS, clientScope: "explicit:client-1" },
      { ...FIELDS, workspaceId: "ws-b" },
      { ...FIELDS, apiKeyId: "key-999" },
      { ...FIELDS, recordKind: "orders" },
      { ...FIELDS, format: "csv" },
      { ...FIELDS, responseMode: "envelope" },
    ];
    for (const variant of variants) {
      assert.notEqual(fingerprintExportQuery(variant), base, JSON.stringify(variant));
    }
  });

  it("keeps Meta act_ variants Meta-qualified in the hash input", () => {
    // Requested values (not effective predicates) are hashed, so Meta
    // act_123 and Google 123 never collide: providers differ.
    const meta = fingerprintExportQuery({ ...FIELDS, providers: ["meta_ads"], accountIds: ["act_123"] });
    const google = fingerprintExportQuery({ ...FIELDS, providers: ["google_ads"], accountIds: ["123"] });
    assert.notEqual(meta, google);
  });

  it("contains no secret material", () => {
    const fp = fingerprintExportQuery({ ...FIELDS, connectionIds: ["conn-secret-xyz"] });
    assert.ok(!fp.includes("conn-secret-xyz"));
  });
});
