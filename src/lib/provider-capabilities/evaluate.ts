import {
  PROVIDER_CAPABILITY_REGISTRY,
  PROVIDER_CAPABILITY_REGISTRY_VERSION,
} from "./registry";
import { CAPABILITY_REASON_CODES } from "./constants";
import {
  type AttributionRestriction,
  type CapabilityEvaluationOptions,
  type CapabilityKind,
  type CapabilityLookup,
  type CapabilityReasonCode,
  type CapabilityRegistry,
  type CapabilityRequest,
  type CapabilitySeverity,
  type CompatibilityEvaluation,
  type CompatibilityReason,
  type ProviderCapability,
  type ProviderCapabilityRegistryApi,
} from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_GUIDANCE_LENGTH = 280;
const VALID_KINDS = new Set<CapabilityKind>([
  "report",
  "field",
  "breakdown",
  "attribution_window",
]);
const VALID_LIFECYCLES = new Set<ProviderCapability["lifecycle"]>([
  "active",
  "deprecated",
  "restricted",
  "retired",
]);
const VALID_SEVERITIES = new Set<CapabilitySeverity>(["info", "warning", "error"]);
const VALID_GRANULARITIES = new Set(["account", "campaign", "adset", "ad"]);

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

function cloneRecord(record: ProviderCapability): ProviderCapability {
  return {
    ...record,
    replacement: record.replacement ? [...record.replacement] : undefined,
    lookbackLimit: record.lookbackLimit ? { ...record.lookbackLimit } : undefined,
    granularities: [...record.granularities],
    attributionRestrictions: record.attributionRestrictions.map((restriction) => ({
      ...restriction,
      allowedWindows: restriction.allowedWindows ? [...restriction.allowedWindows] : undefined,
      unavailableWindows: restriction.unavailableWindows
        ? [...restriction.unavailableWindows]
        : undefined,
      forbiddenCombinations: restriction.forbiddenCombinations
        ? restriction.forbiddenCombinations.map((combination) => [...combination])
        : undefined,
    })),
    sourceReference: { ...record.sourceReference },
  };
}

function assertRegistryRecord(record: ProviderCapability): void {
  if (
    !record ||
    typeof record !== "object" ||
    !record.recordId ||
    !record.provider ||
    !record.reportSurface ||
    !record.reportType ||
    !record.capabilityId ||
    !VALID_KINDS.has(record.kind) ||
    !VALID_LIFECYCLES.has(record.lifecycle) ||
    !VALID_SEVERITIES.has(record.severity) ||
    !parseIsoDate(record.effectiveDate) ||
    (record.identifierMatch !== undefined &&
      record.identifierMatch !== "exact" &&
      record.identifierMatch !== "prefix") ||
    (record.identifierMatch === "prefix" && record.capabilityId.length === 0) ||
    !Array.isArray(record.granularities) ||
    !record.granularities.every((granularity) => VALID_GRANULARITIES.has(granularity)) ||
    !Array.isArray(record.attributionRestrictions) ||
    !record.sourceReference ||
    !record.sourceReference.title ||
    !record.sourceReference.url ||
    !record.sourceReference.evidence
  ) {
    throw new TypeError("Invalid provider capability registry record.");
  }
}

/**
 * Creates a client-safe policy API from caller-owned data. Its defensive copy
 * prevents a caller, a second registry, or this module from changing another
 * registry's outcome.
 */
export function createProviderCapabilityRegistry(
  input: CapabilityRegistry,
): ProviderCapabilityRegistryApi {
  if (!Array.isArray(input)) {
    throw new TypeError("A provider capability registry must be an array.");
  }
  input.forEach(assertRegistryRecord);
  const registry = freezeResult(input.map(cloneRecord).sort(compareCapabilities));

  return freezeResult({
    list: () => freezeResult(registry.map(cloneRecord)),
    lookup: (lookup) => lookupProviderCapability(lookup, { registry }),
    evaluate: (request) => evaluateCapabilityRequest(request, { registry }),
    evaluateAttributionWindows: (request) =>
      evaluateAttributionWindows(request, { registry }),
  });
}

