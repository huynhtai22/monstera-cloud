/**
 * Controlled extended-backfill pilot policy.
 *
 * Single canonical server-side policy for Meta/Google historical backfills
 * beyond the 30-day generic execution ceiling. The checkpointed worker
 * foundation is already deployed; this module adds the qualification layer
 * that must pass before any extended execution is considered.
 *
 * SAFETY CONTRACT (non-negotiable):
 * - Extended execution is disabled by default (`EXTENDED_BACKFILL_STAGE`
 *   unset means `disabled`).
 * - No request JSON, query parameter, cookie, or client-side value can enable
 *   it: stage, allowlist, and quotas are read from server environment only.
 * - Normal workspace owners/admins cannot enable it: every pilot entry point
 *   additionally requires a server-authenticated platform OPERATOR.
 * - Execution additionally requires a trusted workspace allowlist, provider
 *   eligibility, quota headroom, and an accepted capacity preflight.
 * - Customer-facing 24-month execution is NOT enabled by this module. Public
 *   import routes keep their own raw-range guards and never consult it.
 */

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { getCanonicalDateRange } from "./warehouse-date-range";

export type ExtendedBackfillStage =
  | "disabled"
  | "plan_only"
  | "synthetic"
  | "staging"
  | "production_pilot";

const STAGES: readonly ExtendedBackfillStage[] = [
  "disabled",
  "plan_only",
  "synthetic",
  "staging",
  "production_pilot",
];

/** Entry points the decision function distinguishes. Customer entry never passes. */
export type PilotEntryPoint = "operator" | "customer";
/** What the caller intends to do with the decision. */
export type PilotOperation = "plan" | "create" | "execute";
/** Executor kind bound to a pilot job at execution time. */
export type PilotExecutorKind = "synthetic" | "live";

export interface ProviderPilotEligibility {
  readonly provider: string;
  /** Maximum plannable extended window in inclusive days. */
  readonly pilotMaxDays: number;
  /** Synthetic (dependency-injected, no provider contact) qualification. */
  readonly syntheticEligible: boolean;
  /** Gated live execution in staging. */
  readonly stagingEligible: boolean;
  /** Gated live execution in production pilot. */
  readonly liveEligible: boolean;
  readonly evidenceNote: string;
}

/**
 * Canonical provider eligibility. Meta and Google are independent: Google's
 * verified 37-month daily-grain retention does not transfer to Meta, whose
 * only verified official limit is the 37-month Insights start-date ceiling
 * (error 3018) with documented throttling caveats — sufficient for synthetic
 * planning, insufficient for live extended execution. See
 * docs/EXTENDED_BACKFILL_PILOT.md for retrieval dates, URLs, and confidence.
 * Every other connector is absent here and fails closed for extended work;
 * their existing bounded paths are untouched.
 */
const PROVIDER_PILOT_ELIGIBILITY: readonly ProviderPilotEligibility[] = [
  {
    provider: "google_ads",
    pilotMaxDays: 731,
    syntheticEligible: true,
    stagingEligible: true,
    liveEligible: true,
    evidenceNote:
      "Official 37-month daily-grain retention (zero-metrics docs + retention policy); 731d within ceiling. Reach/frequency metrics shorter (3y) but still above 731d.",
  },
  {
    provider: "meta_ads",
    pilotMaxDays: 731,
    syntheticEligible: true,
    stagingEligible: false,
    liveEligible: false,
    evidenceNote:
      "Official 37-month Insights start-date ceiling (error 3018) with throttling/timeout caveats on large ranges; no verified end-to-end daily-history guarantee. Synthetic planning only.",
  },
];

export function getProviderPilotEligibility(provider: string): ProviderPilotEligibility | undefined {
  return PROVIDER_PILOT_ELIGIBILITY.find((entry) => entry.provider === provider);
}

/**
 * Normalizes a caller-supplied provider key. Trimmed and lowercased so case
 * or padding differences cannot bypass policy; anything unknown (including
 * aliases such as `tiktok_ads`, `meta`, or `google`) fails closed downstream.
 */
