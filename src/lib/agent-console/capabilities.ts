import { z } from "zod";

/**
 * Quality gate codes as defined in Section 7 of docs/implementation-plans/agent-first-console.md.
 * These codes indicate data eligibility, coverage, semantics, or scheduler status.
 */
export const QualityGateCode = z.enum([
  "ROSTER_UNCONFIRMED",
  "ACCOUNT_MISSING",
  "DATA_STALE",
  "WINDOW_INCOMPLETE",
  "ZERO_DAY_UNVERIFIED",
  "CURRENCY_UNKNOWN",
  "CURRENCY_CONFLICT",
  "TIMEZONE_UNKNOWN",
  "TIMEZONE_CONFLICT",
  "METRIC_UNSUPPORTED",
  "SEMANTICS_UNKNOWN",
  "GRAIN_AMBIGUOUS",
  "DUPLICATE_ACCOUNT",
  "EVIDENCE_LIMIT_REACHED",
  "CHECK_UNAVAILABLE",
  "SCHEDULER_DELAYED",
]);
export type QualityGateCode = z.infer<typeof QualityGateCode>;

export type LiveValidationStatus = "unverified" | "locally_verified" | "live_certified";

export type ExecutionMode = "local_test" | "live_production";

export type MetricSemantics = {
  spend: boolean;
  conversions: boolean;
  cpa: boolean;
  roas: boolean;
  revenue: boolean;
  conversionBasisDescription?: string;
  revenueBasisDescription?: string;
};

export type RowGrain = "account" | "campaign" | "adgroup" | "ad" | "daily_order_rollup";

export interface ProvenanceRequirement {
  endpoint: string;
  rowGrain: RowGrain;
  conversionActionOrWindow?: string | null;
  revenueBasis?: string | null;
  provenanceVerified: boolean;
  zeroDayProofVerified?: boolean;
}

export interface ProviderCapabilityDefinition {
  providerId: string;
  displayName: string;
  status: "enabled" | "disabled" | "preview";
  liveValidationStatus: LiveValidationStatus;
  supportedTools: readonly string[];
  supportedRowGrains: readonly RowGrain[];
  metricSemantics: MetricSemantics;
  requiresCurrency: boolean;
  requiresTimezone: boolean;
  lateCorrectionHorizonDays: number;
  dataAvailabilityLagDays: number;
  zeroDayProofSupported: boolean;
  reportabilitySupported: boolean;
  notes: string;
}

/**
 * Canonical registry of provider capabilities.
 * Per Non-negotiable Trust Rules and C0 exit gate:
 * Integration-enabled is not the same as metric-certified.
 * Unverified provider capabilities remain disabled for live autonomous claims.
 */
export const PROVIDER_CAPABILITY_REGISTRY: Readonly<Record<string, ProviderCapabilityDefinition>> = {
  tiktok_business: {
    providerId: "tiktok_business",
    displayName: "TikTok Ads",
    status: "preview", // C1 vertical slice target
    liveValidationStatus: "unverified", // No live certified test account validated yet
    supportedTools: [
      "inspect_source",
      "query_coverage",
      "query_metric_window",
      "submit_recovery_import",
      "read_import_outcome",
      "verify_coverage",
      "draft_internal_report",
    ],
    supportedRowGrains: ["account", "campaign", "adgroup", "ad"],
    metricSemantics: {
      spend: true,
      conversions: true,
      cpa: true,
      roas: true,
      revenue: false, // In-app TikTok shop or ad GMV requires separate certification
      conversionBasisDescription: "Attributed conversions reported by TikTok Ads API within the configured lookback window",
    },
    requiresCurrency: true,
    requiresTimezone: true,
    lateCorrectionHorizonDays: 7,
    dataAvailabilityLagDays: 1,
    zeroDayProofSupported: false, // TikTok API omits inactive days rather than returning explicit zero rows
    reportabilitySupported: true,
    notes: "Default C1 vertical slice provider. Live certification pending test account with reportable history.",
  },
  meta_ads: {
    providerId: "meta_ads",
    displayName: "Meta Ads",
    status: "preview",
    liveValidationStatus: "unverified",
    supportedTools: [
      "inspect_source",
      "query_coverage",
      "query_metric_window",
      "submit_recovery_import",
      "read_import_outcome",
      "verify_coverage",
      "draft_internal_report",
    ],
    supportedRowGrains: ["account", "campaign", "ad"],
    metricSemantics: {
      spend: true,
      conversions: true,
      cpa: true,
      roas: true,
      revenue: false,
      conversionBasisDescription: "Meta 7-day click / 1-day view attribution default",
    },
    requiresCurrency: true,
    requiresTimezone: true,
    lateCorrectionHorizonDays: 28, // Meta attribution window can update up to 28 days
    dataAvailabilityLagDays: 1,
    zeroDayProofSupported: false,
    reportabilitySupported: true,
    notes: "Requires dedicated review of late conversion adjustments.",
  },
  google_ads: {
    providerId: "google_ads",
    displayName: "Google Ads",
    status: "preview",
    liveValidationStatus: "unverified",
    supportedTools: [
      "inspect_source",
      "query_coverage",
      "query_metric_window",
      "submit_recovery_import",
      "read_import_outcome",
      "verify_coverage",
      "draft_internal_report",
    ],
    supportedRowGrains: ["account", "campaign"],
    metricSemantics: {
      spend: true,
      conversions: true,
      cpa: true,
      roas: true,
      revenue: false,
      conversionBasisDescription: "Google Ads conversion tracking by conversion date",
    },
    requiresCurrency: true,
    requiresTimezone: true,
    lateCorrectionHorizonDays: 14,
    dataAvailabilityLagDays: 1,
    zeroDayProofSupported: false,
    reportabilitySupported: true,
    notes: "Requires MCC vs individual client account reconciliation.",
  },
  shopee: {
    providerId: "shopee",
    displayName: "Shopee",
    status: "preview",
    liveValidationStatus: "unverified",
    supportedTools: [
      "inspect_source",
      "query_coverage",
      "query_metric_window",
      "submit_recovery_import",
      "read_import_outcome",
      "verify_coverage",
      "draft_internal_report",
    ],
    supportedRowGrains: ["account", "daily_order_rollup", "campaign"],
    metricSemantics: {
      spend: true, // Best-effort ads performance where enabled
      conversions: true, // Order count
      cpa: false, // Marketplace blended CPA uncertified
      roas: false,
      revenue: true, // Daily order rollup revenue
      revenueBasisDescription: "Completed or placed order total according to marketplace daily sync",
    },
    requiresCurrency: true,
    requiresTimezone: true,
    lateCorrectionHorizonDays: 15,
    dataAvailabilityLagDays: 1,
    zeroDayProofSupported: true, // Explicit 0 order counts recorded in daily rollups
    reportabilitySupported: true,
    notes: "Ads sync is best-effort pending Partner Center activation; order sync is primary.",
  },
};

