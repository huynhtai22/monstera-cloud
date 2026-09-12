import {
  PROVIDER_CAPABILITY_REGISTRY,
  PROVIDER_CAPABILITY_REGISTRY_VERSION,
} from "./registry";
import { CAPABILITY_REASON_CODES } from "./constants";
import {
  type CapabilityKind,
  type CapabilityLookup,
  type CapabilityRequest,
  type CapabilitySeverity,
  type CompatibilityEvaluation,
  type CompatibilityReason,
  type ProviderCapability,
} from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KNOWN_PROVIDERS: ReadonlySet<string> = new Set(
  PROVIDER_CAPABILITY_REGISTRY.map((item) => item.provider),
);
const KNOWN_SURFACES: ReadonlySet<string> = new Set(
  PROVIDER_CAPABILITY_REGISTRY.map((item) => `${item.provider}\u0000${item.reportSurface}`),
);

function parseIsoDate(value: string): Date | undefined {
  if (!ISO_DATE.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value
    ? undefined
    : parsed;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCapabilities(left: ProviderCapability, right: ProviderCapability): number {
  return (
    compareText(left.provider, right.provider) ||
    compareText(left.reportSurface, right.reportSurface) ||
    compareText(left.reportType, right.reportType) ||
    compareText(left.kind, right.kind) ||
    compareText(left.capabilityId, right.capabilityId) ||
    compareText(left.effectiveDate, right.effectiveDate) ||
    compareText(left.recordId, right.recordId)
  );
}

function freezeResult<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeResult(child);
    Object.freeze(value);
  }
  return value;
}

export function listProviderCapabilities(): readonly ProviderCapability[] {
  return freezeResult([...PROVIDER_CAPABILITY_REGISTRY].sort(compareCapabilities));
}

export function isCapabilityEffective(
  capability: ProviderCapability,
  asOf: string,
): boolean {
  const evaluationDate = parseIsoDate(asOf);
  const effectiveDate = parseIsoDate(capability.effectiveDate);
  return Boolean(evaluationDate && effectiveDate && effectiveDate <= evaluationDate);
}

export function lookupProviderCapability(
  lookup: CapabilityLookup,
): ProviderCapability | undefined {
  const matches = PROVIDER_CAPABILITY_REGISTRY.filter(
    (item) =>
      item.provider === lookup.provider &&
      item.reportSurface === lookup.reportSurface &&
      item.reportType === lookup.reportType &&
      item.kind === lookup.kind &&
      item.capabilityId === lookup.capabilityId &&
      (!lookup.asOf || isCapabilityEffective(item, lookup.asOf)),
  ).sort(compareCapabilities);

  return matches.at(-1);
}

function subtractLookback(
  evaluationDate: Date,
  limit: NonNullable<ProviderCapability["lookbackLimit"]>,
): Date {
  const result = new Date(evaluationDate);
  if (limit.unit === "day") {
    result.setUTCDate(result.getUTCDate() - limit.value);
    return result;
  }

  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - limit.value);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));
  return result;
}

function makeReason(input: {
  code: CompatibilityReason["code"];
  severity?: CapabilitySeverity;
  kind?: CapabilityKind;
  capabilityId?: string;
  affectedFields?: readonly string[];
  replacement?: readonly string[];
  operatorGuidance: string;
  sourceReference?: ProviderCapability["sourceReference"];
}): CompatibilityReason {
  return freezeResult({
    code: input.code,
    severity: input.severity ?? "error",
    kind: input.kind,
    capabilityId: input.capabilityId,
    affectedFields: [...(input.affectedFields ?? [])].sort(compareText),
    replacement: [...(input.replacement ?? [])].sort(compareText),
    operatorGuidance: input.operatorGuidance.replace(/[\u0000-\u001f\u007f]/g, " ").trim(),
    sourceReference: input.sourceReference,
  });
}

function requestedCapabilities(request: CapabilityRequest): Array<{
  kind: CapabilityKind;
  capabilityId: string;
}> {
  const requested: Array<{ kind: CapabilityKind; capabilityId: string }> = [
    { kind: "report", capabilityId: "standard_totals" },
    ...(request.fields ?? []).map((capabilityId) => ({ kind: "field" as const, capabilityId })),
    ...(request.breakdowns ?? []).map((capabilityId) => ({
      kind: "breakdown" as const,
      capabilityId,
    })),
    ...(request.attributionWindows ?? []).map((capabilityId) => ({
      kind: "attribution_window" as const,
      capabilityId,
    })),
  ];
  return [...new Map(requested.map((item) => [`${item.kind}\u0000${item.capabilityId}`, item])).values()].sort(
    (left, right) =>
      compareText(left.kind, right.kind) || compareText(left.capabilityId, right.capabilityId),
  );
}