export function normalizePilotProvider(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  if (!value || /\s/.test(value)) return null;
  return value;
}

/**
 * Normalizes a caller-supplied account ID. Must already be a string: numeric
 * IDs are rejected rather than coerced, mirroring the chunk contract.
 */
export function normalizePilotAccountId(input: unknown): string | null {
  if (input === undefined || input === null || input === "") return "";
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value || /\s/.test(value)) return null;
  return value;
}

export type ExtendedBackfillReasonCode =
  | "OK"
  | "CUSTOMER_ROUTE"
  | "DISABLED"
  | "UNKNOWN_STAGE"
  | "OPERATOR_REQUIRED"
  | "PROVIDER_INELIGIBLE"
  | "PROVIDER_NOT_LIVE_ELIGIBLE"
  | "INVALID_DATE_RANGE"
  | "RANGE_EXCEEDS_PILOT_MAXIMUM"
  | "STAGE_ALLOWS_PLAN_ONLY"
  | "WORKSPACE_NOT_ALLOWLISTED"
  | "WORKSPACE_NOT_FOUND"
  | "CONNECTION_NOT_FOUND"
  | "OVERLAPPING_JOB"
  | "WORKSPACE_QUOTA_EXCEEDED"
  | "CHUNK_LIMIT_EXCEEDED"
  | "PROVIDER_BUDGET_EXCEEDED"
  | "WORKSPACE_CONCURRENCY_EXCEEDED"
  | "ACCOUNT_CONCURRENCY_EXCEEDED"
  | "CAPACITY_UNKNOWN"
  | "CAPACITY_REJECTED";

export interface ExtendedBackfillDecision {
  readonly allowed: boolean;
  readonly reasonCode: ExtendedBackfillReasonCode;
  readonly provider: string;
  readonly stage: ExtendedBackfillStage;
  readonly requestedDays: number;
  readonly maximumDays: number;
  readonly workspaceAllowed: boolean;
  readonly operatorAuthorized: boolean;
  readonly capacityAccepted: boolean;
}

export interface ExtendedBackfillPilotConfig {
  readonly stage: ExtendedBackfillStage;
  readonly allowedWorkspaceIds: readonly string[];
  readonly maxActiveJobsPerWorkspace: number;
  readonly maxChunksPerJob: number;
  readonly maxProviderCallsPerDay: number;
  readonly maxConcurrentChunksPerWorkspace: number;
  readonly maxConcurrentChunksPerAccount: number;
}

export class PilotConfigError extends Error {
  constructor(message: string) {
    super(`Invalid extended-backfill pilot configuration: ${message}`);
    this.name = "PilotConfigError";
  }
}

function parsePositiveInt(raw: string | undefined, name: string, fallback: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw new PilotConfigError(`${name} must be a positive integer (got ${JSON.stringify(raw)}).`);
  }
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new PilotConfigError(`${name} must be between 1 and ${max} (got ${JSON.stringify(raw)}).`);
  }
  return value;
}

function parseWorkspaceAllowlist(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") return [];
  return raw.split(",").map((entry, index) => {
    if (entry !== entry.trim() || /\s/.test(entry)) {
      throw new PilotConfigError(
        `Allowlist entry at position ${index + 1} is malformed (whitespace is not permitted).`,
      );
    }
    const id = entry.trim();
    if (!id) {
      throw new PilotConfigError(`Allowlist entry at position ${index + 1} is empty.`);
    }
    return id;
  });
}

/**
 * Loads and validates trusted server-only configuration. Defaults the stage
 * to `disabled`; any malformed value throws before any pilot work happens.
 * Never reads from request input: callers pass `process.env` (or test env).
 */