export interface CapabilityEvaluationResult {
  allowed: boolean;
  blockers: QualityGateCode[];
  reason?: string;
  isSyntheticTest?: boolean;
}

export interface CapabilityEvaluationOptions {
  executionMode?: ExecutionMode;
  metricNames?: readonly (keyof MetricSemantics)[];
  provenance?: ProvenanceRequirement;
  currencySupplied?: boolean;
  timezoneSupplied?: boolean;
}

/**
 * Evaluates whether a provider is eligible to execute a given tool or measure requested metrics.
 * Strictly distinguishes local/test mode from live/production mode:
 * - In live_production mode, unverified providers CANNOT make certified financial claims or run autonomous actions.
 * - In local_test mode, executions are permitted for unit tests/fixtures but marked synthetic.
 */
export function evaluateProviderCapability(
  providerId: string,
  toolName: string,
  options: CapabilityEvaluationOptions = {},
): CapabilityEvaluationResult {
  const capability = PROVIDER_CAPABILITY_REGISTRY[providerId];
  if (!capability) {
    return {
      allowed: false,
      blockers: ["METRIC_UNSUPPORTED"],
      reason: `Provider '${providerId}' is not registered in capability registry`,
    };
  }

  const blockers: QualityGateCode[] = [];
  const mode = options.executionMode ?? "live_production";

  // 1. Live vs Local Mode Enforcement
  if (mode === "live_production" && capability.liveValidationStatus !== "live_certified") {
    blockers.push("CHECK_UNAVAILABLE");
    return {
      allowed: false,
      blockers,
      reason: `Provider '${providerId}' is not certified for live production claims (status: ${capability.liveValidationStatus}). Autonomous execution and certified metric claims remain disabled until live account certification.`,
    };
  }

  if (capability.status === "disabled") {
    blockers.push("CHECK_UNAVAILABLE");
  }

  // 2. Tool support check
  if (!capability.supportedTools.includes(toolName)) {
    blockers.push("METRIC_UNSUPPORTED");
  }

  // 3. Requested metrics check
  if (options.metricNames && options.metricNames.length > 0) {
    for (const metric of options.metricNames) {
      if (!capability.metricSemantics[metric]) {
        blockers.push("METRIC_UNSUPPORTED");
        blockers.push("SEMANTICS_UNKNOWN");
      }
    }
  }

  // 4. Context requirements (currency & timezone)
  if (capability.requiresCurrency && options.currencySupplied === false) {
    blockers.push("CURRENCY_UNKNOWN");
  }
  if (capability.requiresTimezone && options.timezoneSupplied === false) {
    blockers.push("TIMEZONE_UNKNOWN");
  }

  // 5. Provenance requirements check
  if (options.provenance) {
    if (!options.provenance.provenanceVerified) {
      blockers.push("SEMANTICS_UNKNOWN");
    }
    if (!capability.supportedRowGrains.includes(options.provenance.rowGrain)) {
      blockers.push("GRAIN_AMBIGUOUS");
    }
    if (!capability.zeroDayProofSupported && !options.provenance.zeroDayProofVerified) {
      blockers.push("ZERO_DAY_UNVERIFIED");
    }
  }

  if (blockers.length > 0) {
    return {
      allowed: false,
      blockers: [...new Set(blockers)],
      reason: `Provider '${providerId}' blocked by quality gates: ${[...new Set(blockers)].join(", ")}`,
      isSyntheticTest: mode === "local_test",
    };
  }

  return {
    allowed: true,
    blockers: [],
    isSyntheticTest: mode === "local_test",
  };
}

/**
 * Checks whether live certification has been completed.
 * Per Trust Rule 7 and C0 Exit Gate: Never substitute synthetic tests for live certification.
 */
export function isProviderLiveCertified(providerId: string): boolean {
  const capability = PROVIDER_CAPABILITY_REGISTRY[providerId];
  return capability?.liveValidationStatus === "live_certified";
}
