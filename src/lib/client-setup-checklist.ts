/**
 * Guided client reporting setup — canonical presentation state.
 *
 * Pure view-model: derives an operator checklist from existing API data
 * (reporting configuration, discovered account assignments, readiness
 * evaluation). It contains no readiness business logic of its own — every
 * data/readiness verdict is read from the server-derived readiness
 * evaluation (`dataStatus`, `dataBlockers`, `dataWarnings`, provider
 * freshness/evidence) or from stored client requirement timestamps.
 *
 * No network calls, no Prisma, no KPI definitions. Browser-safe.
 */
import {
  READINESS_MESSAGES,
  type ReadinessCode,
  type ReportReadinessEvaluation,
  type ReportReadinessStatus,
} from "./report-readiness";
import { withClientContext, withClientContextAndParams } from "./client-context";

export const SETUP_SECTION_ANCHOR = "reporting-setup";

export function clientSetupHref(clientId: string): string {
  return `/clients?${new URLSearchParams({ clientId }).toString()}#${SETUP_SECTION_ANCHOR}`;
}

/**
 * Provider capability, mirroring the existing account-discovery contract:
 * `GET /api/connections/[id]/accounts` supports explicit discovery for the
 * three paid-media providers only. Marketplace shops resolve through their
 * connection credentials, so no account picker exists for them.
 */
export const ACCOUNT_DISCOVERY_PROVIDERS = ["meta_ads", "google_ads", "tiktok_business"] as const;
export const CREDENTIAL_RESOLVED_PROVIDERS = ["shopee", "lazada"] as const;

/**
 * Weekly Blueprint v1 verification scope. Mirrors the canonical
 * `BLUEPRINT_SUPPORTED_PROVIDERS` in `src/lib/report-blueprint.ts` (which is
 * server-only: node:crypto + Prisma — so the list is repeated here instead of
 * imported to keep this presentation module browser-safe). Connection and
 * assignment completeness is tracked independently from verification support.
 */
export const BLUEPRINT_V1_SUPPORTED_PROVIDERS = ["google_ads", "meta_ads", "tiktok_business"] as const;

export function isBlueprintV1Supported(provider: string): boolean {
  return (BLUEPRINT_V1_SUPPORTED_PROVIDERS as readonly string[]).includes(provider);
}

export function isSetupFocusFragment(value: string | null | undefined): boolean {
  return value === `#${SETUP_SECTION_ANCHOR}`;
}

export const PROVIDER_LABELS: Record<string, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  tiktok_business: "TikTok Ads",
  shopee: "Shopee",
  lazada: "Lazada",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider.replaceAll("_", " ");
}

export type SetupStepState =
  | "complete"
  | "needs-attention"
  | "action-required"
  | "waiting-for-admin"
  | "optional"
  | "not-available";

export const SETUP_STATE_LABELS: Record<SetupStepState, string> = {
  complete: "Complete",
  "needs-attention": "Needs attention",
  "action-required": "Action required",
  "waiting-for-admin": "Waiting for admin",
  optional: "Optional",
  "not-available": "Not available for this provider",
};

export type SetupRole = "owner" | "admin" | "member" | "viewer";

export interface ChecklistRequirementsInput {
  providers: string[];
  destinations: string[];
  configuredAt: string | null;
}

export interface ChecklistDiscoveredInput {
  provider: string;
  accountId: string;
  assignedClientId: string | null;
  connectionIds: string[];
}

export interface ChecklistConfigurationAccountInput {
  connectionId: string;
  accountId: string;
  hasOverride: boolean;
}

export type ChecklistEvaluationInput = Pick<
  ReportReadinessEvaluation,
  | "workspaceId"
  | "clientId"
  | "status"
  | "dataStatus"
  | "dataBlockers"
  | "dataWarnings"
  | "blockers"
  | "warnings"
  | "requiredProviders"
  | "requiredProvidersBasis"
  | "providers"
  | "destination"
  | "currencies"
  | "timezones"
>;

export interface DeriveClientSetupInput {
  workspaceId: string;
  clientId: string;
  clientName: string;
  role: SetupRole;
  canEdit: boolean;
  requirements: ChecklistRequirementsInput;
  discovered: ChecklistDiscoveredInput[];
  configurationAccounts: ChecklistConfigurationAccountInput[];
  evaluation: ChecklistEvaluationInput | null;
}

export interface SetupRecovery {
  href: string;
  label: string;
}