export function loadExtendedBackfillPilotConfig(env: NodeJS.ProcessEnv = process.env): ExtendedBackfillPilotConfig {
  const stageRaw = env.EXTENDED_BACKFILL_STAGE;
  const stage: ExtendedBackfillStage =
    stageRaw === undefined || stageRaw.trim() === "" ? "disabled" : (stageRaw as ExtendedBackfillStage);
  if (!(STAGES as readonly string[]).includes(stage)) {
    throw new PilotConfigError(
      `EXTENDED_BACKFILL_STAGE must be one of ${STAGES.join(", ")} (got ${JSON.stringify(stageRaw)}).`,
    );
  }
  return {
    stage,
    allowedWorkspaceIds: parseWorkspaceAllowlist(env.EXTENDED_BACKFILL_ALLOWED_WORKSPACE_IDS),
    maxActiveJobsPerWorkspace: parsePositiveInt(
      env.EXTENDED_BACKFILL_MAX_ACTIVE_JOBS_PER_WORKSPACE, "EXTENDED_BACKFILL_MAX_ACTIVE_JOBS_PER_WORKSPACE", 2, 100,
    ),
    maxChunksPerJob: parsePositiveInt(
      env.EXTENDED_BACKFILL_MAX_CHUNKS_PER_JOB, "EXTENDED_BACKFILL_MAX_CHUNKS_PER_JOB", 25, 1000,
    ),
    maxProviderCallsPerDay: parsePositiveInt(
      env.EXTENDED_BACKFILL_MAX_PROVIDER_CALLS_PER_DAY, "EXTENDED_BACKFILL_MAX_PROVIDER_CALLS_PER_DAY", 100, 100000,
    ),
    maxConcurrentChunksPerWorkspace: parsePositiveInt(
      env.EXTENDED_BACKFILL_MAX_CONCURRENT_CHUNKS_PER_WORKSPACE,
      "EXTENDED_BACKFILL_MAX_CONCURRENT_CHUNKS_PER_WORKSPACE", 4, 1000,
    ),
    maxConcurrentChunksPerAccount: parsePositiveInt(
      env.EXTENDED_BACKFILL_MAX_CONCURRENT_CHUNKS_PER_ACCOUNT,
      "EXTENDED_BACKFILL_MAX_CONCURRENT_CHUNKS_PER_ACCOUNT", 2, 1000,
    ),
  };
}

export interface PilotAdmissionFacts {
  readonly workspaceExists: boolean;
  readonly connectionExists: boolean;
  readonly workspaceAllowlisted: boolean;
  readonly activeJobsInWorkspace: number;
  readonly overlappingActiveJobs: number;
  readonly plannedChunks: number;
  readonly providerCallsToday: number;
  readonly runningChunksWorkspace: number;
  readonly runningChunksAccount: number;
  readonly capacity: CapacityDecision;
}

export interface CapacityDecision {
  readonly status: "accept" | "warn" | "reject" | "unknown";
  readonly estimatedRows: number | null;
  readonly estimatedStorageBytes: number | null;
  readonly plannedChunks: number;
  readonly assumptions: string[];
  readonly reasonCodes: string[];
}

export interface CapacityEstimateInputs {
  readonly provider: string;
  readonly requestedDays: number;
  readonly plannedChunks: number;
  /** Measured rows/day for the account when available; null means unknown. */
  readonly observedRowsPerDay: number | null;
  /** Existing rows in the workspace-connection scope (approximation basis only). */
  readonly existingScopeRows: number;
  readonly activeJobs: number;
  readonly activeChunks: number;
  /** Storage cost per row in bytes when measured; null means unknown. */
  readonly bytesPerRow: number | null;
  readonly limits: { maxChunksPerJob: number; maxEstimatedRows: number | null; warnFraction?: number };
}

/**
 * Conservative preflight estimator. Never invents Neon storage, compute,
 * connection, or Vercel limits: unknown inputs produce `unknown` (which fails
 * closed for live execution) with explicit assumptions. Planning surfaces may
 * still display an unknown decision.
 */
