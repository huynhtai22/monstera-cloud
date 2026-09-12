import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildMetaReportCacheKey,
  MetaReportValidationError,
  normalizeMetaReportRequest,
  subtractUtcCalendarMonthsClamped,
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
      buildMetaReportCacheKey(identity, { ...base.params, limit: 10 }, base.mode),
      buildMetaReportCacheKey(identity, {
        ...base.params,
        filtering: [{ field: 'campaign.name', operator: 'CONTAIN', value: 'Spring' }],
      }, base.mode),
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

  it('rejects unknown and retired attribution windows with stable reason codes', () => {
    for (const [windows, code] of [
      [['7d_view'], 'RETIRED_ATTRIBUTION_WINDOW'],
      [['1d_click', '28d_view'], 'RETIRED_ATTRIBUTION_WINDOW'],
      [['7d_view', '28d_view'], 'RETIRED_ATTRIBUTION_WINDOW'],
      [['future_window'], 'INVALID_ATTRIBUTION_WINDOW'],
    ] as const) {
      assert.throws(
        () => normalizeMetaReportRequest({ connectionId: 'conn-1', adAccountId: '123', actionAttributionWindows: windows }),
        (error) => error instanceof MetaReportValidationError && error.code === code,
      );
    }
  });

  it('rejects unknown fields and breakdowns instead of passing them to Meta', () => {
    for (const body of [
      { fields: ['not_a_meta_field'] },
      { breakdowns: ['not_a_meta_breakdown'] },
    ]) {
      assert.throws(
        () => normalizeMetaReportRequest({ connectionId: 'conn-1', adAccountId: '123', ...body }),
        (error) => error instanceof MetaReportValidationError &&
          ['INVALID_FIELD', 'INVALID_BREAKDOWN'].includes(error.code),
      );
    }
  });

  it('rejects unavailable history for every documented restricted field and hourly breakdown', () => {
    const restrictedQueries = [
      { fields: ['unique_actions'] },
      { fields: ['cost_per_unique_action_type'] },
      { fields: ['spend'], breakdowns: ['hourly_stats_aggregated_by_advertiser_time_zone'] },
      { fields: ['spend'], breakdowns: ['hourly_stats_aggregated_by_audience_time_zone'] },
    ];

    for (const query of restrictedQueries) {
      const request = normalizeMetaReportRequest({
        connectionId: 'conn-1', adAccountId: '123', ...query,
        timeRange: { since: '2025-07-31', until: '2026-08-31' },
      });
      assert.throws(
        () => validateMetaReportHistoricalAvailability(request.params, new Date('2026-09-13T00:00:00Z')),
        (error) => error instanceof MetaReportValidationError && error.code === 'HISTORICAL_DATA_UNAVAILABLE',
      );
    }
  });

  it('subtracts UTC calendar months without rolling month-end into the following month', () => {
    assert.equal(
      subtractUtcCalendarMonthsClamped(new Date('2026-03-31T12:34:56.789Z'), 13).toISOString(),
      '2025-02-28T12:34:56.789Z',
    );
    assert.equal(
      subtractUtcCalendarMonthsClamped(new Date('2025-03-31T00:00:00.000Z'), 13).toISOString(),
      '2024-02-29T00:00:00.000Z',
    );
  });

  it('enforces the exact clamped cutoff for explicit ranges and unbounded presets', () => {
    const now = new Date('2026-03-31T00:00:00.000Z');
    const base = { connectionId: 'conn-1', adAccountId: '123', fields: ['unique_actions'] };
    for (const [since, shouldReject] of [
      ['2025-02-27', true],
      ['2025-02-28', false],
      ['2025-03-01', false],
    ] as const) {
      const request = normalizeMetaReportRequest({ ...base, timeRange: { since, until: '2026-03-31' } });
      if (shouldReject) {
        assert.throws(() => validateMetaReportHistoricalAvailability(request.params, now));
      } else {
        assert.doesNotThrow(() => validateMetaReportHistoricalAvailability(request.params, now));
      }
    }
    const maximum = normalizeMetaReportRequest({ ...base, datePreset: 'maximum' });
    assert.throws(
      () => validateMetaReportHistoricalAvailability(maximum.params, now),
      (error) => error instanceof MetaReportValidationError && error.code === 'HISTORICAL_DATA_UNAVAILABLE',
    );
    const recent = normalizeMetaReportRequest({ ...base, datePreset: 'last_365d' });
    assert.doesNotThrow(() => validateMetaReportHistoricalAvailability(recent.params, now));
    const priorCalendarYear = normalizeMetaReportRequest({ ...base, datePreset: 'last_year' });
    assert.throws(
      () => validateMetaReportHistoricalAvailability(priorCalendarYear.params, new Date('2026-09-13T00:00:00.000Z')),
      (error) => error instanceof MetaReportValidationError && error.code === 'HISTORICAL_DATA_UNAVAILABLE',
    );
  });

  it('preserves filtering clause order while canonicalizing filter object properties', () => {
    const base = normalizeMetaReportRequest({ connectionId: 'conn-1', adAccountId: '123' });
    const identity = { workspaceId: 'ws-1', connectionId: 'conn-1', provider: 'meta_ads' as const, adAccountId: '123' };
    const first = [{ field: 'campaign.name', operator: 'CONTAIN', value: 'Spring' }, { field: 'spend', operator: 'GREATER_THAN', value: 1 }];
    const reversed = [...first].reverse();
    const reorderedProperties = [{ value: 'Spring', operator: 'CONTAIN', field: 'campaign.name' }, first[1]];
    assert.notEqual(
      buildMetaReportCacheKey(identity, { ...base.params, filtering: first }, base.mode),
      buildMetaReportCacheKey(identity, { ...base.params, filtering: reversed }, base.mode),
    );
    assert.equal(
      buildMetaReportCacheKey(identity, { ...base.params, filtering: first }, base.mode),
      buildMetaReportCacheKey(identity, { ...base.params, filtering: reorderedProperties }, base.mode),
    );
  });

  it('rejects endpoint inputs that would otherwise be accepted but ignored', () => {
    for (const body of [{ limit: 10 }, { filtering: [] }]) {
      assert.throws(
        () => normalizeMetaReportRequest({ connectionId: 'conn-1', adAccountId: '123', ...body }),
        (error) => error instanceof MetaReportValidationError &&
          ['UNSUPPORTED_LIMIT', 'UNSUPPORTED_FILTERING'].includes(error.code),
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

  it('uses bounded static validation guidance for attacker-controlled inputs', () => {
    assert.throws(
      () => normalizeMetaReportRequest({ connectionId: 'conn-1', adAccountId: '123', fields: ['x'.repeat(10_000)] }),
      (error) => error instanceof MetaReportValidationError &&
        error.code === 'INVALID_FIELD' && error.message.length < 160 && !error.message.includes('xxxxx'),
    );
  });
});
