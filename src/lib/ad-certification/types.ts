/**
 * Ad Connector Live-Certification Types & Standards
 *
 * Implements the 8-tier certification model:
 * CODE_VERIFIED -> SANDBOX_VERIFIED -> LIVE_CONNECTED -> LIVE_IMPORTED ->
 * LIVE_RECONCILED -> DESTINATION_VERIFIED -> RECOVERY_VERIFIED -> PILOT_CERTIFIED
 */

export const CERTIFICATION_LEVELS = [
  "CODE_VERIFIED",
  "SANDBOX_VERIFIED",
  "LIVE_CONNECTED",
  "LIVE_IMPORTED",
  "LIVE_RECONCILED",
  "DESTINATION_VERIFIED",
  "RECOVERY_VERIFIED",
  "PILOT_CERTIFIED",
] as const;

export type CertificationLevel = (typeof CERTIFICATION_LEVELS)[number];

export type AdProvider = "google_ads" | "meta_ads" | "tiktok_business";

export type GateStatus =
  | "PASSED"
  | "FAILED"
  | "BLOCKED"
  | "NOT_APPLICABLE"
  | "NOT_EXECUTED";

export interface CertificationGateResult {
  gate: CertificationLevel;
  status: GateStatus;
  timestamp: string;
  details: string;
  isApplicable?: boolean;
  notApplicableReason?: string;
  alternativeVerificationPath?: string;
  blockerCategory?: string;
  blockerDetails?: string;
  requiredAction?: string;
  evidence?: Record<string, unknown>;
}

export type EvidenceClass =
  | "synthetic_fixture"
  | "sandbox_evidence"
  | "live_certification_evidence";

export type VerificationSource =
  | "portal_owner_confirmed"
  | "portal_inspection"
  | "runtime_token_info"
  | "owner_attestation"
  | "unverified";

export interface ProviderAccessFacts {
  observedApiVersion: string;
  appAccountMode: "development" | "live" | "test_account" | "unverified";
  grantedScopesOrPermissions: string[];
  accessLevelStatus: "standard" | "basic" | "developer" | "unverified";
  authorizationModel: "oauth2_user_consent" | "service_account" | "long_lived_system_token" | "unverified";
  tokenLifecycleModel: "refreshable_offline" | "long_lived_user" | "short_lived_bearer" | "unverified";
  verificationSource: VerificationSource;
  verifiedAt: string | null;
  status: "VERIFIED" | "UNVERIFIED";
}

export type ComparisonSource = "UI_EXPORT" | "AD_MANAGER_UI" | "DIRECT_API";

export interface ReconciliationTimingContext {
  nativeRetrievalTime?: string;
  monsteraDataThroughTime?: string;
  warehouseQueryTime?: string;
  accountTimezone: string;
  currency: string;
  dateRange: { start: string; end: string };
  attributionConfig?: string;
  conversionEventSelection?: string;
  campaignStatusFilter?: string;
  reportingGranularity?: "DAILY" | "TOTAL";
  lateArrivalLookbackDays?: number;
  nativeComparisonSource?: ComparisonSource;
}

export interface MetricComparison {
  metric: string;
  providerValue: number;
  warehouseValue: number;
  absoluteVariance: number;
  percentVariance: number | null;
  tolerance: number;
  withinTolerance: boolean;
  explanationRequired: boolean;
  explanation?: string;
}

export interface ReconciliationSummary {
  passed: boolean;
  accountTimezone: string;
  currency: string;
  dateRange: { start: string; end: string };
  metrics: MetricComparison[];
  underlyingInputsValid: boolean;
  unexplainedVariances: string[];
  // Explicit snapshot timing & semantics
  nativeRetrievalTime?: string;
  monsteraDataThroughTime?: string;
  warehouseQueryTime?: string;
  attributionConfig?: string;
  conversionEventSelection?: string;
  campaignStatusFilter?: string;
  reportingGranularity?: "DAILY" | "TOTAL";
  lateArrivalLookbackDays?: number;
  nativeComparisonSource?: ComparisonSource;
  isSnapshotAligned: boolean;
  isInconclusive: boolean;
  inconclusiveReason?: string;
}

