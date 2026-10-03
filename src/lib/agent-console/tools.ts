import { z } from "zod";
import { ConsoleAction, type AuthorityContext, assertAuthority } from "./authority";
import {
  evaluateProviderCapability,
  type QualityGateCode,
  type ExecutionMode,
  type MetricSemantics,
} from "./capabilities";

export type SideEffectCategory = "read" | "mutate_warehouse_job" | "draft";

/**
 * Strict calendar date schema that validates real calendar days (e.g. rejects 2026-02-30 or 2026-02-29 in non-leap year).
 */
export const CalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Date must be in YYYY-MM-DD format" }).refine(val => {
  const [yStr, mStr, dStr] = val.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (m < 1 || m > 12) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}, { message: "Invalid calendar date" });

export const VALID_ISO_4217_CURRENCIES = new Set([
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN",
  "BAM", "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BRL",
  "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHF", "CLP", "CNY",
  "COP", "CRC", "CUC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD",
  "EGP", "ERN", "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS", "GIP",
  "GMD", "GNF", "GTQ", "GYD", "HKD", "HNL", "HRK", "HTG", "HUF", "IDR",
  "ILS", "INR", "IQD", "IRR", "ISK", "JMD", "JOD", "JPY", "KES", "KGS",
  "KHR", "KMF", "KPW", "KRW", "KWD", "KYD", "KZT", "LAK", "LBP", "LKR",
  "LRD", "LSL", "LYD", "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP",
  "MRU", "MUR", "MVR", "MWK", "MXN", "MYR", "MZN", "NAD", "NGN", "NIO",
  "NOK", "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN",
  "PYG", "QAR", "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SDG",
  "SEK", "SGD", "SHP", "SLL", "SOS", "SRD", "SSP", "STN", "SVC", "SYP",
  "SZL", "THB", "TJS", "TMT", "TND", "TOP", "TRY", "TTD", "TWD", "TZS",
  "UAH", "UGX", "USD", "UYU", "UZS", "VES", "VND", "VUV", "WST", "XAF",
  "XCD", "XOF", "XPF", "YER", "ZAR", "ZMW", "ZWL",
]);

/**
 * Validates recognized ISO 4217 uppercase currency codes.
 */
export const IsoCurrencySchema = z.string().trim().refine(
  code => /^[A-Z]{3}$/.test(code) && VALID_ISO_4217_CURRENCIES.has(code),
  { message: "Currency must be a recognized 3-letter uppercase ISO 4217 currency code (e.g. USD, EUR, VND, SGD)" },
);

/**
 * Validates IANA timezone identifiers.
 */
export const IanaTimezoneSchema = z.string().trim().min(1).refine(tz => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, { message: "Invalid IANA timezone identifier" });

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  category: SideEffectCategory;
  requiredPermission: ConsoleAction;
  outcomeEvidenceRequired: boolean;
  rollbackOwner: string;
  failureBehavior: string;
  timeoutMs: number;
  maxRetries: number;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
}

// 1. inspect_source
export const InspectSourceInputSchema = z.object({
  workspaceId: z.string().trim().min(1),
  connectionId: z.string().trim().min(1),
  provider: z.string().trim().min(1),
}).strict();

export const InspectSourceOutputSchema = z.object({
  connectionId: z.string(),
  provider: z.string(),
  status: z.enum(["connected", "disconnected", "error", "expired"]),
  tokenExpired: z.boolean(),
  tokenExpiresAt: z.string().nullable().optional(),
  lastSuccessfulSyncAt: z.string().nullable().optional(),
  qualityCodes: z.array(z.string()),
}).strict();

// 2. query_coverage
export const QueryCoverageInputSchema = z.object({
  workspaceId: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  accountIds: z.array(z.string().trim().min(1)).min(1),
  since: CalendarDateSchema,
  until: CalendarDateSchema,
  expectedTimezone: IanaTimezoneSchema.optional(),
}).strict().refine(data => data.since <= data.until, {
  message: "Invalid date range: 'since' must be earlier than or equal to 'until'",
  path: ["since"],
});

export const QueryCoverageOutputSchema = z.object({
  provider: z.string(),
  accountIds: z.array(z.string()),
  since: z.string(),
  until: z.string(),
  expectedDays: z.number().int().nonnegative(),
  actualCoveredDays: z.number().int().nonnegative(),
  missingDays: z.array(z.string()),
  qualityCodes: z.array(z.string()),
  isEligibleForEvaluation: z.boolean(),
}).strict();

// 3. query_metric_window
export const QueryMetricWindowInputSchema = z.object({
  workspaceId: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  accountIds: z.array(z.string().trim().min(1)).min(1),
  since: CalendarDateSchema,
  until: CalendarDateSchema,
  metrics: z.array(z.enum(["spend", "conversions", "cpa", "roas", "revenue"])).min(1),
  expectedCurrency: IsoCurrencySchema,
  expectedTimezone: IanaTimezoneSchema.optional(),
}).strict().refine(data => data.since <= data.until, {
  message: "Invalid date range: 'since' must be earlier than or equal to 'until'",
  path: ["since"],
});