export interface SetupSectionState {
  id: "requirements" | "accounts" | "data" | "context" | "readiness" | "delivery";
  title: string;
  state: SetupStepState;
  summary: string;
  recovery: SetupRecovery | null;
}

export interface ProviderSetupState {
  provider: string;
  label: string;
  state: SetupStepState;
  detail: string;
  discovery: "account-picker" | "credential-resolved" | "unknown";
  /** Whether Weekly Blueprint v1 verifies this provider. Independent from
   * account/connection completeness: a marketplace row can be `complete`
   * while unsupported. */
  blueprintSupported: boolean;
  recovery: SetupRecovery | null;
}

export interface SetupBlockerView {
  code: ReadinessCode;
  provider: string | null;
  message: string;
  recovery: SetupRecovery | null;
}

export interface ClientSetupState {
  workspaceId: string;
  clientId: string;
  clientName: string;
  role: SetupRole;
  canEdit: boolean;
  requirementsConfigured: boolean;
  generationBlocked: boolean;
  /** Required providers that Weekly Blueprint v1 does not verify. Exposed so
   * the summary can qualify readiness without changing generation gating. */
  unsupportedRequiredProviders: string[];
  readinessStatus: ReportReadinessStatus | "unevaluated";
  dataStatus: ReportReadinessStatus | "unevaluated";
  recoveryHref: string;
  sections: {
    requirements: SetupSectionState;
    accounts: SetupSectionState;
    data: SetupSectionState;
    context: SetupSectionState;
    readiness: SetupSectionState;
    delivery: SetupSectionState;
  };
  providers: ProviderSetupState[];
  blockers: SetupBlockerView[];
}

export type SetupDerivation = { ok: true; state: ClientSetupState } | { ok: false; reason: "scope-mismatch" };

const DESTINATION_CODES = new Set(["DESTINATION_UNAVAILABLE", "DESTINATION_STALE", "DESTINATION_UNVERIFIED", "DESTINATION_REQUIREMENTS_MISSING"]);
const UNKNOWN_CONTEXT_CODES = new Set<ReadinessCode>(["CURRENCY_UNKNOWN", "TIMEZONE_UNKNOWN", "SOURCE_UNVERIFIED"]);
const CONFLICT_CONTEXT_CODES = new Set<ReadinessCode>(["CURRENCY_CONFLICT", "TIMEZONE_CONFLICT"]);

function isDataIssue(code: ReadinessCode): boolean {
  return !DESTINATION_CODES.has(code);
}

function sourcesHref(clientId: string): string {
  return withClientContextAndParams("/sources", clientId, { tab: "accounts" });
}

function sourceHref(connectionId: string): string {
  return `/sources/${encodeURIComponent(connectionId)}`;
}

function explorerHref(clientId: string): string {
  return withClientContext("/explorer", clientId);
}

function exportsHref(clientId: string): string {
  return withClientContext("/exports", clientId);
}

/** Most specific existing recovery destination for each readiness code. */
export function recoveryForCode(
  code: ReadinessCode,
  clientId: string,
  connectionId?: string,
): SetupRecovery {
  switch (code) {
    case "SOURCE_MISSING":
      return { href: sourcesHref(clientId), label: "Assign sources to this client" };
    case "SOURCE_DISCONNECTED":
    case "SOURCE_RECONNECT_REQUIRED":
    case "SOURCE_QUARANTINED":
      return connectionId
        ? { href: sourceHref(connectionId), label: "Review the affected source" }
        : { href: withClientContext("/sources", clientId), label: "Review sources" };
    case "SYNC_FAILED":
    case "SYNC_PARTIAL":
    case "DATA_STALE":
    case "REPORTING_WINDOW_INCOMPLETE":
      return { href: explorerHref(clientId), label: "Refresh this client's window" };
    case "CURRENCY_UNKNOWN":
    case "TIMEZONE_UNKNOWN":
    case "CURRENCY_CONFLICT":
    case "TIMEZONE_CONFLICT":
      return { href: clientSetupHref(clientId), label: "Open reporting setup" };
    case "DESTINATION_UNAVAILABLE":
    case "DESTINATION_STALE":
    case "DESTINATION_UNVERIFIED":
    case "DESTINATION_REQUIREMENTS_MISSING":
      return { href: exportsHref(clientId), label: "Review delivery destinations" };
    default:
      return { href: explorerHref(clientId), label: "Inspect this client's data" };
  }
}

