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
  readonly code: MetaReportValidationCode;

  constructor(code: MetaReportValidationCode, message = META_REPORT_VALIDATION_MESSAGES[code]) {
    super(message);
    this.name = 'MetaReportValidationError';
    this.code = code;
  }
}

export class MetaProviderOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaProviderOutputError';
  }
}

/**
 * The report endpoint intentionally exposes a small, documented subset of Ads
 * Insights rather than passing arbitrary Graph API identifiers through. Sources:
 * - https://developers.facebook.com/docs/marketing-api/insights/parameters/v25.0
 * - https://developers.facebook.com/docs/marketing-api/insights/breakdowns
 * Keep additions tied to one of those sources and add a contract test.
 */
const META_INSIGHTS_LEVELS = new Set<MetaInsightsLevel>(['account', 'campaign', 'adset', 'ad']);
const META_SUPPORTED_FIELDS = new Set([
  'account_id', 'account_name', 'account_currency',
  'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name',
  'buying_type', 'objective',
  'spend', 'impressions', 'reach', 'frequency', 'clicks', 'ctr', 'cpm', 'cpc', 'cpp',
  'actions', 'action_values', 'cost_per_action_type', 'cost_per_unique_action_type',
  'purchase_roas', 'website_purchase_roas',
  'inline_link_clicks', 'inline_link_click_ctr', 'cost_per_inline_link_click',
  'outbound_clicks', 'outbound_clicks_ctr', 'cost_per_outbound_click',
  'unique_actions', 'unique_clicks', 'unique_ctr', 'unique_outbound_clicks',
  'unique_outbound_clicks_ctr', 'date_start', 'date_stop',
]);
const META_SUPPORTED_BREAKDOWNS = new Set([
  'age', 'gender', 'country', 'region', 'device_platform', 'publisher_platform',
  'platform_position', 'hourly_stats_aggregated_by_advertiser_time_zone',
  'hourly_stats_aggregated_by_audience_time_zone',
]);
const META_SUPPORTED_ATTRIBUTION_WINDOWS = new Set(['1d_view', '1d_click', '7d_click', '28d_click']);
const RETIRED_VIEW_ATTRIBUTION_WINDOWS = new Set(['7d_view', '28d_view']);
const META_SUPPORTED_DATE_PRESETS = new Set([
  'today', 'yesterday', 'this_month', 'last_month', 'this_quarter', 'last_quarter',
  'this_year', 'last_year', 'last_3d', 'last_7d', 'last_14d', 'last_28d', 'last_30d',
  'last_60d', 'last_90d', 'last_365d', 'last_week_mon_sun', 'last_week_sun_sat',
  'maximum', 'data_maximum', 'lifetime',
]);
const UNBOUNDED_DATE_PRESETS = new Set(['maximum', 'data_maximum', 'lifetime']);
const THIRTEEN_MONTH_LIMITED_FIELDS = new Set(['unique_actions', 'cost_per_unique_action_type']);
const THIRTEEN_MONTH_LIMITED_BREAKDOWNS = new Set([
  'hourly_stats_aggregated_by_advertiser_time_zone',
  'hourly_stats_aggregated_by_audience_time_zone',
]);
const MAX_IDENTIFIER_LENGTH = 120;
const MAX_ARRAY_ITEMS = 50;

export const META_REPORT_VALIDATION_CODES = [
  'INVALID_REQUEST', 'INVALID_CONNECTION_ID', 'INVALID_AD_ACCOUNT_ID', 'INVALID_LEVEL',
  'INVALID_ASYNC_MODE', 'INVALID_TIME_INCREMENT', 'INVALID_DATE_RANGE',
  'UNSUPPORTED_DATE_PRESET', 'INVALID_FIELD', 'INVALID_BREAKDOWN',
  'INVALID_ATTRIBUTION_WINDOW', 'RETIRED_ATTRIBUTION_WINDOW',
  'UNSUPPORTED_LIMIT', 'UNSUPPORTED_FILTERING', 'HISTORICAL_DATA_UNAVAILABLE',
] as const;
export type MetaReportValidationCode = (typeof META_REPORT_VALIDATION_CODES)[number];