export const QueryMetricWindowOutputSchema = z.object({
  provider: z.string(),
  accountIds: z.array(z.string()),
  window: z.object({
    since: z.string(),
    until: z.string(),
    daysCount: z.number(),
  }),
  currency: z.string(),
  totals: z.object({
    spend: z.number().nonnegative(),
    conversions: z.number().nonnegative(),
    cpa: z.number().nullable(),
    roas: z.number().nullable(),
    revenue: z.number().nullable(),
  }),
  datasetFingerprint: z.string(),
  qualityCodes: z.array(z.string()),
  isEligible: z.boolean(),
}).strict();

// 4. submit_recovery_import
export const SubmitRecoveryImportInputSchema = z.object({
  workspaceId: z.string().trim().min(1),
  responsibilityId: z.string().trim().min(1),
  caseId: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  connectionId: z.string().trim().min(1),
  accountIds: z.array(z.string().trim().min(1)).min(1),
  since: CalendarDateSchema,
  until: CalendarDateSchema,
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict().refine(data => data.since <= data.until, {
  message: "Invalid date range: 'since' must be earlier than or equal to 'until'",
  path: ["since"],
});

export const SubmitRecoveryImportOutputSchema = z.object({
  jobId: z.string(),
  idempotencyKey: z.string(),
  status: z.enum(["queued", "already_active", "rejected"]),
  targetAccounts: z.array(z.string()),
  since: z.string(),
  until: z.string(),
  scheduledAt: z.string(),
}).strict();

// 5. read_import_outcome
export const ReadImportOutcomeInputSchema = z.object({
  workspaceId: z.string().trim().min(1),
  jobId: z.string().trim().min(1),
}).strict();

export const ReadImportOutcomeOutputSchema = z.object({
  jobId: z.string(),
  status: z.enum(["pending", "running", "completed", "failed", "partial"]),
  completedChunks: z.number().int().nonnegative(),
  totalChunks: z.number().int().nonnegative(),
  failedAccountIds: z.array(z.string()),
  errorMessage: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
}).strict();

// 6. verify_coverage
export const VerifyCoverageInputSchema = z.object({
  workspaceId: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  accountIds: z.array(z.string().trim().min(1)).min(1),
  since: CalendarDateSchema,
  until: CalendarDateSchema,
  expectedJobId: z.string().trim().min(1).optional(),
}).strict().refine(data => data.since <= data.until, {
  message: "Invalid date range: 'since' must be earlier than or equal to 'until'",
  path: ["since"],
});

export const VerifyCoverageOutputSchema = z.object({
  verified: z.boolean(),
  accountIds: z.array(z.string()),
  since: z.string(),
  until: z.string(),
  missingDays: z.array(z.string()),
  verifiedRowCount: z.number().int().nonnegative(),
  datasetFingerprint: z.string(),
  blockers: z.array(z.string()),
}).strict();

// 7. draft_internal_report
export const DraftInternalReportInputSchema = z.object({
  workspaceId: z.string().trim().min(1),
  responsibilityId: z.string().trim().min(1),
  caseId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(2000),
  evidenceSnapshotId: z.string().trim().min(1),
}).strict();

export const DraftInternalReportOutputSchema = z.object({
  reportDraftId: z.string(),
  title: z.string(),
  summary: z.string(),
  status: z.literal("internal_draft_only"),
  isDeliveredExternally: z.literal(false),
  createdAt: z.string(),
}).strict();

export const CONSOLE_TOOL_REGISTRY: Readonly<Record<string, ToolDefinition<any, any>>> = {
  inspect_source: {
    name: "inspect_source",
    description: "Inspects source connection health and credential status without reading tokens",
    category: "read",
    requiredPermission: "read_data_and_cases",
    outcomeEvidenceRequired: true,
    rollbackOwner: "Operations",
    failureBehavior: "Records CHECK_UNAVAILABLE; marks source investigation inconclusive; does not retry automatically",
    timeoutMs: 5000,
    maxRetries: 2,
    inputSchema: InspectSourceInputSchema,
    outputSchema: InspectSourceOutputSchema,
  },
  query_coverage: {
    name: "query_coverage",
    description: "Evaluates daily row coverage against expected calendar days for target accounts",
    category: "read",
    requiredPermission: "read_data_and_cases",
    outcomeEvidenceRequired: true,
    rollbackOwner: "Data Engineering",
    failureBehavior: "Flags WINDOW_INCOMPLETE; leaves case in investigating without fabricating zero-activity",
    timeoutMs: 10000,
    maxRetries: 2,
    inputSchema: QueryCoverageInputSchema,
    outputSchema: QueryCoverageOutputSchema,
  },
  query_metric_window: {
    name: "query_metric_window",
    description: "Deterministically aggregates spend, conversions, CPA, and ROAS across completed windows",
    category: "read",
    requiredPermission: "read_data_and_cases",
    outcomeEvidenceRequired: true,
    rollbackOwner: "Data Engineering",
    failureBehavior: "Produces undefined ratios for zero denominators; sets METRIC_UNSUPPORTED on mismatched currencies",
    timeoutMs: 15000,
    maxRetries: 1,
    inputSchema: QueryMetricWindowInputSchema,
    outputSchema: QueryMetricWindowOutputSchema,
  },
  submit_recovery_import: {
    name: "submit_recovery_import",
    description: "Enqueues a durable warehouse import job specifically for missing dates and accounts",
    category: "mutate_warehouse_job",
    requiredPermission: "submit_data_recovery",
    outcomeEvidenceRequired: true,
    rollbackOwner: "Data Platform",
    failureBehavior: "Fails gracefully to needs_customer if attempts exhausted; releases lease; does not replay blindly",
    timeoutMs: 10000,
    maxRetries: 3,
    inputSchema: SubmitRecoveryImportInputSchema,
    outputSchema: SubmitRecoveryImportOutputSchema,
  },
  read_import_outcome: {
    name: "read_import_outcome",
    description: "Reconciles the status and chunk outcomes of a submitted warehouse recovery job",
    category: "read",
    requiredPermission: "read_data_and_cases",
    outcomeEvidenceRequired: true,
    rollbackOwner: "Data Platform",
    failureBehavior: "Treats lost leases or unfinalized chunks as unknown_outcome; triggers reconciliation rather than new job",
    timeoutMs: 5000,
    maxRetries: 3,
    inputSchema: ReadImportOutcomeInputSchema,
    outputSchema: ReadImportOutcomeOutputSchema,
  },
  verify_coverage: {
    name: "verify_coverage",
    description: "Authoritatively queries the warehouse to verify recovered accounts and dates before resolving a case",
    category: "read",
    requiredPermission: "read_data_and_cases",
    outcomeEvidenceRequired: true,
    rollbackOwner: "Data Engineering",
    failureBehavior: "Refuses case resolution if even one expected account-day is missing; retains open case",
    timeoutMs: 10000,
    maxRetries: 2,
    inputSchema: VerifyCoverageInputSchema,
    outputSchema: VerifyCoverageOutputSchema,
  },
  draft_internal_report: {
    name: "draft_internal_report",
    description: "Creates an internal summary draft linked to an immutable evidence snapshot",
    category: "draft",
    requiredPermission: "read_data_and_cases",
    outcomeEvidenceRequired: true,
    rollbackOwner: "Product",
    failureBehavior: "Persists draft failure; never delivers externally without C8 approval gate",
    timeoutMs: 5000,
    maxRetries: 1,
    inputSchema: DraftInternalReportInputSchema,
    outputSchema: DraftInternalReportOutputSchema,
  },
};

export class ToolExecutionError extends Error {
  constructor(
    public readonly toolName: string,
    message: string,
    public readonly qualityCodes: QualityGateCode[] = [],
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

export interface ValidateToolOptions {
  executionMode?: ExecutionMode;
  explicitProvider?: string;
}

/**
 * Validates tool call authorization, capability, and input schema before execution.
 * Derives provider and requested metrics directly from validated tool input.
 * Rejects provider mismatches, missing required capability context, and unsupported metrics.
 */
export function validateToolInvocation(
  toolName: string,
  rawInput: unknown,
  authContext: AuthorityContext,
  options: ValidateToolOptions = {},
): { tool: ToolDefinition; validatedInput: any } {
  const tool = CONSOLE_TOOL_REGISTRY[toolName];
  if (!tool) {
    throw new ToolExecutionError(toolName, `Tool '${toolName}' is not registered in the console tool registry`);
  }

  // 1. Authority validation
  assertAuthority(tool.requiredPermission, authContext);

  // 2. Schema validation
  const validatedInput = tool.inputSchema.parse(rawInput);

  // 3. Provider derivation and mismatch check
  const derivedProvider = (validatedInput as { provider?: string }).provider;
  if (options.explicitProvider && derivedProvider && options.explicitProvider !== derivedProvider) {
    throw new ToolExecutionError(
      toolName,
      `Provider mismatch: tool payload specifies '${derivedProvider}' but call context expects '${options.explicitProvider}'`,
      ["SEMANTICS_UNKNOWN"],
    );
  }

  const effectiveProvider = derivedProvider || options.explicitProvider;

  // 4. Provider capability evaluation
  if (effectiveProvider) {
    const requestedMetrics = (validatedInput as { metrics?: (keyof MetricSemantics)[] }).metrics;
    const hasCurrency = (validatedInput as { expectedCurrency?: string }).expectedCurrency !== undefined;
    const hasTimezone = (validatedInput as { expectedTimezone?: string }).expectedTimezone !== undefined;

    const capability = evaluateProviderCapability(effectiveProvider, toolName, {
      executionMode: options.executionMode ?? "live_production",
      metricNames: requestedMetrics,
      currencySupplied: hasCurrency,
      timezoneSupplied: hasTimezone,
    });

    if (!capability.allowed) {
      throw new ToolExecutionError(
        toolName,
        capability.reason || `Provider '${effectiveProvider}' cannot execute tool '${toolName}'`,
        capability.blockers,
      );
    }
  }

  return { tool, validatedInput };
}