export function deriveClientSetupState(input: DeriveClientSetupInput): SetupDerivation {
  const { workspaceId, clientId, clientName, role, canEdit } = input;
  const evaluation = input.evaluation;
  if (evaluation && (evaluation.workspaceId !== workspaceId || evaluation.clientId !== clientId)) {
    return { ok: false, reason: "scope-mismatch" };
  }

  const recoveryHref = clientSetupHref(clientId);
  const requiredProviders = [...new Set(input.requirements.providers)].sort();
  const requiredDestinations = [...new Set(input.requirements.destinations)].sort();
  const requirementsConfigured = Boolean(
    input.requirements.configuredAt && requiredProviders.length > 0 && requiredDestinations.length > 0,
  );
  // Mirrors the server generation precondition exactly
  // (POST /api/reports/blueprint → requirements_not_configured). No extra gates.
  const generationBlocked = !requirementsConfigured;

  const assignedForClient = input.discovered.filter((d) => d.assignedClientId === clientId);
  const providersWithConnection = new Set(
    input.discovered.flatMap((d) => (d.connectionIds.length > 0 ? [d.provider] : [])),
  );
  for (const account of input.configurationAccounts) {
    const match = input.discovered.find(
      (d) => d.connectionIds.includes(account.connectionId) || d.accountId === account.accountId,
    );
    if (match) providersWithConnection.add(match.provider);
  }

  const requirementsRecovery: SetupRecovery = { href: recoveryHref, label: "Open reporting setup" };
  const adminNote = canEdit ? null : "Only a workspace owner or admin can change these.";

  const providers: ProviderSetupState[] = requiredProviders.map((provider) => {
    const label = providerLabel(provider);
    const assigned = assignedForClient.filter((d) => d.provider === provider);
    const blueprintSupported = isBlueprintV1Supported(provider);
    const verificationNote = blueprintSupported
      ? ""
      : " Weekly Blueprint v1 does not currently verify this provider.";
    const discovery = (ACCOUNT_DISCOVERY_PROVIDERS as readonly string[]).includes(provider)
      ? ("account-picker" as const)
      : (CREDENTIAL_RESOLVED_PROVIDERS as readonly string[]).includes(provider)
        ? ("credential-resolved" as const)
        : ("unknown" as const);
    if (assigned.length > 0) {
      return {
        provider,
        label,
        state: "complete" as SetupStepState,
        detail: discovery === "credential-resolved"
          ? `Account setup complete. The shop resolves through the ${label} connection credentials.${verificationNote}`
          : `${assigned.length} assigned ${assigned.length === 1 ? "account" : "accounts"}.`,
        discovery,
        blueprintSupported,
        recovery: null,
      };
    }
    const hasConnection = providersWithConnection.has(provider);
    const detail = discovery === "credential-resolved"
      ? hasConnection
        ? `The shop resolves through the ${label} connection credentials — link it to this client in Sources.${verificationNote}`
        : `Connect ${label} in Sources first; the shop resolves through the connection credentials.${verificationNote}`
      : hasConnection
        ? `A ${label} connection exists but no account is assigned to this client yet.`
        : `No ${label} connection or assigned account was found for this client.`;
    return {
      provider,
      label,
      state: canEdit ? ("action-required" as SetupStepState) : ("waiting-for-admin" as SetupStepState),
      detail,
      discovery,
      blueprintSupported,
      recovery: { href: sourcesHref(clientId), label: `Assign a ${label} account in Sources` },
    };
  });
  const unsupportedRequiredProviders = requiredProviders.filter((provider) => !isBlueprintV1Supported(provider));

  const requirementsSection: SetupSectionState = requirementsConfigured
    ? {
      id: "requirements",
      title: "Reporting requirements",
      state: "complete",
      summary: `Required providers: ${requiredProviders.map(providerLabel).join(", ")}. Required destinations: ${requiredDestinations.join(", ")}.`,
      recovery: null,
    }
    : {
      id: "requirements",
      title: "Reporting requirements",
      state: canEdit ? "action-required" : "waiting-for-admin",
      summary: canEdit
        ? "Choose this client's required providers and destinations so readiness and Blueprint generation use explicit requirements."
        : `No explicit requirements yet. ${adminNote} Until then, readiness is inferred from assigned sources.`,
      recovery: canEdit ? requirementsRecovery : null,
    };

  const accountsSection: SetupSectionState = (() => {
    if (requiredProviders.length === 0) {
      return {
        id: "accounts" as const,
        title: "Provider accounts",
        state: "needs-attention" as SetupStepState,
        summary: assignedForClient.length > 0
          ? `${assignedForClient.length} assigned ${assignedForClient.length === 1 ? "account" : "accounts"} found, but required providers are not set yet.`
          : "Set required providers first, then assign each provider's account to this client.",
        recovery: canEdit ? requirementsRecovery : null,
      };
    }
    const missing = providers.filter((p) => p.state !== "complete");
    if (missing.length === 0) {
      return {
        id: "accounts" as const,
        title: "Provider accounts",
        state: "complete" as SetupStepState,
        summary: "Every required provider has an account assigned to this client.",
        recovery: null,
      };
    }
    return {
      id: "accounts" as const,
      title: "Provider accounts",
      state: canEdit ? ("action-required" as SetupStepState) : ("waiting-for-admin" as SetupStepState),
      summary: `Missing assignments: ${missing.map((p) => p.label).join(", ")}.`,
      recovery: { href: sourcesHref(clientId), label: "Assign accounts in Sources" },
    };
  })();

  const readinessStatus = evaluation?.status ?? "unevaluated";
  const dataStatus = evaluation?.dataStatus ?? "unevaluated";

  const dataSection: SetupSectionState = (() => {
    if (!evaluation) {
      return {
        id: "data" as const,
        title: "Reporting data",
        state: "needs-attention" as SetupStepState,
        summary: "Readiness has not been evaluated for this client yet. Connect, assign and import a reporting window first.",
        recovery: { href: explorerHref(clientId), label: "Open the data explorer" },
      };
    }
    const dataBlockers = evaluation.dataBlockers.filter((i) => isDataIssue(i.code));
    if (dataBlockers.length > 0) {
      const first = dataBlockers[0];
      return {
        id: "data" as const,
        title: "Reporting data",
        state: "action-required" as SetupStepState,
        summary: READINESS_MESSAGES[first.code],
        recovery: recoveryForCode(first.code, clientId, first.connectionId),
      };
    }
    const dataWarnings = evaluation.dataWarnings.filter((i) => isDataIssue(i.code));
    if (dataWarnings.length > 0) {
      const first = dataWarnings[0];
      return {
        id: "data" as const,
        title: "Reporting data",
        state: "needs-attention" as SetupStepState,
        summary: READINESS_MESSAGES[first.code],
        recovery: recoveryForCode(first.code, clientId, first.connectionId),
      };
    }
    return {
      id: "data" as const,
      title: "Reporting data",
      state: "complete" as SetupStepState,
      summary: "The required reporting window has complete, current data.",
      recovery: null,
    };
  })();

  const contextSection: SetupSectionState = (() => {
    const overrideCount = input.configurationAccounts.filter((a) => a.hasOverride).length;
    const overrideNote = overrideCount > 0 ? ` ${overrideCount} recorded account override${overrideCount === 1 ? "" : "s"}.` : "";
    if (!evaluation) {
      return {
        id: "context" as const,
        title: "Reporting context",
        state: "needs-attention" as SetupStepState,
        summary: `Currency and timezone are not verified yet.${overrideNote}`,
        recovery: requirementsConfigured ? null : requirementsRecovery,
      };
    }
    const issues = [...evaluation.dataBlockers, ...evaluation.dataWarnings];
    const unknown = issues.find((i) => UNKNOWN_CONTEXT_CODES.has(i.code) && (i.code === "CURRENCY_UNKNOWN" || i.code === "TIMEZONE_UNKNOWN"));
    if (unknown) {
      return {
        id: "context" as const,
        title: "Reporting context",
        state: "action-required" as SetupStepState,
        summary: `${READINESS_MESSAGES[unknown.code]}${overrideNote}`,
        recovery: recoveryForCode(unknown.code, clientId, unknown.connectionId),
      };
    }
    const conflict = issues.find((i) => CONFLICT_CONTEXT_CODES.has(i.code));
    if (conflict) {
      return {
        id: "context" as const,
        title: "Reporting context",
        state: "action-required" as SetupStepState,
        summary: `${READINESS_MESSAGES[conflict.code]}${overrideNote}`,
        recovery: recoveryForCode(conflict.code, clientId, conflict.connectionId),
      };
    }
    const mixed = issues.find((i) => i.code === "MIXED_CURRENCY");
    if (mixed) {
      return {
        id: "context" as const,
        title: "Reporting context",
        state: "needs-attention" as SetupStepState,
        summary: `${READINESS_MESSAGES.MIXED_CURRENCY}${overrideNote}`,
        recovery: null,
      };
    }
    if (evaluation.currencies.length === 1 && evaluation.timezones.length === 1) {
      return {
        id: "context" as const,
        title: "Reporting context",
        state: "complete" as SetupStepState,
        summary: `Verified: ${evaluation.currencies[0]} · ${evaluation.timezones[0]}.${overrideNote}`,
        recovery: null,
      };
    }
    return {
      id: "context" as const,
      title: "Reporting context",
      state: "needs-attention" as SetupStepState,
      summary: `Currency: ${evaluation.currencies.join(", ") || "unknown"} · Timezone: ${evaluation.timezones.join(", ") || "unknown"}.${overrideNote}`,
      recovery: requirementsConfigured ? null : requirementsRecovery,
    };
  })();

  const readinessSection: SetupSectionState = (() => {
    if (!evaluation) {
      return {
        id: "readiness" as const,
        title: "Readiness",
        state: "needs-attention" as SetupStepState,
        summary: "No readiness result for this client yet.",
        recovery: null,
      };
    }
    if (dataStatus === "READY") {
      return {
        id: "readiness" as const,
        title: "Readiness",
        state: "complete" as SetupStepState,
        summary: evaluation.status === "READY"
          ? "Saved evidence meets all readiness checks for this window."
          : "Data is ready for review. Only delivery evidence is still missing, which never blocks review or approval.",
        recovery: null,
      };
    }
    if (dataStatus === "WARNING" || dataStatus === "UNKNOWN") {
      const first = [...evaluation.dataBlockers, ...evaluation.dataWarnings].find((i) => isDataIssue(i.code));
      return {
        id: "readiness" as const,
        title: "Readiness",
        state: "needs-attention" as SetupStepState,
        summary: first ? READINESS_MESSAGES[first.code] : "Review the evidence before generating a report.",
        recovery: first ? recoveryForCode(first.code, clientId, first.connectionId) : null,
      };
    }
    const first = evaluation.dataBlockers.find((i) => isDataIssue(i.code)) ?? evaluation.dataBlockers[0];
    return {
      id: "readiness" as const,
      title: "Readiness",
      state: "action-required" as SetupStepState,
      summary: first ? READINESS_MESSAGES[first.code] : "Resolve the blocking issues before generating a report.",
      recovery: first ? recoveryForCode(first.code, clientId, first.connectionId) : null,
    };
  })();

  const deliverySection: SetupSectionState = (() => {
    if (requiredDestinations.length === 0) {
      return {
        id: "delivery" as const,
        title: "Delivery",
        state: "optional" as SetupStepState,
        summary: "No destination is required for this client. Delivery stays optional and never blocks review or approval.",
        recovery: null,
      };
    }
    if (!evaluation) {
      return {
        id: "delivery" as const,
        title: "Delivery",
        state: "optional" as SetupStepState,
        summary: `Required: ${requiredDestinations.join(", ")}. Delivery evidence appears after a retrieval and never blocks review or approval.`,
        recovery: null,
      };
    }
    const receipts = evaluation.destination.receipts ?? [];
    const missing = requiredDestinations.filter(
      (d) => !receipts.some((r) => r.destination === d && r.current),
    );
    if (missing.length === 0) {
      return {
        id: "delivery" as const,
        title: "Delivery",
        state: "complete" as SetupStepState,
        summary: `Current delivery evidence for: ${requiredDestinations.join(", ")}.`,
        recovery: null,
      };
    }
    return {
      id: "delivery" as const,
      title: "Delivery",
      state: "needs-attention" as SetupStepState,
      summary: `No current delivery evidence for: ${missing.join(", ")}. Missing delivery evidence never blocks data review or human approval.`,
      recovery: { href: exportsHref(clientId), label: "Review delivery destinations" },
    };
  })();

  const blockers: SetupBlockerView[] = evaluation
    ? [...evaluation.blockers, ...evaluation.warnings]
      .filter((item, index, all) => all.findIndex((o) => o.code === item.code && o.provider === item.provider && o.connectionId === item.connectionId) === index)
      .map((item) => ({
        code: item.code,
        provider: item.provider ?? null,
        message: READINESS_MESSAGES[item.code],
        recovery: recoveryForCode(item.code, clientId, item.connectionId),
      }))
    : [];

  return {
    ok: true,
    state: {
      workspaceId,
      clientId,
      clientName,
      role,
      canEdit,
      requirementsConfigured,
      generationBlocked,
      unsupportedRequiredProviders,
      readinessStatus,
      dataStatus,
      recoveryHref,
      sections: {
        requirements: requirementsSection,
        accounts: accountsSection,
        data: dataSection,
        context: contextSection,
        readiness: readinessSection,
        delivery: deliverySection,
      },
      providers,
      blockers,
    },
  };
}
