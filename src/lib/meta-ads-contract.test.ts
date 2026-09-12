import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildMetaReportCacheKey,
  MetaReportValidationError,
  normalizeMetaReportRequest,
  validateMetaReportHistoricalAvailability,
} from './meta-ads-contract';

describe('Meta report query contract', () => {
  it('normalizes order-insensitive arrays and account prefixes to one cache key', () => {
    const left = normalizeMetaReportRequest({
      connectionId: ' conn-1 ',
      adAccountId: 'act_123',
      fields: ['spend', 'clicks', 'spend'],
      breakdowns: ['gender', 'age'],
      actionAttributionWindows: ['1d_view', '7d_click'],
      timeRange: { since: '2026-08-01', until: '2026-08-31' },
    });
    const right = normalizeMetaReportRequest({
      connectionId: 'conn-1',
      adAccountId: '123',
      fields: ['clicks', 'spend'],
      breakdowns: ['age', 'gender'],
      actionAttributionWindows: ['7d_click', '1d_view'],
      datePreset: 'last_90d',
      timeRange: { until: '2026-08-31', since: '2026-08-01' },
    });
    const identity = { workspaceId: 'ws-1', connectionId: 'conn-1', provider: 'meta_ads' as const, adAccountId: '123' };

    assert.deepEqual(left, right);
    assert.equal(
      buildMetaReportCacheKey(identity, left.params, left.mode),
      buildMetaReportCacheKey({ ...identity, adAccountId: 'act_123' }, right.params, right.mode),
    );
  });

  it('separates every result-changing query and identity dimension', () => {
    const base = normalizeMetaReportRequest({ connectionId: 'conn-1', adAccountId: '123' });
    const identity = { workspaceId: 'ws-1', connectionId: 'conn-1', provider: 'meta_ads' as const, adAccountId: '123' };
    const key = buildMetaReportCacheKey(identity, base.params, base.mode);
    const changedKeys = [
      buildMetaReportCacheKey({ ...identity, workspaceId: 'ws-2' }, base.params, base.mode),
      buildMetaReportCacheKey({ ...identity, connectionId: 'conn-2' }, base.params, base.mode),
      buildMetaReportCacheKey({ ...identity, adAccountId: '456' }, base.params, base.mode),
      buildMetaReportCacheKey(identity, { ...base.params, fields: ['spend'] }, base.mode),
      buildMetaReportCacheKey(identity, { ...base.params, breakdowns: ['age'] }, base.mode),
      buildMetaReportCacheKey(identity, { ...base.params, actionAttributionWindows: ['1d_click'] }, base.mode),
      buildMetaReportCacheKey(identity, { ...base.params, datePreset: 'last_7d' }, base.mode),
      buildMetaReportCacheKey(identity, { ...base.params, timeIncrement: 7 }, base.mode),
      buildMetaReportCacheKey(identity, { ...base.params, level: 'account' }, base.mode),
      buildMetaReportCacheKey(identity, base.params, 'async'),
    ];

    assert.equal(new Set([key, ...changedKeys]).size, changedKeys.length + 1);
  });

  it('does not collide semantically distinct supported attribution windows', () => {
    const oneDay = normalizeMetaReportRequest({
      connectionId: 'conn-1', adAccountId: '123', actionAttributionWindows: ['1d_click'],
    });
    const sevenDay = normalizeMetaReportRequest({
      connectionId: 'conn-1', adAccountId: '123', actionAttributionWindows: ['7d_click'],
    });
    const identity = { workspaceId: 'ws-1', connectionId: 'conn-1', provider: 'meta_ads' as const, adAccountId: '123' };

    assert.notEqual(
      buildMetaReportCacheKey(identity, oneDay.params, oneDay.mode),
      buildMetaReportCacheKey(identity, sevenDay.params, sevenDay.mode),
    );
  });

  it('rejects retired view attribution windows alone or in combinations', () => {
    for (const windows of [['7d_view'], ['1d_click', '28d_view'], ['7d_view', '28d_view']]) {
      assert.throws(
        () => normalizeMetaReportRequest({ connectionId: 'conn-1', adAccountId: '123', actionAttributionWindows: windows }),
        (error) => error instanceof MetaReportValidationError && /Unsupported Meta attribution/.test(error.message),
      );
    }
  });

  it('rejects unavailable history for unique fields, reach breakdowns, and hourly breakdowns', () => {
    const restrictedQueries = [
      { fields: ['unique_actions'] },
      { fields: ['reach'], breakdowns: ['country'] },
      { fields: ['spend'], breakdowns: ['hourly_stats_aggregated_by_advertiser_time_zone'] },
    ];

    for (const query of restrictedQueries) {
      const request = normalizeMetaReportRequest({
        connectionId: 'conn-1', adAccountId: '123', ...query,
        timeRange: { since: '2025-07-31', until: '2026-08-31' },
      });
      assert.throws(
        () => validateMetaReportHistoricalAvailability(request.params, new Date('2026-09-13T00:00:00Z')),
        (error) => error instanceof MetaReportValidationError && /limited to 13 months/.test(error.message),
      );
    }
  });

  it('preserves valid defaults and supported custom query behavior', () => {
    const defaults = normalizeMetaReportRequest({ connectionId: 'conn-1', adAccountId: 'act_123' });
    assert.equal(defaults.adAccountId, '123');
    assert.equal(defaults.params.level, 'campaign');
    assert.equal(defaults.params.datePreset, 'last_30d');
    assert.equal(defaults.params.timeIncrement, 1);
    assert.deepEqual(defaults.params.actionAttributionWindows, ['1d_view', '7d_click']);

    const custom = normalizeMetaReportRequest({
      connectionId: 'conn-1', adAccountId: '123', fields: ['spend'], level: 'ad',
      datePreset: 'last_7d', timeIncrement: 7, breakdowns: ['country'],
      actionAttributionWindows: ['28d_click'], async: true,
    });
    validateMetaReportHistoricalAvailability(custom.params, new Date('2026-09-13T00:00:00Z'));
    assert.equal(custom.mode, 'async');
    assert.equal(custom.params.datePreset, 'last_7d');
  });
});