export function estimatePilotCapacity(inputs: CapacityEstimateInputs): CapacityDecision {
  const assumptions: string[] = [];
  const reasonCodes: string[] = [];
  if (!Number.isSafeInteger(inputs.requestedDays) || inputs.requestedDays < 1) {
    return { status: "unknown", estimatedRows: null, estimatedStorageBytes: null, plannedChunks: inputs.plannedChunks, assumptions: ["Requested day count is not a positive integer."], reasonCodes: ["INVALID_INPUT"] };
  }
  if (!Number.isSafeInteger(inputs.plannedChunks) || inputs.plannedChunks < 1) {
    return { status: "unknown", estimatedRows: null, estimatedStorageBytes: null, plannedChunks: inputs.plannedChunks, assumptions: ["Planned chunk count is not a positive integer."], reasonCodes: ["INVALID_INPUT"] };
  }
  if (inputs.plannedChunks > inputs.limits.maxChunksPerJob) {
    return { status: "reject", estimatedRows: null, estimatedStorageBytes: null, plannedChunks: inputs.plannedChunks, assumptions: [`Planned chunks (${inputs.plannedChunks}) exceed the configured per-job chunk limit (${inputs.limits.maxChunksPerJob}).`], reasonCodes: ["CHUNK_BUDGET"] };
  }
  if (inputs.observedRowsPerDay === null || !Number.isFinite(inputs.observedRowsPerDay) || inputs.observedRowsPerDay < 0) {
    assumptions.push(
      `No observed rows/day for ${inputs.provider}; existing scope holds ~${inputs.existingScopeRows} rows, which cannot derive a rate without a window.`,
    );
    return { status: "unknown", estimatedRows: null, estimatedStorageBytes: null, plannedChunks: inputs.plannedChunks, assumptions, reasonCodes: ["NO_RATE_BASIS"] };
  }
  const estimatedRows = Math.round(inputs.requestedDays * inputs.observedRowsPerDay);
  assumptions.push(`Estimated rows = ${inputs.requestedDays}d x ${inputs.observedRowsPerDay} rows/day (owner-measured).`);
  let estimatedStorageBytes: number | null = null;
  if (inputs.bytesPerRow === null || !Number.isFinite(inputs.bytesPerRow) || inputs.bytesPerRow <= 0) {
    assumptions.push("Per-row storage cost is unmeasured; storage estimate withheld (owner must calibrate bytes/row).");
  } else {
    estimatedStorageBytes = estimatedRows * inputs.bytesPerRow;
    assumptions.push(`Storage = ${estimatedRows} rows x ${inputs.bytesPerRow} bytes/row (measured local constant, not a production fact).`);
  }
  assumptions.push(`Scope already holds ~${inputs.existingScopeRows} rows with ${inputs.activeJobs} active job(s) / ${inputs.activeChunks} active chunk(s).`);
  if (inputs.limits.maxEstimatedRows !== null && estimatedRows > inputs.limits.maxEstimatedRows) {
    reasonCodes.push("ROW_BUDGET");
    return { status: "reject", estimatedRows, estimatedStorageBytes, plannedChunks: inputs.plannedChunks, assumptions, reasonCodes };
  }
  const warnFraction = inputs.limits.warnFraction ?? 0.7;
  if (inputs.limits.maxEstimatedRows !== null && estimatedRows > inputs.limits.maxEstimatedRows * warnFraction) {
    reasonCodes.push("ROW_BUDGET_WARN");
    return { status: "warn", estimatedRows, estimatedStorageBytes, plannedChunks: inputs.plannedChunks, assumptions, reasonCodes };
  }
  return { status: "accept", estimatedRows, estimatedStorageBytes, plannedChunks: inputs.plannedChunks, assumptions, reasonCodes };
}

export interface DecideExtendedBackfillRequest {
  readonly entryPoint: PilotEntryPoint;
  readonly operation: PilotOperation;
  readonly provider: string;
  readonly since: string;
  readonly until: string;
  readonly operatorAuthorized: boolean;
  readonly executorKind?: PilotExecutorKind;
}

function deny(
  reasonCode: ExtendedBackfillReasonCode,
  fields: Pick<ExtendedBackfillDecision, "provider" | "stage" | "requestedDays" | "maximumDays" | "workspaceAllowed" | "operatorAuthorized">,
): ExtendedBackfillDecision {
  return { allowed: false, reasonCode, capacityAccepted: false, ...fields };
}

