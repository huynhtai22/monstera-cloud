/**
 * Connector Runtime v1 — Google Ads shadow-mode integration.
 *
 * Shadow mode observes the existing production extraction path without
 * changing it: one provider request fans out to legacy processing (as
 * today) and to bounded raw capture. Replay re-normalizes persisted
 * artifacts with zero provider calls and compares deterministically
 * against the legacy output. Legacy always remains authoritative.
 */
import { METRIC_CONTRACTS } from "../ad-certification/metric-contracts";
import { normalizeGoogleAdsRow } from "../google-ads";
import type { ConnectionLease } from "../connection-sync-lease";
import {
  LEASE_DURATION_MS,
  assertConnectionSyncLease,
  buildConnectionScope,
} from "../connection-sync-lease";
import { createHash } from "node:crypto";
import prisma from "@/lib/prisma";
import { withSystemScope } from "@/lib/tenant-guard";
import { assertArtifactBounds, buildArtifact, stableStringify, verifyArtifactIntegrity } from "./foundation";
import { MAX_ARTIFACTS_PER_RUN } from "./types";

export const GOOGLE_CONNECTOR_RUNTIME_MODES = ["legacy", "shadow", "runtime"] as const;
export type GoogleConnectorRuntimeMode = (typeof GOOGLE_CONNECTOR_RUNTIME_MODES)[number];

/**
 * Single canonical parser/validator for GOOGLE_CONNECTOR_RUNTIME_MODE.
 * Only a genuinely absent setting resolves to legacy. Every other value
 * must be an exact lowercase match: empty strings, whitespace, typos and
 * case variants (e.g. SHADOW) throw rather than silently enabling —
 * or silently disabling — anything. Values are never echoed: error text
 * is fixed so environment contents cannot leak through logs or responses.
 */
export function resolveGoogleRuntimeMode(
  raw: string | undefined = process.env.GOOGLE_CONNECTOR_RUNTIME_MODE,
): GoogleConnectorRuntimeMode {
  if (raw === undefined) return "legacy";
  if (raw === "legacy") return "legacy";
  if (raw === "shadow") return "shadow";
  // "runtime" is a modeled but unpromotable state: resolvers report it
  // truthfully while every behavior gate rejects it (see below).
  if (raw === "runtime") return "runtime";
  throw new InvalidGoogleConnectorRuntimeModeError();
}

export function isGoogleShadowEnabled(
  raw: string | undefined = process.env.GOOGLE_CONNECTOR_RUNTIME_MODE,
): boolean {
  return resolveGoogleRuntimeMode(raw) === "shadow";
}

/**
 * Typed fail-closed error for malformed mode configuration (empty,
 * whitespace-only, unknown, or wrong-case values). Fixed message text:
 * the raw value is never echoed, so environment contents, credentials
 * and customer identifiers cannot leak through logs or responses.
 */
export class InvalidGoogleConnectorRuntimeModeError extends Error {
  readonly code = "INVALID_GOOGLE_CONNECTOR_RUNTIME_MODE";
  constructor() {
    super(
      "INVALID_GOOGLE_CONNECTOR_RUNTIME_MODE: Google connector runtime mode is not configured correctly. Unset GOOGLE_CONNECTOR_RUNTIME_MODE or set it to legacy or shadow.",
    );
    this.name = "InvalidGoogleConnectorRuntimeModeError";
  }
}

/**
 * Typed fail-closed error for the unpromoted `runtime` authority state.
 * The `code` is stable for operator triage; the message carries no
 * credentials, payloads, or customer identifiers.
 */
export class GoogleRuntimeModeNotPromotedError extends Error {
  readonly code = "GOOGLE_RUNTIME_MODE_NOT_PROMOTED";
  constructor() {
    super(
      "GOOGLE_RUNTIME_MODE_NOT_PROMOTED: Google connector runtime authority is not promoted. Set GOOGLE_CONNECTOR_RUNTIME_MODE to legacy or shadow.",
    );
    this.name = "GoogleRuntimeModeNotPromotedError";
  }
}

/**
 * Reject the unpromoted `runtime` authority state before any provider
 * contact, artifact creation, or legacy mutation. Only a genuinely absent
 * setting plus exact `legacy`/`shadow` values pass; malformed values throw
 * INVALID_GOOGLE_CONNECTOR_RUNTIME_MODE via the canonical parser.
 */