export interface DestinationStatusBreakdown {
  codePath: "CODE_VERIFIED";
  authenticatedLiveRetrieval: "pending" | "verified";
  currentDeliveryReceipt: "pending" | "confirmed";
  destinationCertificationLevel: "not reached" | "DESTINATION_VERIFIED";
  details: string;
}

export interface HumanReviewSignOff {
  reviewerName: string;
  reviewerRole: string;
  signedAt: string;
  comments?: string;
}

export interface CertificationSimulationOptions {
  simulatedConnection?: boolean;
  simulatedWarehouseRows?: number;
  simulatedWarehouseTotals?: {
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
    accountTimezone?: string;
    currency?: string;
  };
  simulatedDestinationReceiptId?: string;
  simulatedRecoveryPassed?: boolean;
  unjustifiedSandboxExemption?: boolean;
  unjustifiedGateExemption?: CertificationLevel;
}

export type CertificationStorageType =
  | "database_backed"
  | "object_storage_backed"
  | "operator_local_export"
  | "git_ignored_local"
  | "synthetic_fixture";

export interface TrustedRuntimeMetadata {
  commitSha?: string;
  schemaVersion?: string;
  workingTreeDirty?: boolean;
  harnessVersion?: string;
  evidencePackSchemaVersion?: string;
}

export interface CertificationHarnessInput {
  workspaceId: string;
  connectionId?: string;
  provider: AdProvider;
  accountId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  destination?: "google_sheets" | "looker_studio" | null;
  buildId: string;
  dryRun?: boolean;
  evidenceClass?: EvidenceClass;
  outputDirectory?: string;
  allowOperatorLocalExport?: boolean;
  providerAccessFacts?: ProviderAccessFacts;
  snapshotTiming?: Partial<ReconciliationTimingContext>;
  nativeComparison?: {
    spend?: number;
    impressions?: number;
    clicks?: number;
    conversions?: number;
    revenue?: number;
    [key: string]: number | undefined;
  };
  varianceExplanations?: Record<string, string>;
  humanReviewSignOff?: HumanReviewSignOff;
  simulation?: CertificationSimulationOptions;
  // Immutable runtime metadata and traceability overrides
  trustedRuntimeMetadata?: TrustedRuntimeMetadata;
  clientSuppliedCommitSha?: string;
  clientSuppliedSchemaVersion?: string;
  expectedCommitSha?: string;
  expectedSchemaVersion?: string;
}

export interface CertificationBlocker {
  category: string;
  description: string;
  requiredAction: string;
}

export interface CertificationEvidencePack {
  runId: string;
  buildId: string;
  provider: AdProvider;
  workspaceId: string;
  accountId: string; // Stably masked
  dateRange: { start: string; end: string; days: number };
  evaluatedAt: string;
  highestProvenLevel: CertificationLevel;
  pilotEligible: boolean;
  certificationEligible: boolean;
  workingTreeDirty: boolean;
  evidenceClass: EvidenceClass;
  storageType: CertificationStorageType;
  storagePath?: string;
  localExportWarning?: string;
  localExportDeletionPolicy?: string;
  destinationStatus: DestinationStatusBreakdown;
  providerAccessFacts?: ProviderAccessFacts;
  gateOutcomes: CertificationGateResult[];
  reconciliation?: ReconciliationSummary;
  blockers: CertificationBlocker[];
  metadata: {
    monsteraVersion: string;
    gitCommit?: string;
    commitSha: string;
    schemaVersion: string;
    harnessVersion: string;
    contractVersion: string;
    evidencePackSchemaVersion: string;
    workingTreeDirty: boolean;
    certificationEligible: boolean;
    evaluatedBy: string;
    commandsUsed?: string[];
    buildId: string;
  };
}