/**
 * The single authoritative pilot decision function. Pure (no I/O): every
 * database-derived input arrives via `facts`, so unit tests exercise the
 * exact production policy. Fails closed on every unknown or missing input.
 */
export function decideExtendedBackfill(
  request: DecideExtendedBackfillRequest,
  config: ExtendedBackfillPilotConfig,
  facts: PilotAdmissionFacts,
): ExtendedBackfillDecision {
  const operatorAuthorized = request.operatorAuthorized === true;
  const base = {
    provider: request.provider,
    stage: config.stage,
    requestedDays: 0,
    maximumDays: 0,
    workspaceAllowed: facts.workspaceAllowlisted,
    operatorAuthorized,
  };
  if (request.entryPoint !== "operator") {
    return deny("CUSTOMER_ROUTE", base);
  }
  if (!(STAGES as readonly string[]).includes(config.stage)) {
    return deny("UNKNOWN_STAGE", base);
  }
  if (!operatorAuthorized) {
    return deny("OPERATOR_REQUIRED", base);
  }
  const eligibility = getProviderPilotEligibility(request.provider);
  if (!eligibility) {
    return deny("PROVIDER_INELIGIBLE", base);
  }
  let requestedDays: number;
  try {
    const canonical = getCanonicalDateRange(request.since, request.until);
    requestedDays =
      Math.round((canonical.endUtc.getTime() - canonical.startUtc.getTime()) / 86_400_000) + 1;
  } catch {
    return deny("INVALID_DATE_RANGE", base);
  }
  const withRange = { ...base, requestedDays, maximumDays: eligibility.pilotMaxDays };
  if (requestedDays > eligibility.pilotMaxDays) {
    return deny("RANGE_EXCEEDS_PILOT_MAXIMUM", withRange);
  }
  if (config.stage === "disabled") {
    return deny("DISABLED", withRange);
  }
  if (request.operation === "plan") {
    return { ...withRange, allowed: true, reasonCode: "OK", capacityAccepted: facts.capacity.status === "accept" || facts.capacity.status === "warn" };
  }
  if (config.stage === "plan_only") {
    return deny("STAGE_ALLOWS_PLAN_ONLY", withRange);
  }
  // Creation binds a job to a stage: synthetic jobs may only exist for
  // synthetic qualification, staging jobs only where staging execution is
  // eligible, and production jobs only where live execution is eligible.
  if (request.operation === "create") {
    if (config.stage === "synthetic" && !eligibility.syntheticEligible) {
      return deny("PROVIDER_NOT_LIVE_ELIGIBLE", withRange);
    }
    if (config.stage === "staging" && !eligibility.stagingEligible) {
      return deny("PROVIDER_NOT_LIVE_ELIGIBLE", withRange);
    }
    if (config.stage === "production_pilot" && !eligibility.liveEligible) {
      return deny("PROVIDER_NOT_LIVE_ELIGIBLE", withRange);
    }
  }
  const liveExecution =
    request.executorKind !== undefined
      ? request.executorKind === "live"
      : config.stage === "staging" || config.stage === "production_pilot";
  if (liveExecution) {
    if (config.stage !== "staging" && config.stage !== "production_pilot") {
      return deny("STAGE_ALLOWS_PLAN_ONLY", withRange);
    }
    if (!eligibility.liveEligible || (config.stage === "staging" && !eligibility.stagingEligible)) {
      return deny("PROVIDER_NOT_LIVE_ELIGIBLE", withRange);
    }
  }
  if (!facts.workspaceExists) {
    return deny("WORKSPACE_NOT_FOUND", withRange);
  }
  if (!facts.connectionExists) {
    return deny("CONNECTION_NOT_FOUND", withRange);
  }
  if (!facts.workspaceAllowlisted) {
    return deny("WORKSPACE_NOT_ALLOWLISTED", withRange);
  }
  if (facts.overlappingActiveJobs > 0) {
    return deny("OVERLAPPING_JOB", withRange);
  }
  if (facts.activeJobsInWorkspace >= config.maxActiveJobsPerWorkspace) {
    return deny("WORKSPACE_QUOTA_EXCEEDED", withRange);
  }
  if (facts.plannedChunks > config.maxChunksPerJob) {
    return deny("CHUNK_LIMIT_EXCEEDED", withRange);
  }
  if (facts.providerCallsToday + facts.plannedChunks > config.maxProviderCallsPerDay) {
    return deny("PROVIDER_BUDGET_EXCEEDED", withRange);
  }
  if (facts.runningChunksWorkspace >= config.maxConcurrentChunksPerWorkspace) {
    return deny("WORKSPACE_CONCURRENCY_EXCEEDED", withRange);
  }
  if (facts.runningChunksAccount >= config.maxConcurrentChunksPerAccount) {
    return deny("ACCOUNT_CONCURRENCY_EXCEEDED", withRange);
  }
  if (facts.capacity.status === "reject") {
    return deny("CAPACITY_REJECTED", withRange);
  }
  if (facts.capacity.status === "unknown") {
    return deny("CAPACITY_UNKNOWN", withRange);
  }
  return {
    ...withRange,
    allowed: true,
    reasonCode: "OK",
    capacityAccepted: facts.capacity.status === "accept" || facts.capacity.status === "warn",
  };
}