export function assertGoogleRuntimeModeAllowed(
  raw: string | undefined = process.env.GOOGLE_CONNECTOR_RUNTIME_MODE,
): void {
  if (resolveGoogleRuntimeMode(raw) === "runtime") {
    throw new GoogleRuntimeModeNotPromotedError();
  }
}

/** Injectable monotonic clock boundary; tests use a manual clock. */
export interface ShadowClock {
  now(): number;
}

export function monotonicClock(): ShadowClock {
  return { now: () => performance.now() };
}

/**
 * Shadow execution budget derived from the worker lease window: shadow
 * work must never consume more than a tenth of the lease, so the legacy
 * outcome always retains its safe publication window.
 */
export const SHADOW_BUDGET_MS = Math.floor(LEASE_DURATION_MS / 10);
export const SHADOW_BUDGET_EXHAUSTED_CODE = "shadow-budget-exhausted";

/** Cap raw captures per run so one giant account cannot blow the bounds. */
export interface GoogleShadowOptions {
  enabled: boolean;
  runId?: string;
  legacyVersion?: string;
}

export interface GoogleShadowOptions {
  enabled: boolean;
  runId?: string;
  legacyVersion?: string;
}

export const MAX_SHADOW_RAW_CAPTURES = 64;
/** Raw text is chunked for bounded immutable artifacts. */
export const SHADOW_CHUNK_BYTES = 64_000;
/** Bounded evidence lists: counts are exact, samples are capped. */
export const MAX_SHADOW_KEY_SAMPLES = 50;

export interface ShadowRawCapture {
  customerId: string;
  rawText: string;
}

export interface CanonicalGoogleRow {
  key: string;
  date: string;
  campaignId: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  conversionValue: number;
  currency: string;
}

export function canonicalGoogleRowKey(parts: {
  connectionId: string;
  accountId: string;
  campaignId: string;
  date: string;
}): string {
  // String-only identifiers: provider IDs must never pass through Number(),
  // which loses precision above 2^53 and breaks key identity.
  return [parts.connectionId, parts.accountId, parts.campaignId, parts.date]
    .map((part) => String(part ?? ""))
    .join("|");
}

function finiteNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Canonicalize one legacy normalized row. IDs stay strings; metrics are
 * finite numbers. Deterministic: same input always yields the same row.
 *
 * NOTE: the shared normalizer coerces digit strings with Number(), so IDs
 * above 2^53 may already be corrupted in legacy rows. Replay (below) reads
 * IDs from raw JSON instead, where they are still exact strings.
 */
export function canonicalizeGoogleRow(input: {
  connectionId: string;
  accountId: string;
  row: Record<string, unknown>;
}): CanonicalGoogleRow {
  const fields = input.row as Record<string, unknown>;
  const campaignId = String(fields.campaign_id ?? fields.campaignId ?? "unknown");
  const date = String(fields.segments_date ?? fields.date ?? "");
  return {
    key: canonicalGoogleRowKey({
      connectionId: input.connectionId,
      accountId: input.accountId,
      campaignId,
      date,
    }),
    date,
    campaignId,
    campaignName: String(fields.campaign_name ?? fields.campaignName ?? ""),
    impressions: finiteNumber(fields.metrics_impressions ?? fields.impressions),
    clicks: finiteNumber(fields.metrics_clicks ?? fields.clicks),
    spend: finiteNumber(fields.metrics_cost ?? fields.cost ?? fields.spend),
    conversions: finiteNumber(fields.metrics_conversions ?? fields.conversions),
    conversionValue: finiteNumber(
      fields.metrics_conversions_value ??
        fields.metrics_conversion_value ??
        fields.conversion_value ??
        fields.revenue,
    ),
    currency: String(fields.customer_currency_code ?? fields.currency ?? ""),
  };
}

/** Mirror of the extraction parse step: batches array, results concatenated. */
export function parseSearchStreamRawText(rawText: string): Array<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("shadow-replay: raw artifact is not valid JSON");
  }
  const batches: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  const rows: Array<Record<string, unknown>> = [];
  for (const batch of batches) {
    const results = (batch as { results?: unknown }).results;
    if (Array.isArray(results)) rows.push(...(results as Array<Record<string, unknown>>));
  }
  return rows;
}

