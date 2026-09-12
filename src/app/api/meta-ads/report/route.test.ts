import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { setAuthSessionOverride } from '@/lib/auth-session';
import { encrypt } from '@/lib/encryption';
import { metaReportClient } from '@/lib/meta-ads';
import type { MetaInsightsParams } from '@/lib/meta-ads-contract';
import prisma from '@/lib/prisma';
import { clearMetaReportCacheForTest, POST } from './route';

const session = {
  user: { id: 'meta-report-user', email: 'meta-report@example.test' },
  expires: new Date(Date.now() + 86_400_000).toISOString(),
};

describe('POST /api/meta-ads/report query integrity', () => {
  const originalFindFirst = prisma.connection.findFirst;
  const originalGetInsights = metaReportClient.getInsights;
  const originalCreateAsyncReport = metaReportClient.createAsyncReport;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    clearMetaReportCacheForTest();
    setAuthSessionOverride(async () => session);
  });

  afterEach(() => {
    clearMetaReportCacheForTest();
    setAuthSessionOverride(null);
    prisma.connection.findFirst = originalFindFirst;
    metaReportClient.getInsights = originalGetInsights;
    metaReportClient.createAsyncReport = originalCreateAsyncReport;
  });

  function installConnection() {
    prisma.connection.findFirst = (async () => ({
      id: 'conn-meta',
      workspaceId: 'ws-meta',
      provider: 'meta_ads',
      status: 'connected',
      workspace: { plan: 'professional' },
      credentials: encrypt(JSON.stringify({
        accessToken: 'test-token',
        expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      })),
    })) as any;
  }

  function request(body: Record<string, unknown>) {
    return new Request('http://localhost/api/meta-ads/report', {
      method: 'POST',
      body: JSON.stringify({ connectionId: 'conn-meta', adAccountId: 'act_123', ...body }),
    });
  }

  it('rejects retired attribution before database, token, or provider contact', async () => {
    let databaseCalls = 0;
    let providerCalls = 0;
    prisma.connection.findFirst = (async () => { databaseCalls++; return null; }) as typeof prisma.connection.findFirst;
    metaReportClient.getInsights = (async () => { providerCalls++; return [{ spend: '1' }]; }) as any;

    const response = await POST(request({ actionAttributionWindows: ['1d_click', '7d_view'] }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /7d_view/);
    assert.equal(databaseCalls, 0);
    assert.equal(providerCalls, 0);
  });

  it('rejects over-age restricted queries before token or provider contact', async () => {
    installConnection();
    let providerCalls = 0;
    metaReportClient.getInsights = (async () => { providerCalls++; return [{ spend: '1' }]; }) as any;

    const response = await POST(request({
      fields: ['unique_actions'],
      timeRange: { since: '2020-01-01', until: '2020-01-31' },
    }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /limited to 13 months/);
    assert.equal(providerCalls, 0);
  });

  it('shares a cache entry for normalized arrays and account IDs', async () => {
    installConnection();
    let providerCalls = 0;
    metaReportClient.getInsights = (async (_token: string, params: MetaInsightsParams) => {
      providerCalls++;
      assert.equal(params.adAccountId, '123');
      return [{ spend: '10' }];
    }) as any;

    const first = await POST(request({
      fields: ['spend', 'clicks'], breakdowns: ['gender', 'age'],
      actionAttributionWindows: ['7d_click', '1d_view'],
    }));
    const second = await POST(new Request('http://localhost/api/meta-ads/report', {
      method: 'POST',
      body: JSON.stringify({
        connectionId: 'conn-meta', adAccountId: '123', fields: ['clicks', 'spend'],
        breakdowns: ['age', 'gender'], actionAttributionWindows: ['1d_view', '7d_click'],
      }),
    }));

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await second.json()).cached, true);
    assert.equal(providerCalls, 1);
  });

  it('keeps distinct attribution and execution modes out of the same cache entry', async () => {
    installConnection();
    let syncCalls = 0;
    let asyncCalls = 0;
    metaReportClient.getInsights = (async () => { syncCalls++; return [{ spend: '10' }]; }) as any;
    metaReportClient.createAsyncReport = (async () => { asyncCalls++; return 'run-1'; }) as any;

    const oneDay = await POST(request({ actionAttributionWindows: ['1d_click'] }));
    const sevenDay = await POST(request({ actionAttributionWindows: ['7d_click'] }));
    const asyncResponse = await POST(request({ actionAttributionWindows: ['7d_click'], async: true }));

    assert.deepEqual([oneDay.status, sevenDay.status, asyncResponse.status], [200, 200, 200]);
    assert.equal(syncCalls, 2);
    assert.equal(asyncCalls, 1);
  });

  it('supports valid defaults and reports empty provider output as upstream failure', async () => {
    installConnection();
    let captured: unknown;
    metaReportClient.getInsights = (async (_token: string, params: MetaInsightsParams) => {
      captured = params;
      return [{ spend: '10' }];
    }) as any;

    const valid = await POST(request({}));
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { mode: 'sync', rows: [{ spend: '10' }] });
    assert.equal((captured as { level: string }).level, 'campaign');

    clearMetaReportCacheForTest();
    metaReportClient.getInsights = (async () => []) as any;
    const empty = await POST(request({ fields: ['unsupported_metric'] }));
    assert.equal(empty.status, 502);
    assert.match((await empty.json()).error, /no report rows/);
  });
});