function resolveRegistry(options?: CapabilityEvaluationOptions): CapabilityRegistry {
  if (!options?.registry) return PROVIDER_CAPABILITY_REGISTRY;
  return createProviderCapabilityRegistry(options.registry).list();
}

export function listProviderCapabilities(
  options?: CapabilityEvaluationOptions,
): readonly ProviderCapability[] {
  return freezeResult(resolveRegistry(options).map(cloneRecord).sort(compareCapabilities));
}

export function isCapabilityEffective(capability: ProviderCapability, asOf: string): boolean {
  const evaluationDate = parseIsoDate(asOf);
  const effectiveDate = parseIsoDate(capability.effectiveDate);
  return Boolean(evaluationDate && effectiveDate && effectiveDate <= evaluationDate);
}

function identifierMatches(capability: ProviderCapability, capabilityId: string): boolean {
  return capability.identifierMatch === "prefix"
    ? capabilityId.startsWith(capability.capabilityId)
    : capability.capabilityId === capabilityId;
}

function compareApplicableCapabilities(
  left: ProviderCapability,
  right: ProviderCapability,
  capabilityId: string,
): number {
  const leftExact = left.identifierMatch !== "prefix" && left.capabilityId === capabilityId;
  const rightExact = right.identifierMatch !== "prefix" && right.capabilityId === capabilityId;
  return (
    Number(rightExact) - Number(leftExact) ||
    compareText(right.effectiveDate, left.effectiveDate) ||
    compareText(right.recordId, left.recordId)
  );
}

/**
 * Performs effective-date filtering before choosing a rule. Exact identifiers
 * win over declared prefix families; ties use latest effective date and then
 * record ID, so selection does not depend on input array order.
 */
export function lookupProviderCapability(
  lookup: CapabilityLookup,
  options?: CapabilityEvaluationOptions,
): ProviderCapability | undefined {
  const asOf = lookup.asOf;
  const registry = resolveRegistry(options);
  const matches = registry
    .filter(
      (item) =>
        item.provider === lookup.provider &&
        item.reportSurface === lookup.reportSurface &&
        item.reportType === lookup.reportType &&
        item.kind === lookup.kind &&
        identifierMatches(item, lookup.capabilityId) &&
        (!asOf || isCapabilityEffective(item, asOf)),
    )
    .sort((left, right) => compareApplicableCapabilities(left, right, lookup.capabilityId));

  return matches[0] ? freezeResult(cloneRecord(matches[0])) : undefined;
}

function hasMatchingCapability(
  registry: CapabilityRegistry,
  lookup: CapabilityLookup,
): boolean {
  return registry.some(
    (item) =>
      item.provider === lookup.provider &&
      item.reportSurface === lookup.reportSurface &&
      item.reportType === lookup.reportType &&
      item.kind === lookup.kind &&
      identifierMatches(item, lookup.capabilityId),
  );
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

function sanitizeGuidance(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_GUIDANCE_LENGTH);
}

function makeReason(input: {
  code: CapabilityReasonCode;
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
    operatorGuidance: sanitizeGuidance(input.operatorGuidance),
    sourceReference: input.sourceReference ? { ...input.sourceReference } : undefined,
  });
}

