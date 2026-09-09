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
