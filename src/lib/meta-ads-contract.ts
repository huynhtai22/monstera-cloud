/**
 * Client-safe contract definitions for Meta Marketing API.
 * Contains shared types, constants, and options.
 *
 * This module MUST NOT import Node built-ins, Prisma, server telemetry,
 * credentials, or server-only modules so it can be safely imported by client components.
 */

// ── OAuth types ──────────────────────────────────────────────────────────────

export interface MetaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number; // seconds — present on short-lived tokens
}

export interface MetaLongLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // ~5183944 seconds (~60 days)
}

export interface MetaTokenDebug {
  app_id: string;
  is_valid: boolean;
  expires_at?: number; // unix timestamp
  scopes: string[];
}

// ── Insights types ───────────────────────────────────────────────────────────

export type MetaInsightsLevel = 'account' | 'campaign' | 'adset' | 'ad';

export interface MetaInsightsParams {
  adAccountId: string;
  fields: string[];
  level: MetaInsightsLevel;
  datePreset?: string;           // last_7d, last_30d, last_month, etc.
  timeRange?: { since: string; until: string }; // YYYY-MM-DD
  timeIncrement?: number;        // 1 = daily, 7 = weekly
  breakdowns?: string[];         // age, gender, country, placement, device
  actionAttributionWindows?: string[];
  limit?: number;
  filtering?: Array<{ field: string; operator: string; value: unknown }>;
}

export type MetaReportMode = 'sync' | 'async';

export interface MetaReportRequest {
  connectionId: string;
  adAccountId: string;
  params: MetaInsightsParams;
  mode: MetaReportMode;
}

export interface MetaReportCacheIdentity {
  workspaceId: string;
  connectionId: string;
  provider: 'meta_ads';
  adAccountId: string;
}

export class MetaReportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaReportValidationError';
  }
}

export class MetaProviderOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaProviderOutputError';
  }
}

const META_INSIGHTS_LEVELS = new Set<MetaInsightsLevel>(['account', 'campaign', 'adset', 'ad']);
const RETIRED_VIEW_ATTRIBUTION_WINDOWS = new Set(['7d_view', '28d_view']);
const UNBOUNDED_DATE_PRESETS = new Set(['maximum', 'data_maximum', 'lifetime']);

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new MetaReportValidationError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeStringArray(
  value: unknown,
  name: string,
  fallback: readonly string[],
  options: { allowEmpty?: boolean } = {},
): string[] {
  const selected = value === undefined ? fallback : value;
  if (!Array.isArray(selected) || selected.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new MetaReportValidationError(`${name} must be an array of non-empty strings`);
  }
  const normalized = [...new Set(selected.map((item) => item.trim()))].sort();
  if (!options.allowEmpty && normalized.length === 0) {
    throw new MetaReportValidationError(`${name} must include at least one value`);
  }
  return normalized;
}

function normalizeIsoDate(value: unknown, name: string): string {
  const date = requireNonEmptyString(value, name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new MetaReportValidationError(`${name} must use YYYY-MM-DD`);
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new MetaReportValidationError(`${name} must be a valid calendar date`);
  }
  return date;
}

export function normalizeMetaAdAccountId(adAccountId: string): string {
  return adAccountId.replace(/^act_/, '');
}

/** Parse and canonicalize every request input that can change Meta report results. */
export function normalizeMetaReportRequest(body: unknown): MetaReportRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new MetaReportValidationError('Request body must be a JSON object');
  }
  const input = body as Record<string, unknown>;
  const connectionId = requireNonEmptyString(input.connectionId, 'connectionId');
  const adAccountId = normalizeMetaAdAccountId(requireNonEmptyString(input.adAccountId, 'adAccountId'));
  if (!adAccountId) {
    throw new MetaReportValidationError('adAccountId must include an account identifier');
  }

  const level = input.level === undefined ? 'campaign' : requireNonEmptyString(input.level, 'level');
  if (!META_INSIGHTS_LEVELS.has(level as MetaInsightsLevel)) {
    throw new MetaReportValidationError('level must be one of account, campaign, adset, or ad');
  }
  if (input.async !== undefined && typeof input.async !== 'boolean') {
    throw new MetaReportValidationError('async must be a boolean');
  }
  if (input.timeIncrement !== undefined &&
      (!Number.isInteger(input.timeIncrement) || (input.timeIncrement as number) < 1)) {
    throw new MetaReportValidationError('timeIncrement must be a positive integer');
  }

  let timeRange: MetaInsightsParams['timeRange'];
  if (input.timeRange !== undefined) {
    if (!input.timeRange || typeof input.timeRange !== 'object' || Array.isArray(input.timeRange)) {
      throw new MetaReportValidationError('timeRange must contain since and until dates');
    }
    const candidate = input.timeRange as Record<string, unknown>;
    const since = normalizeIsoDate(candidate.since, 'timeRange.since');
    const until = normalizeIsoDate(candidate.until, 'timeRange.until');
    if (since > until) {
      throw new MetaReportValidationError('timeRange.since must be on or before timeRange.until');
    }
    timeRange = { since, until };
  }

  const actionAttributionWindows = normalizeStringArray(
    input.actionAttributionWindows,
    'actionAttributionWindows',
    ['7d_click', '1d_view'],
    { allowEmpty: true },
  );
  const retiredWindows = actionAttributionWindows.filter((window) =>
    RETIRED_VIEW_ATTRIBUTION_WINDOWS.has(window),
  );
  if (retiredWindows.length) {
    throw new MetaReportValidationError(
      `Unsupported Meta attribution window(s): ${retiredWindows.join(', ')}. Use 1d_view or a supported click window.`,
    );
  }

  let datePreset: string | undefined;
  if (!timeRange) {
    datePreset = input.datePreset === undefined
      ? 'last_30d'
      : requireNonEmptyString(input.datePreset, 'datePreset');
  } else if (input.datePreset !== undefined) {
    requireNonEmptyString(input.datePreset, 'datePreset');
  }

  return {
    connectionId,
    adAccountId,
    mode: input.async === true ? 'async' : 'sync',
    params: {
      adAccountId,
      fields: normalizeStringArray(input.fields, 'fields', META_DEFAULT_FIELDS),
      level: level as MetaInsightsLevel,
      datePreset,
      timeRange,
      timeIncrement: input.timeIncrement === undefined ? 1 : input.timeIncrement as number,
      breakdowns: normalizeStringArray(input.breakdowns, 'breakdowns', [], { allowEmpty: true }),
      actionAttributionWindows,
    },
  };
}