function requestedCapabilities(request: CapabilityRequest): Array<{
  kind: Exclude<CapabilityKind, "attribution_window">;
  capabilityId: string;
}> {
  const requested: Array<{
    kind: Exclude<CapabilityKind, "attribution_window">;
    capabilityId: string;
  }> = [
    { kind: "report", capabilityId: "standard_totals" },
    ...(request.fields ?? []).map((capabilityId) => ({ kind: "field" as const, capabilityId })),
    ...(request.breakdowns ?? []).map((capabilityId) => ({
      kind: "breakdown" as const,
      capabilityId,
    })),
  ];
  return [
    ...new Map(requested.map((item) => [`${item.kind}\u0000${item.capabilityId}`, item])).values(),
  ].sort(
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

function reportRestrictions(
  registry: CapabilityRegistry,
  request: CapabilityRequest,
): Array<{ restriction: AttributionRestriction; capability: ProviderCapability }> {
  return registry
    .filter(
      (capability) =>
        capability.provider === request.provider &&
        capability.reportSurface === request.reportSurface &&
        capability.reportType === request.reportType &&
        capability.kind === "report" &&
        isCapabilityEffective(capability, request.asOf),
    )
    .flatMap((capability) =>
      capability.attributionRestrictions.map((restriction) => ({ restriction, capability })),
    );
}

/** Evaluates attribution windows independently so callers can present advisory findings. */
export function evaluateAttributionWindows(
  request: CapabilityRequest,
  options?: CapabilityEvaluationOptions,
): readonly CompatibilityReason[] {
  const registry = resolveRegistry(options);
  const selected = [...new Set(request.attributionWindows ?? [])].sort(compareText);
  if (selected.length === 0) return freezeResult([]);

  const restrictions = reportRestrictions(registry, request);
  if (restrictions.length === 0) {
    return freezeResult(
      selected.map((capabilityId) =>
        makeReason({
          code: CAPABILITY_REASON_CODES.UNKNOWN_ATTRIBUTION_WINDOW,
          kind: "attribution_window",
          capabilityId,
          operatorGuidance:
            "No verified attribution-window policy exists for this report surface in this registry version.",
        }),
      ),
    );
  }

  const allowed = new Set<string>();
  const unavailable = new Map<string, { restriction: AttributionRestriction; capability: ProviderCapability }>();
  const forbidden: Array<{
    combination: readonly string[];
    restriction: AttributionRestriction;
    capability: ProviderCapability;
  }> = [];
  for (const entry of restrictions) {
    for (const window of entry.restriction.allowedWindows ?? []) allowed.add(window);
    for (const window of entry.restriction.unavailableWindows ?? []) {
      unavailable.set(window, entry);
    }
    for (const combination of entry.restriction.forbiddenCombinations ?? []) {
      forbidden.push({ combination, ...entry });
    }
  }

  const reasons: CompatibilityReason[] = [];
  for (const capabilityId of selected) {
    const unavailableEntry = unavailable.get(capabilityId);
    if (unavailableEntry) {
      reasons.push(
        makeReason({
          code: CAPABILITY_REASON_CODES.ATTRIBUTION_WINDOW_RETIRED,
          severity: unavailableEntry.capability.severity,
          kind: "attribution_window",
          capabilityId,
          replacement: unavailableEntry.restriction.allowedWindows,
          operatorGuidance: unavailableEntry.restriction.explanation,
          sourceReference: unavailableEntry.capability.sourceReference,
        }),
      );
    } else if (allowed.size > 0 && !allowed.has(capabilityId)) {
      reasons.push(
        makeReason({
          code: CAPABILITY_REASON_CODES.UNKNOWN_ATTRIBUTION_WINDOW,
          kind: "attribution_window",
          capabilityId,
          operatorGuidance:
            "This attribution window is not verified for this report surface in this registry version.",
        }),
      );
    }
  }
  for (const entry of forbidden) {
    if (entry.combination.every((window) => selected.includes(window))) {
      reasons.push(
        makeReason({
          code: CAPABILITY_REASON_CODES.ATTRIBUTION_WINDOW_FORBIDDEN_COMBINATION,
          severity: entry.capability.severity,
          kind: "attribution_window",
          operatorGuidance: entry.restriction.explanation,
          sourceReference: entry.capability.sourceReference,
        }),
      );
    }
  }
  return freezeResult(reasons.sort(compareReasons));
}

export function getAffectedFields(
  findings: readonly CompatibilityReason[],
): readonly string[] {
  return freezeResult([...new Set(findings.flatMap((reason) => reason.affectedFields))].sort(compareText));
}

export function evaluateCapabilityRequest(
  request: CapabilityRequest,
  options?: CapabilityEvaluationOptions,
): CompatibilityEvaluation {
  const registry = resolveRegistry(options);
  const reasons: CompatibilityReason[] = [];
  const since = parseIsoDate(request.since);
  const until = parseIsoDate(request.until);
  const asOf = parseIsoDate(request.asOf);
  const knownProviders = new Set(registry.map((item) => item.provider));
  const knownSurfaces = new Set(registry.map((item) => `${item.provider}\u0000${item.reportSurface}`));

  if (!since || !until || !asOf || since > until || until > asOf) {
    reasons.push(
      makeReason({
        code: CAPABILITY_REASON_CODES.INVALID_DATE_RANGE,
        operatorGuidance:
          "Use valid UTC calendar dates with since on or before until and until on or before the evaluation date.",
      }),
    );
  }

  if (!knownProviders.has(request.provider)) {
    reasons.push(
      makeReason({
        code: CAPABILITY_REASON_CODES.UNKNOWN_PROVIDER,
        operatorGuidance:
          "This provider is not present in this registry version. Add a verified provider data module before evaluating its requests.",
      }),
    );
  } else if (!knownSurfaces.has(`${request.provider}\u0000${request.reportSurface}`)) {
    reasons.push(
      makeReason({
        code: CAPABILITY_REASON_CODES.UNKNOWN_REPORT_SURFACE,
        operatorGuidance:
          "This report surface is not present in this registry version. Add a verified report-surface record before using it.",
      }),
    );
  }

  if (reasons.some((reason) => reason.code === CAPABILITY_REASON_CODES.UNKNOWN_PROVIDER || reason.code === CAPABILITY_REASON_CODES.UNKNOWN_REPORT_SURFACE)) {
    return buildEvaluation(reasons, registry);
  }

  for (const requested of requestedCapabilities(request)) {
    const lookup = {
      provider: request.provider,
      reportSurface: request.reportSurface,
      reportType: request.reportType,
      kind: requested.kind,
      capabilityId: requested.capabilityId,
      asOf: request.asOf,
    };
    const capability = lookupProviderCapability(lookup, { registry });
    const affectedFields = requested.kind === "field" ? [requested.capabilityId] : [];

    // A lifecycle record that begins in the future is not an unknown identifier.
    if (!capability && !hasMatchingCapability(registry, lookup)) {
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
    if (!capability) continue;

    if (capability.lifecycle === "retired") {
      reasons.push(
        makeReason({
          code: CAPABILITY_REASON_CODES.CAPABILITY_RETIRED,
          severity: capability.severity,
          kind: capability.kind,
          capabilityId: requested.capabilityId,
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
          capabilityId: requested.capabilityId,
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
            capabilityId: requested.capabilityId,
            affectedFields,
            replacement: capability.replacement,
            operatorGuidance: capability.operatorExplanation,
            sourceReference: capability.sourceReference,
          }),
        );
      }
    }
  }

  reasons.push(...evaluateAttributionWindows(request, { registry }));
  return buildEvaluation(reasons, registry);
}

function buildEvaluation(
  findings: CompatibilityReason[],
  registry: CapabilityRegistry,
): CompatibilityEvaluation {
  const orderedFindings = findings.sort(compareReasons);
  return freezeResult({
    registryVersion:
      registry[0]?.registryVersion ?? PROVIDER_CAPABILITY_REGISTRY_VERSION,
    compatible: !orderedFindings.some((finding) => finding.severity === "error"),
    findings: orderedFindings,
    reasons: orderedFindings,
    affectedFields: getAffectedFields(orderedFindings),
  });
}