/**
 * Planning assumption for row-budget checks when the owner has not calibrated
 * per-call row volumes. NOT a measured production fact: capacity estimates
 * that rely on it are labeled in assumptions and must be replaced with
 * owner-measured values (see docs/EXTENDED_BACKFILL_PILOT.md).
 */
export const PILOT_ROWS_PER_CALL_PLANNING_ASSUMPTION = 10_000;

/** Pilot job marker: every extended pilot job carries this idempotency prefix. */
export const PILOT_JOB_KEY_PREFIX = "xbpilot:";

export function isPilotJobKey(idempotencyKey: string | null | undefined): boolean {
  return typeof idempotencyKey === "string" && idempotencyKey.startsWith(PILOT_JOB_KEY_PREFIX);
}

export function pilotJobStageFromKey(idempotencyKey: string | null | undefined): ExtendedBackfillStage | null {
  if (!isPilotJobKey(idempotencyKey)) return null;
  const stage = idempotencyKey!.slice(PILOT_JOB_KEY_PREFIX.length).split(":")[0] as ExtendedBackfillStage;
  return (STAGES as readonly string[]).includes(stage) ? stage : null;
}

export function createPilotJobKey(opts: {
  workspaceId: string;
  provider: string;
  connectionId: string;
  accountId: string;
  since: string;
  until: string;
  stage: ExtendedBackfillStage;
  clientKey?: string;
}): string {
  const digest = createHash("sha256")
    .update(
      [opts.workspaceId, opts.provider, opts.connectionId, opts.accountId, opts.since, opts.until]
        .join(""),
    )
    .digest("hex")
    .slice(0, 12);
  const client = opts.clientKey ? `:${createHash("sha256").update(opts.clientKey).digest("hex").slice(0, 8)}` : "";
  return `${PILOT_JOB_KEY_PREFIX}${opts.stage}:${digest}${client}`;
}

/** Opaque account reference for telemetry (raw IDs never leave the database). */
export function opaqueAccountId(accountId: string): string {
  if (!accountId) return "connection";
  return `acct_${createHash("sha256").update(accountId).digest("hex").slice(0, 16)}`;
}

export interface PilotTelemetrySummary {
  readonly workspaceId: string;
  readonly jobId: string;
  readonly provider: string;
  readonly opaqueAccount: string;
  readonly requestedRange: { since: string; until: string };
  readonly effectiveRange: { since: string; until: string } | null;
  readonly plannedChunks: number;
  readonly claimedChunks: number;
  readonly completedChunks: number;
  readonly failedChunks: number;
  readonly partialChunks: number;
  readonly cancelledChunks: number;
  readonly rowsWritten: number;
  readonly durationMs: number | null;
  readonly retryCount: number;
  readonly providerCalls: number;
  readonly rateLimitedResponses: number;
  readonly capacityEstimateVsActual: { estimated: number | null; actual: number } | null;
  readonly terminalStatus: string | null;
  readonly reasonCode: string;
}

