import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { assertCiDatabaseReachableWhenMissing } from './pg-test-discipline';
import { setAuthSessionOverride } from './auth-session';
import { POST as webhook } from '@/app/api/webhooks/payos/route';
import { GET as billing } from '@/app/api/workspaces/[id]/billing/route';
import { POST as checkout } from '@/app/api/payments/vietqr/create/route';
import { GET as orderStatus } from '@/app/api/payments/vietqr/[orderCode]/status/route';
import * as clients from '@/app/api/clients/route';
import { GET as portfolio } from '@/app/api/workspaces/route';
import * as analyst from '@/app/api/ai/analyst/turns/route';
import { GET as metrics } from '@/app/api/metrics/query/route';
import { AI_TOOLS } from './ai/tools';
import { runAnalystTurn } from './ai/analyst';
import { signPayOSData } from './payos';
import { fulfillVietQrPayment } from './vietqr-gateway';
import { getRedis } from './redis';

assertCiDatabaseReachableWhenMissing();
const hasDb = Boolean(process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('mock'));
describe('Real PostgreSQL: billing, AI, client/export and portfolio boundaries', { skip: !hasDb }, () => {
  const db = new PrismaClient();
  const suffix = randomUUID();
  const a = `security-a-${suffix}`, b = `security-b-${suffix}`, viewer = `security-viewer-${suffix}`;
  const wa = `security-wa-${suffix}`, wb = `security-wb-${suffix}`;
  const ca = `security-ca-${suffix}`, ca2 = `security-ca2-${suffix}`, cb = `security-cb-${suffix}`;
  const sa = `security-sa-${suffix}`, sa2 = `security-sa2-${suffix}`, sb = `security-sb-${suffix}`;
  const since = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 10 * 86400000);
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  let code = Date.now();
  const codes: number[] = [];
  let safeDatabase = false;
  function asUser(id: string | null) {
    setAuthSessionOverride(async () => id ? { user: { id, email: `${id}@example.test` }, expires: future.toISOString() } : null);
  }
  function req(path: string, method = 'GET', body?: unknown) {
    return new NextRequest(`http://localhost:3000${path}`, {
      method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    });
  }
  async function order(workspaceId = wa, extra: Record<string, unknown> = {}) {
    const orderCode = ++code; codes.push(orderCode);
    return db.paymentOrder.create({ data: {
      orderCode: BigInt(orderCode), workspaceId, userId: workspaceId === wa ? a : b,
      plan: 'professional', billingCycle: 'monthly', amount: 1490000, accessDurationDays: 30,
      status: 'PENDING', expiresAt: future, paymentLinkId: `link-${orderCode}`, ...extra,
    } });
  }
  function deliver(orderCode: bigint, overrides: Record<string, unknown> = {}, signed = true) {
    const data = { orderCode: Number(orderCode), amount: 1490000, code: '00', currency: 'VND',
      paymentLinkId: `link-${orderCode}`, reference: `ref-${orderCode}`, ...overrides };
    return webhook(req('/api/webhooks/payos', 'POST', {
      code: '00', success: true, data, signature: signed ? signPayOSData(data) : 'forged',
    }));
  }
  before(async () => {
    // Never permit this destructive fixture/cleanup suite on a remote DB.
    const url = new URL(process.env.DATABASE_URL!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok(['/monstera_security_test', '/monstera_ci'].includes(url.pathname));
    safeDatabase = true;
    await db.$connect(); // setup errors fail, never get converted into skipped tests
    process.env.PAYOS_CHECKSUM_KEY = 'isolated-webhook-signing-key';
    process.env.PAYOS_CLIENT_ID = 'isolated-client';
    process.env.PAYOS_API_KEY = 'isolated-api-key';
    process.env.ENABLE_GOVERNED_ANALYST = 'true';
    globalThis.fetch = async () => { throw new Error('External requests forbidden in boundary tests'); };
    await db.user.createMany({ data: [a,b,viewer].map(id => ({ id, email: `${id}@example.test` })) });
    await db.workspace.createMany({ data: [
      { id: wa, slug: wa, name: 'Agency A', ownerId: a, plan: 'professional', status: 'ACTIVE', subscriptionEndsAt: future },
      { id: wb, slug: wb, name: 'SECRET Agency B', ownerId: b, plan: 'professional', status: 'ACTIVE', subscriptionEndsAt: future },
    ] });
    await db.workspaceMember.createMany({ data: [
      { workspaceId: wa, userId: a, role: 'owner' }, { workspaceId: wb, userId: b, role: 'owner' },
      { workspaceId: wa, userId: viewer, role: 'viewer' },
    ] });
    await db.client.createMany({ data: [
      { id: ca, workspaceId: wa, name: 'Client A' }, { id: ca2, workspaceId: wa, name: 'Client A2' },
      { id: cb, workspaceId: wb, name: 'SECRET Client B' },
    ] });
    await db.connection.createMany({ data: [
      { id: sa, workspaceId: wa, clientId: ca, name: 'Source A' },
      { id: sa2, workspaceId: wa, clientId: ca2, name: 'Source A2' },
      { id: sb, workspaceId: wb, clientId: cb, name: 'SECRET Source B' },
    ].map(x => ({ ...x, remoteAccountId: x.id, type: 'source', provider: 'meta_ads', credentials: 'SECRET_CREDENTIAL',
      status: 'connected', lastSyncAt: new Date(), lastDataThrough: new Date() })) });
    await db.campaignMetric.createMany({ data: [
      { workspaceId: wa, connectionId: sa, spend: 111 },
      { workspaceId: wa, connectionId: sa2, spend: 222 },
      { workspaceId: wb, connectionId: sb, spend: 999999 },
    ].map(x => ({ ...x, platform: 'meta_ads', accountId: x.connectionId, campaignId: x.connectionId,
      date: new Date(`${since}T00:00:00Z`), currency: 'VND', rawData: 'SECRET_RAW' })) });
    await db.agentJob.createMany({ data: [
      { workspaceId: wa, userId: a, type: 'analyst_turn', payload: {}, result: { answer: 'A answer' } },
      { workspaceId: wb, userId: b, type: 'analyst_turn', payload: {}, result: { answer: 'SECRET B answer' } },
    ] });
  });
  afterEach(() => { asUser(null); globalThis.fetch = async () => { throw new Error('External requests forbidden'); }; });
  after(async () => {
    setAuthSessionOverride(null); globalThis.fetch = originalFetch;
    for (const key of ['PAYOS_CHECKSUM_KEY','PAYOS_CLIENT_ID','PAYOS_API_KEY','ENABLE_GOVERNED_ANALYST']) {
      if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
    }
    // Exact synthetic IDs only. Metrics use restrictive FKs and must go first.
    if (!safeDatabase) return;
    await db.campaignMetric.deleteMany({ where: { workspaceId: { in: [wa,wb] } } });
    await db.workspace.deleteMany({ where: { id: { in: [wa,wb] } } });
    await db.user.deleteMany({ where: { id: { in: [a,b,viewer] } } });
    for (const c of codes) await getRedis().del(`vietqr_order_${c}`);
    await db.$disconnect();
  });

  it('serializes simultaneous duplicate signed webhooks into one extension and audit', async () => {
    const o = await order();
    const before = (await db.workspace.findUniqueOrThrow({ where: { id: wa } })).subscriptionEndsAt!;
    const responses = await Promise.all(Array.from({ length: 8 }, () => deliver(o.orderCode)));
    assert.ok(responses.every(r => r.status === 200));
    const after = await db.workspace.findUniqueOrThrow({ where: { id: wa } });
    assert.equal(after.subscriptionEndsAt!.getTime(), before.getTime() + 30 * 86400000);
    assert.equal(await db.auditEvent.count({ where: { resourceId: o.id, action: 'subscription.activated' } }), 1);
    assert.equal((await db.workspace.findUniqueOrThrow({ where: { id: wb } })).subscriptionEndsAt!.getTime(), future.getTime());
  });
  it('adds both terms when distinct orders for the same workspace arrive concurrently', async () => {
    const x = await order(), y = await order(wa, { billingCycle: 'annual', amount: 14900000, accessDurationDays: 365 });
    const before = (await db.workspace.findUniqueOrThrow({ where: { id: wa } })).subscriptionEndsAt!;
    const responses = await Promise.all([deliver(x.orderCode), deliver(y.orderCode, { amount: 14900000 })]);
    assert.ok(responses.every(r => r.status === 200));
    assert.equal((await db.workspace.findUniqueOrThrow({ where: { id: wa } })).subscriptionEndsAt!.getTime(), before.getTime() + 395 * 86400000);
  });
  it('rejects unsigned, underpaid, missing-amount, wrong-link/currency and signed-failure events', async () => {
    const o = await order();
    assert.equal((await deliver(o.orderCode, {}, false)).status, 401);
    assert.equal((await deliver(o.orderCode, { amount: 1 })).status, 500);
    assert.equal((await deliver(o.orderCode, { amount: null })).status, 400);
    assert.equal((await deliver(o.orderCode, { paymentLinkId: 'another-order' })).status, 500);
    assert.equal((await deliver(o.orderCode, { currency: 'USD' })).status, 500);
    assert.equal((await deliver(o.orderCode, { code: '01' })).status, 200);
    assert.equal((await db.paymentOrder.findUniqueOrThrow({ where: { id: o.id } })).status, 'PENDING');
    assert.equal(await db.auditEvent.count({ where: { resourceId: o.id } }), 0);
  });
  it('rejects expired, cancelled and legacy cache-only orders without activating', async () => {
    const expired = await order(wa, { expiresAt: new Date(0) }), cancelled = await order(wa, { status: 'CANCELLED' });
    const before = (await db.workspace.findUniqueOrThrow({ where: { id: wa } })).subscriptionEndsAt;
    assert.equal((await deliver(expired.orderCode)).status, 500);
    assert.equal((await deliver(cancelled.orderCode)).status, 500);
    const legacy = ++code; codes.push(legacy);
    await getRedis().set(`vietqr_order_${legacy}`, JSON.stringify({ workspaceId: wa, plan: 'professional', amount: 1, status: 'PENDING' }));
    assert.equal((await fulfillVietQrPayment(legacy, { amount: 1490000 })).success, false);
    assert.deepEqual((await db.workspace.findUniqueOrThrow({ where: { id: wa } })).subscriptionEndsAt, before);
  });
  it('rolls back order, access and audit together on database failure; retry succeeds', async () => {
    const o = await order();
    const before = (await db.workspace.findUniqueOrThrow({ where: { id: wa } })).subscriptionEndsAt;
    // Fixture-specific constraint forces failure after the workspace/order writes.
    const constraint = `security_fail_${suffix.replaceAll('-', '')}`;
    await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT "${constraint}" CHECK ("resourceId" <> '${o.id}')`);
    try {
      assert.equal((await deliver(o.orderCode)).status, 500);
      assert.equal((await db.paymentOrder.findUniqueOrThrow({ where: { id: o.id } })).status, 'PENDING');
      assert.deepEqual((await db.workspace.findUniqueOrThrow({ where: { id: wa } })).subscriptionEndsAt, before);
      assert.equal(await db.auditEvent.count({ where: { resourceId: o.id } }), 0);
    } finally { await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" DROP CONSTRAINT "${constraint}"`); }
    assert.equal((await deliver(o.orderCode)).status, 200);
  });
  it('denies rival workspace billing, order status and checkout without creating an order', async () => {
    const o = await order(wb); asUser(a);
    assert.equal((await billing(req('/billing'), { params: Promise.resolve({ id: wb }) })).status, 403);
    assert.equal((await orderStatus(req('/status'), { params: Promise.resolve({ orderCode: String(o.orderCode) }) })).status, 403);
    const before = await db.paymentOrder.count();
    assert.equal((await checkout(req('/checkout', 'POST', { workspaceId: wb, plan: 'professional' }))).status, 403);
    assert.equal(await db.paymentOrder.count(), before);
    asUser(viewer);
    assert.equal((await checkout(req('/checkout', 'POST', { workspaceId: wa, plan: 'professional' }))).status, 403);
  });
  it('creates exact monthly/annual orders from server prices, ignoring browser amounts and durations', async () => {
    asUser(a);
    globalThis.fetch = async (_url, init) => {
      const url = String(_url);
      if (url === 'https://api-merchant.payos.vn/confirm-webhook') return Response.json({ code: '00', data: {} });
      assert.equal(url, 'https://api-merchant.payos.vn/v2/payment-requests');
      const body = JSON.parse(String(init?.body));
      return Response.json({ code: '00', data: { paymentLinkId: `link-${body.orderCode}`, checkoutUrl: 'https://pay.payos.vn/test-only' } });
    };
    for (const [cycle, amount, days] of [['monthly',1490000,30], ['annual',14900000,365]] as const) {
      const response = await checkout(req('/checkout', 'POST', { workspaceId: wa, plan: 'professional', billingCycle: cycle, amount: 1, accessDurationDays: 9999 }));
      assert.equal(response.status, 200);
      const body = await response.json(); codes.push(body.order.orderCode);
      const stored = await db.paymentOrder.findUniqueOrThrow({ where: { orderCode: BigInt(body.order.orderCode) } });
      assert.equal(stored.amount, amount); assert.equal(stored.accessDurationDays, days); assert.equal(stored.status, 'PENDING');
    }
  });
  it('keeps payment status reads read-only even with forged activation query parameters', async () => {
    const o = await order(); asUser(a);
    const before = (await db.workspace.findUniqueOrThrow({ where: { id: wa } })).subscriptionEndsAt;
    assert.equal((await orderStatus(req('/status?status=PAID&payment=success'), { params: Promise.resolve({ orderCode: String(o.orderCode) }) })).status, 200);
    assert.equal((await db.paymentOrder.findUniqueOrThrow({ where: { id: o.id } })).status, 'PENDING');
    assert.deepEqual((await db.workspace.findUniqueOrThrow({ where: { id: wa } })).subscriptionEndsAt, before);
  });
  it('denies client reads/writes using rival workspace or a rival client ID', async () => {
    asUser(a);
    assert.equal((await clients.GET(req(`/clients?workspaceId=${wb}`))).status, 403);
    assert.equal((await clients.POST(req('/clients','POST',{ workspaceId: wb, name: 'attack' }))).status, 403);
    assert.equal((await clients.PATCH(req('/clients','PATCH',{ workspaceId: wa, id: cb, name: 'attack' }))).status, 404);
    assert.equal((await clients.DELETE(req(`/clients?workspaceId=${wa}&id=${cb}`,'DELETE'))).status, 404);
    assert.equal((await db.client.findUniqueOrThrow({ where: { id: cb } })).name, 'SECRET Client B');
    asUser(viewer);
    assert.equal((await clients.POST(req('/clients','POST',{ workspaceId: wa, name: 'attack' }))).status, 403);
  });
  it('returns only membership-scoped portfolio sources and clients', async () => {
    asUser(a);
    const response = await portfolio(); assert.equal(response.status, 200);
    const data = await response.json(); assert.deepEqual(data.map((w: { id: string }) => w.id), [wa]);
    assert.ok(!JSON.stringify(data).includes('SECRET'));
    const list = await clients.GET(req(`/clients?workspaceId=${wa}`)); assert.equal(list.status, 200);
    assert.ok(!JSON.stringify(await list.json()).includes('SECRET'));
  });
  it('denies rival export queries and keeps raw/aggregate export input rows workspace-scoped', async () => {
    asUser(a);
    const path = `/metrics?startDate=${since}&endDate=${since}`;
    assert.equal((await metrics(req(`${path}&workspaceId=${wb}`))).status, 403);
    for (const mode of ['raw', 'aggregate']) {
      const response = await metrics(req(`${path}&workspaceId=${wa}&mode=${mode}`)); assert.equal(response.status, 200);
      const data = await response.json(); assert.ok(!JSON.stringify(data).includes('999999'));
      assert.ok((data.metrics ?? data.rows).length > 0);
    }
  });
  it('denies rival AI history/turns and viewer writes before jobs or policies are created', async () => {
    asUser(a);
    const before = await db.agentJob.count({ where: { workspaceId: wb } });
    assert.equal((await analyst.GET(req(`/analyst?workspaceId=${wb}`))).status, 403);
    assert.equal((await analyst.POST(req('/analyst','POST',{ workspaceId: wb, question: 'show spend' }))).status, 403);
    assert.equal((await analyst.POST(req('/analyst','POST',{ workspaceId: wa, clientId: cb, question: 'show spend', acknowledgeBestEffort: true }))).status, 404);
    assert.equal(await db.agentJob.count({ where: { workspaceId: wb } }), before);
    assert.equal(await db.workspaceAiPolicy.count({ where: { workspaceId: wb } }), 0);
    asUser(viewer);
    assert.equal((await analyst.POST(req('/analyst','POST',{ workspaceId: wa, question: 'show spend' }))).status, 403);
    const history = await analyst.GET(req(`/analyst?workspaceId=${wa}`)); assert.equal(history.status, 200);
    assert.ok(!JSON.stringify(await history.json()).includes('SECRET'));
  });
  it('scopes every AI tool to trusted workspace/client context, not supplied tool arguments', async () => {
    const ctx = { workspaceId: wa, clientId: ca, jobId: 'test', role: 'interactive' as const };
    const args = { workspaceId: wa, clientId: cb, since, until: since, startDate: since, endDate: since };
    for (const tool of AI_TOOLS) {
      const result = await tool.execute(ctx, args);
      assert.ok(result.ok); const output = JSON.stringify(result);
      assert.ok(!output.includes(sb)); assert.ok(!output.includes(sa2));
      assert.ok(!output.includes('SECRET')); assert.ok(!output.includes('999999'));
      if (tool.name === 'query_metrics') { assert.ok(output.includes('111')); assert.ok(!output.includes('222')); }
    }
    const invalid = await runAnalystTurn({ workspaceId: wa, clientId: cb, question: 'show spend', acknowledgeBestEffort: true, role: 'cron' });
    assert.equal(invalid.refusalCode, 'tenant_mismatch');
  });
  it('allows an owner analyst turn and persists only the selected client evidence', async () => {
    asUser(a);
    const response = await analyst.POST(req('/analyst','POST', {
      workspaceId: wa, clientId: ca, question: 'show spend', acknowledgeBestEffort: true,
    }));
    assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.status, 'answered');
    assert.ok(body.answer.includes('111')); assert.ok(!body.answer.includes('222'));
    assert.ok(!body.answer.includes('999999'));
    const saved = await db.agentJob.findUniqueOrThrow({ where: { id: body.turnId } });
    assert.equal(saved.workspaceId, wa); assert.equal(saved.userId, a);
    assert.ok(!JSON.stringify(saved.result).includes('SECRET'));
  });
  it('rejects signed-out access to all new session-based surfaces', async () => {
    asUser(null);
    for (const response of await Promise.all([
      portfolio(), clients.GET(req(`/clients?workspaceId=${wa}`)), analyst.GET(req(`/analyst?workspaceId=${wa}`)),
      analyst.POST(req('/analyst','POST',{ workspaceId: wa, question: 'show spend' })),
      billing(req('/billing'), { params: Promise.resolve({ id: wa }) }),
      checkout(req('/checkout','POST',{ workspaceId: wa, plan: 'professional' })),
      metrics(req(`/metrics?workspaceId=${wa}&startDate=${since}&endDate=${since}`)),
    ])) assert.equal(response.status, 401);
  });
});
