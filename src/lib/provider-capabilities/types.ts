/** Known values remain suggested by editors, while the intersection permits new providers. */
export type CapabilityProvider = "meta_ads" | (string & {});

export type ReportSurface = "ads_insights" | (string & {});

export type ReportType = "performance" | (string & {});

export type CapabilityKind =
  | "report"
  | "field"
  | "breakdown"
  | "attribution_window";

export type CapabilityIdentifierMatch = "exact" | "prefix";

export type CapabilityLifecycle =
  | "active"
  | "deprecated"
  | "restricted"
  | "retired";

export type CapabilitySeverity = "info" | "warning" | "error";

export type ReportGranularity = "account" | "campaign" | "adset" | "ad";

export type LookbackUnit = "day" | "month";

export interface CapabilitySourceReference {
  readonly title: string;
  readonly url: string;
  readonly accessedOn: string;
  /** A concise statement of the source material used for this record. */
  readonly evidence: string;
}

export interface CapabilityLookbackLimit {
  readonly value: number;
  readonly unit: LookbackUnit;
  readonly anchor: "evaluation_date";
}

export interface AttributionRestriction {
  /** Windows explicitly usable for this report surface. */
  readonly allowedWindows?: readonly string[];
  /** Individual windows that cannot be used, even when otherwise allowed. */
  readonly unavailableWindows?: readonly string[];
  /** Each listed set is invalid when all of its windows occur in a request. */
  readonly forbiddenCombinations?: readonly (readonly string[])[];
  readonly explanation: string;
}

export interface ProviderCapability {
  readonly registryVersion: string;
  readonly recordId: string;
  readonly provider: CapabilityProvider;
  readonly reportSurface: ReportSurface;
  readonly reportType: ReportType;
  readonly kind: CapabilityKind;
  /** Provider-native field, breakdown, attribution-window, or report identifier. */
  readonly capabilityId: string;
  /** Exact is the safe default. Prefix matching must be declared per record. */
  readonly identifierMatch?: CapabilityIdentifierMatch;
  readonly lifecycle: CapabilityLifecycle;
  /** Inclusive UTC calendar date on which this registry record takes effect. */
  readonly effectiveDate: string;
  readonly replacement?: readonly string[];
  readonly lookbackLimit?: CapabilityLookbackLimit;
  readonly granularities: readonly ReportGranularity[];
  readonly attributionRestrictions: readonly AttributionRestriction[];
  readonly severity: CapabilitySeverity;
  readonly operatorExplanation: string;
  readonly sourceReference: CapabilitySourceReference;
}

export type CapabilityRegistry = readonly ProviderCapability[];

export interface CapabilityLookup {
  readonly provider: string;
  readonly reportSurface: string;
  readonly reportType: string;
  readonly kind: CapabilityKind;
  readonly capabilityId: string;
  /** When supplied, selects only entries effective on this inclusive date. */
  readonly asOf?: string;
}

export interface CapabilityRequest {
  readonly provider: string;
  readonly reportSurface: string;
  readonly reportType: string;
  readonly granularity: ReportGranularity;
  readonly fields?: readonly string[];
  readonly breakdowns?: readonly string[];
  readonly attributionWindows?: readonly string[];
  readonly since: string;
  readonly until: string;
  /** Explicit evaluation date keeps results reproducible across runs. */
  readonly asOf: string;
}

export interface CapabilityEvaluationOptions {
  /** Caller-owned data is cloned and never mutated by the registry. */
  readonly registry?: CapabilityRegistry;
}

export type CapabilityReasonCode =
  | "INVALID_DATE_RANGE"
  | "UNKNOWN_PROVIDER"
  | "UNKNOWN_REPORT_SURFACE"
  | "UNKNOWN_CAPABILITY"
  | "CAPABILITY_RETIRED"
  | "ATTRIBUTION_WINDOW_RETIRED"
  | "UNKNOWN_ATTRIBUTION_WINDOW"
  | "ATTRIBUTION_WINDOW_NOT_ALLOWED"
  | "ATTRIBUTION_WINDOW_FORBIDDEN_COMBINATION"
  | "GRANULARITY_NOT_SUPPORTED"
  | "LOOKBACK_LIMIT_EXCEEDED";

export interface CompatibilityReason {
  readonly code: CapabilityReasonCode;
  readonly severity: CapabilitySeverity;
  readonly kind?: CapabilityKind;
  readonly capabilityId?: string;
  readonly affectedFields: readonly string[];
  readonly replacement: readonly string[];
  readonly operatorGuidance: string;
  readonly sourceReference?: CapabilitySourceReference;
}

export interface CompatibilityEvaluation {
  readonly registryVersion: string;
  /** Only error-severity findings make a request incompatible. */
  readonly compatible: boolean;
  /** The complete deterministic set of errors, warnings, and informational notices. */
  readonly findings: readonly CompatibilityReason[];
  /** @deprecated Use findings. Kept for V1 callers while they migrate. */
  readonly reasons: readonly CompatibilityReason[];
  readonly affectedFields: readonly string[];
}

export interface ProviderCapabilityRegistryApi {
  readonly list: () => readonly ProviderCapability[];
  readonly lookup: (lookup: CapabilityLookup) => ProviderCapability | undefined;
  readonly evaluate: (request: CapabilityRequest) => CompatibilityEvaluation;
  readonly evaluateAttributionWindows: (
    request: CapabilityRequest,
  ) => readonly CompatibilityReason[];
}