/**
 * Bounded, sanitized pilot telemetry. Fixed keys only: no tokens, headers,
 * cookies, payloads, request bodies, or unbounded error objects.
 */
export function summarizePilotTelemetry(opts: {
  workspaceId: string;
  jobId: string;
  provider: string;
  accountId: string;
  requestedRange: { since: string; until: string };
  effectiveRange: { since: string; until: string } | null;
  plannedChunks: number;
  claimedChunks: number;
  completedChunks: number;
  failedChunks: number;
  partialChunks: number;
  cancelledChunks: number;
  rowsWritten: number;
  durationMs: number | null;
  retryCount: number;
  providerCalls: number;
  rateLimitedResponses: number;
  estimatedRows: number | null;
  terminalStatus: string | null;
  reasonCode: string;
}): PilotTelemetrySummary {
  return {
    workspaceId: opts.workspaceId,
    jobId: opts.jobId,
    provider: opts.provider,
    opaqueAccount: opaqueAccountId(opts.accountId),
    requestedRange: { ...opts.requestedRange },
    effectiveRange: opts.effectiveRange ? { ...opts.effectiveRange } : null,
    plannedChunks: opts.plannedChunks,
    claimedChunks: opts.claimedChunks,
    completedChunks: opts.completedChunks,
    failedChunks: opts.failedChunks,
    partialChunks: opts.partialChunks,
    cancelledChunks: opts.cancelledChunks,
    rowsWritten: opts.rowsWritten,
    durationMs: opts.durationMs,
    retryCount: opts.retryCount,
    providerCalls: opts.providerCalls,
    rateLimitedResponses: opts.rateLimitedResponses,
    capacityEstimateVsActual:
      opts.estimatedRows === null
        ? null
        : { estimated: opts.estimatedRows, actual: opts.rowsWritten },
    terminalStatus: opts.terminalStatus,
    reasonCode: opts.reasonCode,
  };
}

/**
 * Server-authenticated platform OPERATOR gate for pilot routes. Follows the
 * internal/pilot convention: 401 when anonymous, 403 otherwise. Never admits
 * workspace owner/admin/member roles on their own.
 */
export async function requirePilotOperator(): Promise<
  { userId: string; error: null } | { userId: null; error: Response }
> {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return { userId: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const operator = await prisma.user.findFirst({
    where: { id: session.user.id, platformRole: "OPERATOR" },
    select: { id: true },
  });
  if (!operator) {
    return { userId: null, error: NextResponse.json({ error: "Operator access required" }, { status: 403 }) };
  }
  return { userId: session.user.id, error: null };
}

export class PilotAdmissionError extends Error {
  constructor(
    readonly reasonCode: ExtendedBackfillReasonCode,
    readonly decision: ExtendedBackfillDecision,
  ) {
    super(`Extended pilot admission refused: ${reasonCode}`);
    this.name = "PilotAdmissionError";
  }
}

/**
 * Sanitized audit writer: metadata is constructed from explicit scalar
 * parameters only. The allowlist, configuration values, credentials, tokens,
 * connection metadata, and environment values can never pass through.
 */
export async function auditPilotEvent(
  client: { auditEvent: { create: (args: any) => Promise<unknown> } },
  opts: {
    workspaceId: string;
    actorUserId: string;
    action: string;
    jobId: string;
    provider: string;
    stage: string;
    reasonCode: string;
    requestedDays?: number;
    plannedChunks?: number;
  },
): Promise<void> {
  await client.auditEvent.create({
    data: {
      workspaceId: opts.workspaceId,
      actorUserId: opts.actorUserId,
      action: opts.action,
      resource: "WarehouseImportJob",
      resourceId: opts.jobId,
      metadata: {
        provider: opts.provider,
        stage: opts.stage,
        reasonCode: opts.reasonCode,
        ...(typeof opts.requestedDays === "number" ? { requestedDays: opts.requestedDays } : {}),
        ...(typeof opts.plannedChunks === "number" ? { plannedChunks: opts.plannedChunks } : {}),
      },
    },
  });
}