/**
 * Replay normalization from persisted raw artifacts. Pure: no database, no
 * provider calls. Output is sorted by canonical key, never array position.
 */
/**
 * Canonicalize one RAW provider row for replay: identifiers come straight
 * from the raw JSON (exact strings), metrics from the shared normalizer.
 * This rejects the unsafe numeric coercion the legacy path applies to IDs.
 */
export function canonicalizeRawGoogleRow(input: {
  connectionId: string;
  accountId: string;
  raw: Record<string, unknown>;
}): CanonicalGoogleRow {
  const campaign = (input.raw.campaign ?? {}) as Record<string, unknown>;
  const segments = (input.raw.segments ?? {}) as Record<string, unknown>;
  const normalized = normalizeGoogleAdsRow(input.raw as never) as unknown as Record<string, unknown>;
  const campaignId = String(campaign.id ?? normalized.campaign_id ?? "unknown");
  const date = String(segments.date ?? normalized.segments_date ?? "");
  return {
    key: canonicalGoogleRowKey({
      connectionId: input.connectionId,
      accountId: input.accountId,
      campaignId,
      date,
    }),
    date,
    campaignId,
    campaignName: String(campaign.name ?? normalized.campaign_name ?? ""),
    impressions: finiteNumber(normalized.metrics_impressions),
    clicks: finiteNumber(normalized.metrics_clicks),
    spend: finiteNumber(normalized.metrics_cost),
    conversions: finiteNumber(normalized.metrics_conversions),
    conversionValue: finiteNumber(
      normalized.metrics_conversions_value ?? normalized.metrics_conversion_value,
    ),
    currency: String(
      ((input.raw.customer ?? {}) as Record<string, unknown>).currencyCode ??
        ((input.raw.customer ?? {}) as Record<string, unknown>).currency_code ??
        normalized.customer_currency_code ??
        "",
    ),
  };
}

export function replayGoogleRows(input: {
  connectionId: string;
  accountId: string;
  rawTexts: string[];
}): CanonicalGoogleRow[] {
  const rows: CanonicalGoogleRow[] = [];
  for (const rawText of input.rawTexts) {
    for (const raw of parseSearchStreamRawText(rawText)) {
      rows.push(
        canonicalizeRawGoogleRow({ connectionId: input.connectionId, accountId: input.accountId, raw }),
      );
    }
  }
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return rows;
}

export interface ShadowMetricDifference {
  metric: string;
  legacy: number;
  runtime: number;
  absolute: number;
  percent: number | null;
  tolerance: number;
  within: boolean;
}

/**
 * Bounded per-run telemetry. Fixed numeric fields only — no payloads,
 * tokens, identifiers beyond the run scope, or raw provider errors.
 */
export interface ShadowTelemetry {
  extractionMs: number | null;
  replayMs: number;
  compareMs: number;
  artifactCount: number;
  capturedBytes: number;
  replayedRowCount: number;
  comparedRowCounts: { legacy: number; runtime: number };
  budgetMs: number;
  budgetExceeded: false;
}

export interface ShadowEvidence {
  pass: boolean;
  telemetry: ShadowTelemetry | null;
  comparedRowCounts: { legacy: number; runtime: number };
  missingKeys: string[];
  missingKeysTruncated: boolean;
  missingKeyCount: number;
  extraKeys: string[];
  extraKeysTruncated: boolean;
  extraKeyCount: number;
  duplicateKeyCounts: { legacy: number; runtime: number };
  metricDifferences: ShadowMetricDifference[];
  tolerances: Record<string, number>;
  runtimeVersion: string;
  legacyVersion: string;
  runId: string;
  artifactIds: string[];
  sanitizedError: { code: string; retryable: boolean } | null;
}

export const GOOGLE_RUNTIME_VERSION = "1.0.0-shadow";