const META_REPORT_VALIDATION_MESSAGES: Record<MetaReportValidationCode, string> = {
  INVALID_REQUEST: 'Invalid Meta report request.',
  INVALID_CONNECTION_ID: 'connectionId must be a non-empty identifier.',
  INVALID_AD_ACCOUNT_ID: 'adAccountId must be a non-empty identifier.',
  INVALID_LEVEL: 'level must be account, campaign, adset, or ad.',
  INVALID_ASYNC_MODE: 'async must be a boolean.',
  INVALID_TIME_INCREMENT: 'timeIncrement must be a positive integer.',
  INVALID_DATE_RANGE: 'timeRange must be valid ISO calendar dates with since on or before until.',
  UNSUPPORTED_DATE_PRESET: 'datePreset is not supported for this Meta report.',
  INVALID_FIELD: 'One or more requested Meta fields are not supported.',
  INVALID_BREAKDOWN: 'One or more requested Meta breakdowns are not supported.',
  INVALID_ATTRIBUTION_WINDOW: 'One or more requested attribution windows are not supported.',
  RETIRED_ATTRIBUTION_WINDOW: 'A requested view-through attribution window is retired; use 1d_view instead.',
  UNSUPPORTED_LIMIT: 'limit is not supported by this Meta report endpoint.',
  UNSUPPORTED_FILTERING: 'filtering is not supported by this Meta report endpoint.',
  HISTORICAL_DATA_UNAVAILABLE: 'This Meta query requests data older than the supported 13-calendar-month history.',
};

function requireNonEmptyString(value: unknown, code: MetaReportValidationCode): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_IDENTIFIER_LENGTH) {
    throw new MetaReportValidationError(code);
  }
  return value.trim();
}

function normalizeStringArray(
  value: unknown,
  code: MetaReportValidationCode,
  fallback: readonly string[],
  options: { allowEmpty?: boolean } = {},
): string[] {
  const selected = value === undefined ? fallback : value;
  if (!Array.isArray(selected) || selected.length > MAX_ARRAY_ITEMS || selected.some((item) =>
    typeof item !== 'string' || !item.trim() || item.trim().length > MAX_IDENTIFIER_LENGTH,
  )) {
    throw new MetaReportValidationError(code);
  }
  const normalized = [...new Set(selected.map((item) => item.trim()))].sort();
  if (!options.allowEmpty && normalized.length === 0) {
    throw new MetaReportValidationError(code);
  }
  return normalized;
}

function normalizeIsoDate(value: unknown): string {
  const date = requireNonEmptyString(value, 'INVALID_DATE_RANGE');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new MetaReportValidationError('INVALID_DATE_RANGE');
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new MetaReportValidationError('INVALID_DATE_RANGE');
  }
  return date;
}

function ensureSupported(values: readonly string[], supported: ReadonlySet<string>, code: MetaReportValidationCode): void {
  if (values.some((value) => !supported.has(value))) throw new MetaReportValidationError(code);
}

export function normalizeMetaAdAccountId(adAccountId: string): string {
  return adAccountId.replace(/^act_/, '');
}