function compareReasons(left: CompatibilityReason, right: CompatibilityReason): number {
  return (
    compareText(left.code, right.code) ||
    compareText(left.kind ?? "", right.kind ?? "") ||
    compareText(left.capabilityId ?? "", right.capabilityId ?? "") ||
    compareText(left.operatorGuidance, right.operatorGuidance)
  );
}

export function evaluateCapabilityRequest(
  request: CapabilityRequest,
): CompatibilityEvaluation {
  const reasons: CompatibilityReason[] = [];
  const since = parseIsoDate(request.since);
  const until = parseIsoDate(request.until);
  const asOf = parseIsoDate(request.asOf);

  if (!since || !until || !asOf || since > until || until > asOf) {
    reasons.push(
      makeReason({
        code: CAPABILITY_REASON_CODES.INVALID_DATE_RANGE,
        operatorGuidance:
          "Use valid UTC calendar dates with since on or before until and until on or before the evaluation date.",
      }),
    );
  }

  if (!KNOWN_PROVIDERS.has(request.provider)) {
    reasons.push(
      makeReason({
        code: CAPABILITY_REASON_CODES.UNKNOWN_PROVIDER,
        operatorGuidance:
          "This provider is not present in this registry version. Add a verified provider data module before evaluating its requests.",
      }),
    );
  } else if (!KNOWN_SURFACES.has(`${request.provider}\u0000${request.reportSurface}`)) {
    reasons.push(
      makeReason({
        code: CAPABILITY_REASON_CODES.UNKNOWN_REPORT_SURFACE,
        operatorGuidance:
          "This report surface is not present in this registry version. Add a verified report-surface record before using it.",
      }),
    );
  }

  if (
    reasons.some(
      (reason) =>
        reason.code === CAPABILITY_REASON_CODES.UNKNOWN_PROVIDER ||
        reason.code === CAPABILITY_REASON_CODES.UNKNOWN_REPORT_SURFACE,
    )
  ) {
    return buildEvaluation(reasons);
  }

  for (const requested of requestedCapabilities(request)) {
    const capability = lookupProviderCapability({
      provider: request.provider,
      reportSurface: request.reportSurface,
      reportType: request.reportType,
      kind: requested.kind,
      capabilityId: requested.capabilityId,
    });
    const affectedFields = requested.kind === "field" ? [requested.capabilityId] : [];

    if (!capability) {
      reasons.push(
        makeReason({
          code: CAPABILITY_REASON_CODES.UNKNOWN_CAPABILITY,
          kind: requested.kind,
          capabilityId: requested.capabilityId,
          affectedFields,
          operatorGuidance:
            "The requested capability has not been verified in this registry version. Verify it against an authoritative provider source before use.",
        }),
      );
      continue;
    }

    if (!isCapabilityEffective(capability, request.asOf)) continue;

    if (capability.lifecycle === "retired") {
      reasons.push(
        makeReason({
          code:
            capability.kind === "attribution_window"
              ? CAPABILITY_REASON_CODES.ATTRIBUTION_WINDOW_RETIRED
              : CAPABILITY_REASON_CODES.CAPABILITY_RETIRED,
          severity: capability.severity,
          kind: capability.kind,
          capabilityId: capability.capabilityId,
          affectedFields,
          replacement: capability.replacement,
          operatorGuidance: capability.operatorExplanation,
          sourceReference: capability.sourceReference,
        }),
      );
    }

    if (!capability.granularities.includes(request.granularity)) {
      reasons.push(
        makeReason({
          code: CAPABILITY_REASON_CODES.GRANULARITY_NOT_SUPPORTED,
          severity: capability.severity,
          kind: capability.kind,
          capabilityId: capability.capabilityId,
          affectedFields,
          replacement: capability.replacement,
          operatorGuidance:
            "The requested capability is unavailable at this report granularity. Change the report granularity or remove the capability.",
          sourceReference: capability.sourceReference,
        }),
      );
    }

    if (since && asOf && capability.lookbackLimit) {
      const earliest = subtractLookback(asOf, capability.lookbackLimit);
      if (since < earliest) {
        reasons.push(
          makeReason({
            code: CAPABILITY_REASON_CODES.LOOKBACK_LIMIT_EXCEEDED,
            severity: capability.severity,
            kind: capability.kind,
            capabilityId: capability.capabilityId,
            affectedFields,
            replacement: capability.replacement,
            operatorGuidance: capability.operatorExplanation,
            sourceReference: capability.sourceReference,
          }),
        );
      }
    }
  }

  return buildEvaluation(reasons);
}

function buildEvaluation(reasons: CompatibilityReason[]): CompatibilityEvaluation {
  const orderedReasons = reasons.sort(compareReasons);
  const affectedFields = [...new Set(orderedReasons.flatMap((reason) => reason.affectedFields))].sort(
    compareText,
  );
  return freezeResult({
    registryVersion: PROVIDER_CAPABILITY_REGISTRY_VERSION,
    compatible: orderedReasons.length === 0,
    reasons: orderedReasons,
    affectedFields,
  });
}