function sumBy(rows: CanonicalGoogleRow[], pick: (row: CanonicalGoogleRow) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

/**
 * Compare runtime replay rows against legacy output by canonical key.
 * Uses the existing google_ads metric contract tolerances — no invented
 * tolerances: integers exact, currency ±0.01.
 */
export function compareGoogleShadowRun(input: {
  runId: string;
  artifactIds: string[];
  runtimeVersion?: string;
  legacyVersion: string;
  legacyRows: CanonicalGoogleRow[];
  runtimeRows: CanonicalGoogleRow[];
}): ShadowEvidence {
  const contract = METRIC_CONTRACTS.google_ads;
  const tolerances: Record<string, number> = {
    impressions: contract.tolerances.deliveryIntegers,
    clicks: contract.tolerances.deliveryIntegers,
    conversions: contract.tolerances.deliveryIntegers,
    campaignCount: contract.tolerances.deliveryIntegers,
    spend: contract.tolerances.currencyRounding,
    conversionValue: contract.tolerances.currencyRounding,
  };

  const legacyByKey = new Map<string, CanonicalGoogleRow[]>();
  for (const row of input.legacyRows) {
    const bucket = legacyByKey.get(row.key) ?? [];
    bucket.push(row);
    legacyByKey.set(row.key, bucket);
  }
  const runtimeByKey = new Map<string, CanonicalGoogleRow[]>();
  for (const row of input.runtimeRows) {
    const bucket = runtimeByKey.get(row.key) ?? [];
    bucket.push(row);
    runtimeByKey.set(row.key, bucket);
  }

  const missingKeys = [...legacyByKey.keys()].filter((key) => !runtimeByKey.has(key)).sort();
  const extraKeys = [...runtimeByKey.keys()].filter((key) => !legacyByKey.has(key)).sort();
  const countDuplicates = (byKey: Map<string, CanonicalGoogleRow[]>) =>
    [...byKey.values()].reduce((total, bucket) => total + Math.max(0, bucket.length - 1), 0);

  const metricSpecs: Array<{ metric: keyof Pick<CanonicalGoogleRow, "impressions" | "clicks" | "spend" | "conversions" | "conversionValue">; tolerance: number }> = [
    { metric: "impressions", tolerance: tolerances.impressions },
    { metric: "clicks", tolerance: tolerances.clicks },
    { metric: "spend", tolerance: tolerances.spend },
    { metric: "conversions", tolerance: tolerances.conversions },
    { metric: "conversionValue", tolerance: tolerances.conversionValue },
  ];
  const metricDifferences: ShadowMetricDifference[] = metricSpecs.map(({ metric, tolerance }) => {
    const legacy = sumBy(input.legacyRows, (row) => row[metric]);
    const runtime = sumBy(input.runtimeRows, (row) => row[metric]);
    const absolute = Math.abs(legacy - runtime);
    return {
      metric,
      legacy,
      runtime,
      absolute,
      percent: legacy === 0 ? null : (absolute / Math.abs(legacy)) * 100,
      tolerance,
      within: absolute <= tolerance,
    };
  });

  const pass =
    missingKeys.length === 0 &&
    extraKeys.length === 0 &&
    countDuplicates(legacyByKey) === 0 &&
    countDuplicates(runtimeByKey) === 0 &&
    metricDifferences.every((difference) => difference.within);

  return {
    pass,
    comparedRowCounts: { legacy: input.legacyRows.length, runtime: input.runtimeRows.length },
    missingKeys: missingKeys.slice(0, MAX_SHADOW_KEY_SAMPLES),
    missingKeysTruncated: missingKeys.length > MAX_SHADOW_KEY_SAMPLES,
    missingKeyCount: missingKeys.length,
    extraKeys: extraKeys.slice(0, MAX_SHADOW_KEY_SAMPLES),
    extraKeysTruncated: extraKeys.length > MAX_SHADOW_KEY_SAMPLES,
    extraKeyCount: extraKeys.length,
    duplicateKeyCounts: {
      legacy: countDuplicates(legacyByKey),
      runtime: countDuplicates(runtimeByKey),
    },
    metricDifferences,
    tolerances,
    runtimeVersion: GOOGLE_RUNTIME_VERSION,
    legacyVersion: input.legacyVersion,
    runId: input.runId,
    artifactIds: [...input.artifactIds],
    sanitizedError: null,
    telemetry: null,
  };
}

/** Split captured raw texts into bounded immutable chunks. */
export function chunkShadowRawTexts(
  captures: ShadowRawCapture[],
  maxBytes: number = SHADOW_CHUNK_BYTES,
): Array<{ index: number; customerId: string; rawText: string }> {
  const chunks: Array<{ index: number; customerId: string; rawText: string }> = [];
  for (const capture of captures.slice(0, MAX_SHADOW_RAW_CAPTURES)) {
    const text = capture.rawText;
    for (let offset = 0; offset < text.length; offset += maxBytes) {
      chunks.push({
        index: chunks.length,
        customerId: String(capture.customerId),
        rawText: text.slice(offset, offset + maxBytes),
      });
    }
  }
  return chunks;
}

export type AssertLease = (lease: ConnectionLease) => Promise<void>;

/**
 * Bind a lease to one workspace+connection. A lease captured for another
 * scope must fail closed before any read or write.
 */
export function assertLeaseScope(
  lease: ConnectionLease,
  workspaceId: string,
  connectionId: string,
): void {
  const expected = buildConnectionScope({ provider: "google_ads", workspaceId, connectionId });
  if (lease.scope !== expected) {
    throw new Error("shadow-run: lease scope does not match workspace and connection");
  }
}

async function fencedTransaction<T>(
  lease: ConnectionLease,
  assertLease: AssertLease,
  work: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  await assertLease(lease);
  return withSystemScope(() => prisma.$transaction(work));
}

/**
 * Worker-path publication for shadow evidence. The active connection lease
 * is asserted before every write: a stale worker throws with zero writes.
 * No OPERATOR identity is required or accepted here; manual promotion
 * remains on the OPERATOR-gated publishGateAVerdict path.
 */
export async function publishShadowEvidence(input: {
  workspaceId: string;
  connectionId: string;
  runId: string;
  evidence: ShadowEvidence;
  lease: ConnectionLease;
  assertLease?: AssertLease;
}): Promise<{ artifactId: string; pass: boolean }> {
  if (!input.workspaceId || !input.connectionId || !input.runId) {
    throw new Error("Shadow publication requires workspaceId, connectionId and runId.");
  }
  const assertLease = input.assertLease ?? assertConnectionSyncLease;
  const payload = JSON.parse(stableStringify(input.evidence)) as Record<string, unknown>;
  const payloadHash = createHash("sha256")
    .update(stableStringify(input.evidence))
    .digest("hex");
  return fencedTransaction(input.lease, assertLease, async (tx) => {
    const record = await tx.connectorRunArtifact.create({
      data: {
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        runId: input.runId,
        provider: "google_ads",
        kind: "shadow_comparison",
        payloadHash,
        payload,
        retainedUntil: new Date(Date.now() + 30 * 86_400_000),
      },
      select: { id: true },
    });
    await tx.auditEvent.create({
      data: {
        workspaceId: input.workspaceId,
        actorUserId: null,
        action: "connector_runtime.shadow_published",
        resource: "connection",
        resourceId: input.connectionId,
        metadata: {
          runId: input.runId,
          artifactId: record.id,
          pass: input.evidence.pass,
          system: "connector-runtime-worker",
          leaseScope: input.lease.scope,
        },
      },
    });
    return { artifactId: record.id, pass: input.evidence.pass };
  });
}

/**
 * Record a bounded, sanitized shadow failure. Legacy delivery is untouched:
 * this only documents that the runtime side failed for this run.
 */
export async function recordShadowFailure(input: {
  workspaceId: string;
  connectionId: string;
  runId: string;
  stage: string;
  code: string;
  retryable: boolean;
  lease: ConnectionLease;
  assertLease?: AssertLease;
}): Promise<{ artifactId: string }> {
  const assertLease = input.assertLease ?? assertConnectionSyncLease;
  // Scope check first: a lease captured for another workspace must fail
  // closed here too, or failure recording would become a cross-tenant write.
  assertLeaseScope(input.lease, input.workspaceId, input.connectionId);
  // Sanitized taxonomy only: never raw provider payloads or error text.
  const payload = { stage: String(input.stage), code: String(input.code), retryable: input.retryable === true };
  return fencedTransaction(input.lease, assertLease, async (tx) => {
    const record = await tx.connectorRunArtifact.create({
      data: {
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        runId: input.runId,
        provider: "google_ads",
        kind: "shadow_failure",
        payloadHash: createHash("sha256").update(stableStringify(payload)).digest("hex"),
        payload: JSON.parse(stableStringify(payload)),
        retainedUntil: new Date(Date.now() + 30 * 86_400_000),
      },
      select: { id: true },
    });
    await tx.auditEvent.create({
      data: {
        workspaceId: input.workspaceId,
        actorUserId: null,
        action: "connector_runtime.shadow_failed",
        resource: "connection",
        resourceId: input.connectionId,
        metadata: { runId: input.runId, artifactId: record.id, system: "connector-runtime-worker", leaseScope: input.lease.scope, ...payload },
      },
    });
    return { artifactId: record.id };
  });
}

export interface GoogleShadowCapture {
  customerId: string;
  rawTexts: string[];
  normalizedRows: Array<Record<string, unknown>>;
  timezone?: string;
  currency?: string;
}

export interface GoogleShadowRunResult {
  published: boolean;
  pass: boolean;
  artifactIds: string[];
  failureCode: string | null;
  telemetry: (ShadowTelemetry & { publishMs: number; totalShadowMs: number }) | null;
}

function sanitizeShadowError(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof Error) {
    const message = error.message;
    const retryable = /timeout|temporar|rate.?limit|quota|5\d\d|exhausted/i.test(message);
    const code = message.split(":")[0].slice(0, 120) || "shadow-error";
    return { code, retryable };
  }
  return { code: "shadow-error", retryable: false };
}