/** Parse and canonicalize every request input that can change Meta report results. */
export function normalizeMetaReportRequest(body: unknown): MetaReportRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new MetaReportValidationError('INVALID_REQUEST');
  }
  const input = body as Record<string, unknown>;
  const connectionId = requireNonEmptyString(input.connectionId, 'INVALID_CONNECTION_ID');
  const adAccountId = normalizeMetaAdAccountId(requireNonEmptyString(input.adAccountId, 'INVALID_AD_ACCOUNT_ID'));
  if (!adAccountId) {
    throw new MetaReportValidationError('INVALID_AD_ACCOUNT_ID');
  }

  const level = input.level === undefined ? 'campaign' : requireNonEmptyString(input.level, 'INVALID_LEVEL');
  if (!META_INSIGHTS_LEVELS.has(level as MetaInsightsLevel)) {
    throw new MetaReportValidationError('INVALID_LEVEL');
  }
  if (input.async !== undefined && typeof input.async !== 'boolean') {
    throw new MetaReportValidationError('INVALID_ASYNC_MODE');
  }
  if (input.timeIncrement !== undefined &&
      (!Number.isInteger(input.timeIncrement) || (input.timeIncrement as number) < 1)) {
    throw new MetaReportValidationError('INVALID_TIME_INCREMENT');
  }
  if (input.limit !== undefined) {
    throw new MetaReportValidationError('UNSUPPORTED_LIMIT');
  }
  if (input.filtering !== undefined) {
    throw new MetaReportValidationError('UNSUPPORTED_FILTERING');
  }

  let timeRange: MetaInsightsParams['timeRange'];
  if (input.timeRange !== undefined) {
    if (!input.timeRange || typeof input.timeRange !== 'object' || Array.isArray(input.timeRange)) {
      throw new MetaReportValidationError('INVALID_DATE_RANGE');
    }
    const candidate = input.timeRange as Record<string, unknown>;
    const since = normalizeIsoDate(candidate.since);
    const until = normalizeIsoDate(candidate.until);
    if (since > until) {
      throw new MetaReportValidationError('INVALID_DATE_RANGE');
    }
    timeRange = { since, until };
  }

  const actionAttributionWindows = normalizeStringArray(
    input.actionAttributionWindows,
    'INVALID_ATTRIBUTION_WINDOW',
    ['7d_click', '1d_view'],
    { allowEmpty: true },
  );
  const retiredWindows = actionAttributionWindows.filter((window) =>
    RETIRED_VIEW_ATTRIBUTION_WINDOWS.has(window),
  );
  if (retiredWindows.length) {
    throw new MetaReportValidationError('RETIRED_ATTRIBUTION_WINDOW');
  }
  ensureSupported(actionAttributionWindows, META_SUPPORTED_ATTRIBUTION_WINDOWS, 'INVALID_ATTRIBUTION_WINDOW');

  let datePreset: string | undefined;
  if (!timeRange) {
    datePreset = input.datePreset === undefined
      ? 'last_30d'
      : requireNonEmptyString(input.datePreset, 'UNSUPPORTED_DATE_PRESET');
    if (!META_SUPPORTED_DATE_PRESETS.has(datePreset)) {
      throw new MetaReportValidationError('UNSUPPORTED_DATE_PRESET');
    }
  } else if (input.datePreset !== undefined) {
    requireNonEmptyString(input.datePreset, 'UNSUPPORTED_DATE_PRESET');
  }

  const fields = normalizeStringArray(input.fields, 'INVALID_FIELD', META_DEFAULT_FIELDS);
  const breakdowns = normalizeStringArray(input.breakdowns, 'INVALID_BREAKDOWN', [], { allowEmpty: true });
  ensureSupported(fields, META_SUPPORTED_FIELDS, 'INVALID_FIELD');
  ensureSupported(breakdowns, META_SUPPORTED_BREAKDOWNS, 'INVALID_BREAKDOWN');

  return {
    connectionId,
    adAccountId,
    mode: input.async === true ? 'async' : 'sync',
    params: {
      adAccountId,
      fields,
      level: level as MetaInsightsLevel,
      datePreset,
      timeRange,
      timeIncrement: input.timeIncrement === undefined ? 1 : input.timeIncrement as number,
      breakdowns,
      actionAttributionWindows,
    },
  };
}

function usesThirteenMonthLimitedData(params: MetaInsightsParams): boolean {
  return params.fields.some((field) => THIRTEEN_MONTH_LIMITED_FIELDS.has(field)) ||
    (params.breakdowns ?? []).some((breakdown) => THIRTEEN_MONTH_LIMITED_BREAKDOWNS.has(breakdown));
}

function datePresetRequestsUnavailableHistory(datePreset: string | undefined, cutoff: Date, now: Date): boolean {
  if (!datePreset) return false;
  if (UNBOUNDED_DATE_PRESETS.has(datePreset)) return true;
  // `last_year` means the prior calendar year, not the last 365 days. Its
  // earliest date can fall outside a rolling 13-calendar-month window.
  if (datePreset === 'last_year') {
    return new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1)) < cutoff;
  }
  return false;
}

/** Subtract UTC calendar months without JavaScript's month-end rollover. */
export function subtractUtcCalendarMonthsClamped(now: Date, months: number): Date {
  const targetMonthIndex = now.getUTCFullYear() * 12 + now.getUTCMonth() - months;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    Math.min(now.getUTCDate(), lastDay),
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds(),
    now.getUTCMilliseconds(),
  ));
}

/** Reject Meta combinations whose provider history is limited to the latest 13 months. */
export function validateMetaReportHistoricalAvailability(
  params: MetaInsightsParams,
  now: Date = new Date(),
): void {
  if (!usesThirteenMonthLimitedData(params)) return;

  const cutoff = subtractUtcCalendarMonthsClamped(now, 13);
  const since = params.timeRange?.since;
  const requestsUnavailableHistory = since
    ? new Date(`${since}T00:00:00.000Z`) < cutoff
    : datePresetRequestsUnavailableHistory(params.datePreset, cutoff, now);

  if (requestsUnavailableHistory) {
    throw new MetaReportValidationError('HISTORICAL_DATA_UNAVAILABLE');
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
    version: 2,
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
      // Meta documents filtering as an ordered array. Canonicalize object keys only;
      // never reorder filter clauses without a provider guarantee of equivalence.
      filtering: (params.filtering ?? []).map((filter) => stableValue(filter)),
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
