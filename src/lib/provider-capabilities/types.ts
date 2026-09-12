export type CapabilityProvider = "meta_ads";

export type ReportSurface = "ads_insights";

export type ReportType = "performance";

export type CapabilityKind =
  | "report"
  | "field"
  | "breakdown"
  | "attribution_window";

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
}

export interface CapabilityLookbackLimit {
  readonly value: number;
  readonly unit: LookbackUnit;
  readonly anchor: "evaluation_date";
}

export interface AttributionRestriction {
  readonly allowedWindows?: readonly string[];
  readonly unavailableWindows?: readonly string[];
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

export interface CapabilityLookup {
  readonly provider: string;
  readonly reportSurface: string;
  readonly reportType: string;
  readonly kind: CapabilityKind;
  readonly capabilityId: string;
  /** When omitted, returns the latest registry record for the capability. */
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

export type CapabilityReasonCode =
  | "INVALID_DATE_RANGE"
  | "UNKNOWN_PROVIDER"
  | "UNKNOWN_REPORT_SURFACE"
  | "UNKNOWN_CAPABILITY"
  | "CAPABILITY_RETIRED"
  | "ATTRIBUTION_WINDOW_RETIRED"
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
  readonly compatible: boolean;
  readonly reasons: readonly CompatibilityReason[];
  readonly affectedFields: readonly string[];
}