/**
 * Full shadow run for one Google sync: lease-gated capture persistence,
 * zero-call replay, deterministic comparison, single-transaction publish.
 * Never throws: any failure is recorded as bounded shadow evidence (when
 * the fence still holds) and reported in the result. Legacy delivery is
 * never affected by the outcome.
 */
export async function executeGoogleShadowRun(input: {
  workspaceId: string;
  connectionId: string;
  runId: string;
  legacyVersion: string;
  captures: GoogleShadowCapture[];
  lease: ConnectionLease;
  assertLease?: AssertLease;
  clock?: ShadowClock;
  budgetMs?: number;
  extractionMs?: number | null;
}): Promise<GoogleShadowRunResult> {
  const assertLease = input.assertLease ?? assertConnectionSyncLease;
  const fail = async (stage: string, error: unknown): Promise<GoogleShadowRunResult> => {
    const sanitized = sanitizeShadowError(error);
    try {
      await recordShadowFailure({
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        runId: input.runId,
        stage,
        code: sanitized.code,
        retryable: sanitized.retryable,
        lease: input.lease,
        assertLease,
      });
    } catch {
      // Fence lost or persistence down: log the taxonomy only, never payloads.
    }
    return { published: false, pass: false, artifactIds: [], failureCode: sanitized.code, telemetry: null };
  };

  try {
    if (!input.workspaceId || !input.connectionId || !input.runId) {
      throw new Error("shadow-run: workspace, connection and run are required");
    }
    assertLeaseScope(input.lease, input.workspaceId, input.connectionId);
    await assertLease(input.lease);

    // Stage-gated execution: every stage re-asserts the fence and checks
    // the remaining budget. There is no detached work here — each stage is
    // awaited inline, so when this function returns nothing keeps running.
    const clock = input.clock ?? monotonicClock();
    const budgetMs = input.budgetMs ?? SHADOW_BUDGET_MS;
    const runStartMs = clock.now();
    const checkStage = async (stage: string) => {
      await assertLease(input.lease);
      if (clock.now() - runStartMs > budgetMs) {
        throw new Error(`${SHADOW_BUDGET_EXHAUSTED_CODE}: ${stage}`);
      }
    };
    await checkStage("schedule");

    // Idempotent repeat: a published comparison for this run is a
    // deterministic conflict, not a second publication.
    const existing = await withSystemScope(() =>
      prisma.connectorRunArtifact.findMany({
        where: { workspaceId: input.workspaceId, runId: input.runId, kind: "shadow_comparison" },
        select: { id: true },
      }),
    );
    if (existing.length > 0) {
      return {
        published: false,
        pass: false,
        artifactIds: existing.map((row) => row.id),
        failureCode: "already-published",
        telemetry: null,
      };
    }

    const legacyRows: CanonicalGoogleRow[] = [];
    for (const capture of input.captures) {
      for (const row of capture.normalizedRows) {
        legacyRows.push(
          canonicalizeGoogleRow({
            connectionId: input.connectionId,
            accountId: capture.customerId,
            row,
          }),
        );
      }
    }
    const chunkPayloads = chunkShadowRawTexts(
      input.captures.map((capture) => ({
        customerId: capture.customerId,
        rawText: capture.rawTexts.join(""),
      })),
    );
    if (chunkPayloads.length > MAX_ARTIFACTS_PER_RUN - 1) {
      throw new Error("shadow-run: capture-overflow");
    }

    await checkStage("replay");
    const replayStartMs = clock.now();
    // Replay from the chunk payloads (what is persisted), never from memory.
    // Chunks are reassembled per customer so account identity survives.
    const chunksByCustomer = new Map<string, string[]>();
    for (const chunk of chunkPayloads
      .slice()
      .sort((a, b) => a.index - b.index)) {
      const list = chunksByCustomer.get(chunk.customerId) ?? [];
      list.push(chunk.rawText);
      chunksByCustomer.set(chunk.customerId, list);
    }
    const runtimeRows = [...chunksByCustomer.entries()].flatMap(([accountId, rawTexts]) =>
      replayGoogleRows({ connectionId: input.connectionId, accountId, rawTexts }),
    );
    runtimeRows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const replayMs = clock.now() - replayStartMs;
    await checkStage("compare");
    const compareStartMs = clock.now();
    const evidence = compareGoogleShadowRun({
      runId: input.runId,
      artifactIds: [],
      legacyVersion: input.legacyVersion,
      legacyRows,
      runtimeRows,
    });
    const compareMs = clock.now() - compareStartMs;

    const capturedBytes = chunkPayloads.reduce((total, chunk) => total + chunk.rawText.length, 0);
    const telemetry: ShadowTelemetry = {
      extractionMs: input.extractionMs ?? null,
      replayMs,
      compareMs,
      artifactCount: chunkPayloads.length + 1,
      capturedBytes,
      replayedRowCount: runtimeRows.length,
      comparedRowCounts: { legacy: legacyRows.length, runtime: runtimeRows.length },
      budgetMs,
      budgetExceeded: false,
    };
    const chunkArtifacts = chunkPayloads.map((chunk, position) =>
      buildArtifact({
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        runId: input.runId,
        provider: "google_ads",
        kind: `shadow_raw:${String(position).padStart(4, "0")}`,
        payload: chunk,
      }),
    );
    const evidenceWithIds: typeof evidence = {
      ...evidence,
      telemetry,
      artifactIds: chunkArtifacts.map((artifact) => artifact.id),
    };
    const comparisonArtifact = buildArtifact({
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      runId: input.runId,
      provider: "google_ads",
      kind: "shadow_comparison",
      payload: evidenceWithIds,
    });
    const allArtifacts = [...chunkArtifacts, comparisonArtifact];
    assertArtifactBounds(allArtifacts);
    for (const artifact of allArtifacts) {
      try {
        verifyArtifactIntegrity(artifact);
      } catch {
        throw new Error("shadow-run: artifact checksum mismatch");
      }
    }

    await checkStage("publish");
    const publishStartMs = clock.now();
    const artifactIds = await withSystemScope(() =>
      prisma.$transaction(async (tx) => {
        const ids: string[] = [];
        for (const artifact of allArtifacts) {
          const record = await tx.connectorRunArtifact.create({
            data: {
              workspaceId: artifact.workspaceId,
              connectionId: artifact.connectionId,
              runId: artifact.runId,
              provider: artifact.provider,
              kind: artifact.kind,
              payloadHash: artifact.payloadHash,
              payload: JSON.parse(JSON.stringify(artifact.payload)),
              retainedUntil: new Date(artifact.retainedUntil),
            },
            select: { id: true },
          });
          ids.push(record.id);
        }
        await tx.auditEvent.create({
          data: {
            workspaceId: input.workspaceId,
            actorUserId: null,
            action: "connector_runtime.shadow_published",
            resource: "connection",
            resourceId: input.connectionId,
            metadata: {
              runId: input.runId,
              artifactIds: ids,
              pass: evidenceWithIds.pass,
              system: "connector-runtime-worker",
              leaseScope: input.lease.scope,
              telemetry: evidenceWithIds.telemetry,
            },
          },
        });
        return ids;
      }),
    );
    const publishMs = clock.now() - publishStartMs;
    const totalShadowMs = clock.now() - runStartMs;
    return {
      published: true,
      pass: evidenceWithIds.pass,
      artifactIds,
      failureCode: null,
      telemetry: { ...telemetry, publishMs, totalShadowMs },
    };
  } catch (error) {
    return fail("shadow-run", error);
  }
}