function usesThirteenMonthLimitedData(params: MetaInsightsParams): boolean {
  const usesUniqueCountField = params.fields.some((field) =>
    field.startsWith('unique_') || field.includes('_unique_') || field.startsWith('cost_per_unique_'),
  );
  const usesHourlyBreakdown = (params.breakdowns ?? []).some((breakdown) =>
    breakdown.startsWith('hourly_stats_aggregated_by_'),
  );
  const usesReachWithBreakdowns = params.fields.includes('reach') && Boolean(params.breakdowns?.length);
  return usesUniqueCountField || usesHourlyBreakdown || usesReachWithBreakdowns;
}

/** Reject Meta combinations whose provider history is limited to the latest 13 months. */
export function validateMetaReportHistoricalAvailability(
  params: MetaInsightsParams,
  now: Date = new Date(),
): void {
  if (!usesThirteenMonthLimitedData(params)) return;

  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 13, now.getUTCDate()));
  const since = params.timeRange?.since;
  const requestsUnavailableHistory = since
    ? new Date(`${since}T00:00:00.000Z`) < cutoff
    : UNBOUNDED_DATE_PRESETS.has(params.datePreset ?? '');

  if (requestsUnavailableHistory) {
    throw new MetaReportValidationError(
      `This Meta query uses unique-count fields, reach with breakdowns, or hourly breakdowns, which are limited to 13 months. Use a since date on or after ${cutoff.toISOString().slice(0, 10)} or remove those fields/breakdowns.`,
    );
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

/** Versioned, canonical key for all identity and result-changing query dimensions. */
export function buildMetaReportCacheKey(
  identity: MetaReportCacheIdentity,
  params: MetaInsightsParams,
  mode: MetaReportMode,
): string {
  const canonical = {
    version: 1,
    identity: {
      workspaceId: identity.workspaceId,
      connectionId: identity.connectionId,
      provider: identity.provider,
      adAccountId: normalizeMetaAdAccountId(identity.adAccountId),
    },
    query: {
      fields: [...new Set(params.fields)].sort(),
      breakdowns: [...new Set(params.breakdowns ?? [])].sort(),
      actionAttributionWindows: [...new Set(params.actionAttributionWindows ?? [])].sort(),
      date: params.timeRange
        ? { type: 'range', since: params.timeRange.since, until: params.timeRange.until }
        : { type: 'preset', value: params.datePreset ?? '' },
      timeIncrement: params.timeIncrement ?? null,
      level: params.level,
      mode,
      limit: params.limit ?? null,
      filtering: [...(params.filtering ?? [])]
        .map((filter) => stableValue(filter))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    },
  };
  return JSON.stringify(canonical);
}

export interface MetaInsightsRow {
  [key: string]: string | number | MetaAction[] | undefined;
  date_start?: string;
  date_stop?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  cpm?: string;
  cpc?: string;
  ctr?: string;
  purchase_roas?: MetaAction[];
  actions?: MetaAction[];
  action_values?: MetaAction[];
}

export interface MetaAction {
  action_type: string;
  value: string;
  '7d_click'?: string;
  '1d_view'?: string;
}

export interface MetaAsyncReportStatus {
  id: string;
  account_id: string;
  async_status: 'Job Not Started' | 'Job Started' | 'Job Running' | 'Job Completed' | 'Job Failed' | 'Job Skipped';
  async_percent_completion: number;
  date_start?: string;
  date_stop?: string;
}

// ── Default metrics and breakdowns ──────────────────────────────────────────

export const META_DEFAULT_FIELDS = [
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
  'ad_id',
  'ad_name',
  'account_id',
  'spend',
  'impressions',
  'reach',
  'clicks',
  'cpm',
  'cpc',
  'ctr',
  'frequency',
  'purchase_roas',
  'actions',
  'action_values',
  'cost_per_action_type',
  'date_start',
  'date_stop',
];

export const META_BREAKDOWN_OPTIONS = [
  { value: 'age', label: 'Age' },
  { value: 'gender', label: 'Gender' },
  { value: 'country', label: 'Country' },
  { value: 'region', label: 'Region' },
  { value: 'device_platform', label: 'Device Platform' },
  { value: 'publisher_platform', label: 'Publisher Platform' },
  { value: 'platform_position', label: 'Placement' },
];

export const META_LEVEL_OPTIONS: Array<{ value: MetaInsightsLevel; label: string }> = [
  { value: 'campaign', label: 'Campaign' },
  { value: 'adset', label: 'Ad Set' },
  { value: 'ad', label: 'Ad' },
  { value: 'account', label: 'Account' },
];
