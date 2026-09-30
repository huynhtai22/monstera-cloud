import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, beforeEach, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { encrypt } from "@/lib/encryption";
import { googleAdsReportClient } from "@/lib/google-ads";
import { syncConnectionData } from "@/lib/sync-connection";
import { shopeeDataClient, shopeeAdsClient } from "@/lib/shopee";
import { metaAdsClient } from "@/lib/meta-ads";
import { tiktokBusinessClient } from "@/lib/tiktok-business";
import { setAuthSessionOverride } from "@/lib/auth-session";
import { NextRequest } from "next/server";
import { GET as callback } from "@/app/api/auth/callback/route";
import { createOAuthAttempt, consumeOAuthAttempt } from "@/lib/oauth-attempt";
import { AgentError } from "./contracts";
import { createOrResumeOnboardingRun, getAgentRun, setAgentRunPaused, continueDeferredOnboarding } from "./runs";
import { createProviderTask, attachTaskConnections } from "./tasks";
import { discoverTaskAccounts, confirmTaskScopeAndEnqueueImport, reconcileTaskImportOutcome, reconcileRunImports, finishOnboardingRun, getTaskDataPreview, validateAgentOAuthTask, reopenTaskImportChoice, restoreDeferredImport, retryFailedTaskAccounts, reuseTaskConnection } from "./execution";
import { transitionAgentTask } from "./tasks";
import { initialImportWindow, OfferedScopeSchema, ConfirmedScopeSchema } from "./execution-contracts";
import { assertCiDatabaseReachableWhenMissing } from "@/lib/pg-test-discipline";

describe("M3 TikTok: real PostgreSQL execution boundaries", () => {
  const db = new PrismaClient();
  const suffix = randomUUID();
  const userId = `m3-${suffix}`, peerId = `m3-peer-${suffix}`, workspaceId = `m3-w-${suffix}`, otherWorkspaceId = `m3-other-${suffix}`, connectionId = `m3-c-${suffix}`;
  const scope = { userId, workspaceId };
  const originalGoogleDiscovery = googleAdsReportClient.listCustomerClients;
  const originalShopDiscovery = shopeeDataClient.getShopInfo;
  const originalMetaDiscovery = metaAdsClient.getAdAccounts;
  const originalDiscovery = tiktokBusinessClient.listAuthorizedAdvertisers;
  const oldFlag = process.env.ENABLE_AGENT_ONBOARDING;
  const oldTikTok = process.env.TIKTOK_BUSINESS_CONNECT_ENABLED;
  const errorCode = (code: string) => (error: unknown) => error instanceof AgentError && error.code === code;
  let runId = "", taskId = "";
  const task = () => db.agentTask.findUniqueOrThrow({ where: { id: taskId } });
  const jobs = () => db.warehouseImportJob.count({ where: { workspaceId } });
  const requestInput = (version: number, ids = ["1001"]) => ({ expectedVersion: version, selectedAccountIds: ids, ...initialImportWindow() });
  async function prepare() {
    const current = await task();
    const linked = await attachTaskConnections(scope, taskId, [connectionId], current.version);
    return discoverTaskAccounts(scope, taskId, linked.version);
  }
  async function confirm(ids = ["1001"]) {
    const prepared = await prepare();
    return confirmTaskScopeAndEnqueueImport(scope, taskId, requestInput(prepared.version, ids));
  }
  async function row(accountId = "1001", currency = "USD", entityId = randomUUID()) {
    return db.campaignMetric.create({ data: { workspaceId, connectionId, platform: "tiktok_business", accountId, level: "campaign", entityId, campaignId: entityId, date: new Date(`${initialImportWindow().until}T00:00:00Z`), spend: 2.5, conversions: 1, currency } });
  }
  async function outcome(status = "completed", ids = ["1001"], rows = 1) {
    const current = await task();
    await db.warehouseImportJob.update({ where: { id: current.importJobId! }, data: { status, approximateRows: rows, completedItems: ids.length, finishedAt: new Date(), results: ids.map(accountId => ({ connectionId, provider: "tiktok_business", accountId, ok: status === "completed", rowsIngested: rows })) } });
    return reconcileTaskImportOutcome(scope, taskId);
  }
  before(async () => {
    assertCiDatabaseReachableWhenMissing(); await db.$connect();
    for (const id of [userId, peerId]) await db.user.create({ data: { id, email: `${id}@example.test` } });
    for (const id of [workspaceId, otherWorkspaceId]) {
      await db.workspace.create({ data: { id, name: "M3 execution fixture", slug: id, ownerId: userId, plan: "professional" } });
      await db.workspaceMember.create({ data: { workspaceId: id, userId, role: "owner" } });
      await db.workspaceProviderAccess.create({ data: { workspaceId: id, provider: "tiktok_business", enabled: true } });
    }
    await db.workspaceMember.create({ data: { workspaceId, userId: peerId, role: "member" } });
    await db.connection.create({ data: { id: connectionId, workspaceId, name: "Synthetic TikTok", provider: "tiktok_business", type: "source", status: "connected", remoteAccountId: "9999", credentials: encrypt(JSON.stringify({ accessToken: "synthetic-local-only", advertiserIds: ["1001", "1002"] })) } });
  });
  beforeEach(async () => {
    await db.agentRun.deleteMany({ where: { workspaceId } });
    await db.warehouseImportJob.deleteMany({ where: { workspaceId } });
    await db.campaignMetric.deleteMany({ where: { workspaceId } });
    await db.auditEvent.deleteMany({ where: { workspaceId } });
    await db.workspaceMember.updateMany({ where: { workspaceId, userId }, data: { role: "owner" } });
    await db.workspace.update({ where: { id: workspaceId }, data: { plan: "professional" } });
    await db.workspaceProviderAccess.updateMany({ where: { workspaceId }, data: { enabled: true } });
    process.env.ENABLE_AGENT_ONBOARDING = "1"; process.env.TIKTOK_BUSINESS_CONNECT_ENABLED = "1";
    tiktokBusinessClient.listAuthorizedAdvertisers = async () => ({ advertiser_ids: ["1001", "1002"] });
    setAuthSessionOverride(async () => ({ user: { id: userId }, expires: "2099-01-01" }));
    const { run } = await createOrResumeOnboardingRun(userId, { kind: "onboarding", workspaceId }); runId = run.id;
    const created = await createProviderTask(scope, runId, "tiktok_business", run.version); taskId = created.id;
  });
  after(async () => {
    googleAdsReportClient.listCustomerClients = originalGoogleDiscovery;
    shopeeDataClient.getShopInfo = originalShopDiscovery;
    metaAdsClient.getAdAccounts = originalMetaDiscovery;
    tiktokBusinessClient.listAuthorizedAdvertisers = originalDiscovery; setAuthSessionOverride(null);
    if (oldFlag === undefined) delete process.env.ENABLE_AGENT_ONBOARDING; else process.env.ENABLE_AGENT_ONBOARDING = oldFlag;
    if (oldTikTok === undefined) delete process.env.TIKTOK_BUSINESS_CONNECT_ENABLED; else process.env.TIKTOK_BUSINESS_CONNECT_ENABLED = oldTikTok;
    await db.agentRun.deleteMany({ where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } } });
    await db.warehouseImportJob.deleteMany({ where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } } });
    await db.campaignMetric.deleteMany({ where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } } });
    await db.connection.deleteMany({ where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } } });
    await db.workspace.deleteMany({ where: { id: { in: [workspaceId, otherWorkspaceId] } } });
    await db.user.deleteMany({ where: { id: { in: [userId, peerId] } } }); await db.$disconnect();
  });
  it("continues only deferred sources exactly once, preserving completed tasks and approval history", async () => {
    const client = await db.client.create({ data: { workspaceId, name: "Continuation client" } });
    await db.agentRun.update({ where: { id: runId }, data: { clientId: client.id } });
    await confirm(); await row(); await outcome();
    let snapshot = await getAgentRun(scope, runId);
    const deferred = await createProviderTask(scope, runId, "meta_ads", snapshot.run.version);
    await transitionAgentTask(scope, deferred.id, { expectedVersion: deferred.version, state: "deferred" });
    snapshot = await getAgentRun(scope, runId);
    const completed = await finishOnboardingRun(scope, runId, snapshot.run.version);
    const before = JSON.stringify(await getAgentRun(scope, runId));
    const jobsBefore = await jobs();
    const [next, replay] = await Promise.all([continueDeferredOnboarding(scope, runId, completed.version), continueDeferredOnboarding(scope, runId, completed.version)]);
    assert.equal(next.id, replay.id); assert.notEqual(next.id, runId);
    assert.equal(next.workspaceId, workspaceId); assert.equal(next.clientId, completed.clientId);
    assert.equal(await jobs(), jobsBefore, "continuation must not enqueue imports");
    assert.equal(JSON.stringify(await getAgentRun(scope, runId)), before, "completed evidence and events stay immutable");
    const continued = await getAgentRun(scope, next.id);
    assert.equal(continued.tasks.length, 1); assert.equal(continued.tasks[0].provider, "meta_ads");
    assert.equal(continued.tasks[0].state, "waiting_authorization"); assert.equal(continued.tasks[0].connections.length, 0);
    assert.equal(continued.tasks[0].confirmedScope, null); assert.equal(continued.tasks[0].importJobId, null);
    assert.equal(continued.events[0].payload && (continued.events[0].payload as { previousRunId: string }).previousRunId, runId);
    const resumed = await createOrResumeOnboardingRun(userId, { kind: "onboarding", workspaceId, clientId: client.id });
    await assert.rejects(() => createOrResumeOnboardingRun(userId, { kind: "onboarding", workspaceId }), errorCode("scope_conflict"));
    assert.equal(resumed.run.id, next.id); assert.equal(resumed.created, false);
    await setAgentRunPaused(scope, next.id, next.version, true);
    assert.equal((await continueDeferredOnboarding(scope, runId, completed.version)).status, "paused", "replay must not unpause current work");
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId, userId } }, data: { role: "viewer" } });
    await assert.rejects(() => continueDeferredOnboarding(scope, runId, completed.version), errorCode("insufficient_role"));
    await db.clientProviderAccountAssignment.deleteMany({ where: { workspaceId, clientId: client.id } });
    await db.agentRun.deleteMany({ where: { workspaceId, clientId: client.id } });
    await db.client.delete({ where: { id: client.id } });
  });
  it("requires completed review, remaining sources, and the original reporting scope for continuation", async () => {
    await assert.rejects(() => continueDeferredOnboarding(scope, runId, 0), errorCode("run_not_completed"));
    await confirm(); await row(); await outcome();
    const snapshot = await getAgentRun(scope, runId);
    const completed = await finishOnboardingRun(scope, runId, snapshot.run.version);
    await assert.rejects(() => continueDeferredOnboarding(scope, runId, completed.version - 1), errorCode("stale_version"));
    await assert.rejects(() => continueDeferredOnboarding(scope, runId, completed.version), errorCode("no_deferred_sources"));
    await assert.rejects(() => continueDeferredOnboarding({ userId: peerId, workspaceId }, runId, completed.version), errorCode("run_not_found"));
    await assert.rejects(() => continueDeferredOnboarding({ userId, workspaceId: otherWorkspaceId }, runId, completed.version), errorCode("run_not_found"));
  });
  it("Google binds multiple roots, imports selected leaves only, and carries successful pairs through failed-only retry", async () => {
    await db.workspaceProviderAccess.create({ data: { workspaceId, provider: "google_ads", enabled: true } });
    const roots = ["9001", "9002"];
    const ids = roots.map(root => `google-${root}-${suffix}`);
    for (let i = 0; i < ids.length; i++) await db.connection.create({ data: { id: ids[i], workspaceId, name: `Manager ${roots[i]}`, provider: "google_ads", type: "source", status: "connected", remoteAccountId: roots[i], credentials: encrypt(JSON.stringify({ accessToken: "synthetic-google-only", customerIds: [roots[i]] })) } });
    const discoveredRoots: string[] = [];
    googleAdsReportClient.listCustomerClients = async (_token, root) => { discoveredRoots.push(root); return [{ customerId: root === "9001" ? "101" : "202", mccId: root, isManager: false, descriptiveName: `Leaf ${root}` }, { customerId: "303", mccId: root, isManager: false, descriptiveName: "Shared leaf" }]; };
    const snapshot = await getAgentRun(scope, runId);
    const google = await createProviderTask(scope, runId, "google_ads", snapshot.run.version);
    // Explicit reuse of two connections follows the same discovery contract as OAuth.
    const offeredTask = await reuseTaskConnection(scope, google.id, ids, google.version);
    const offered = OfferedScopeSchema.parse(offeredTask.requestedScope);
    assert.equal(offered.accounts.length, 4);
    const duplicates = offered.accounts.filter(account => account.accountId === "303").map(account => account.id);
    await assert.rejects(() => confirmTaskScopeAndEnqueueImport(scope, google.id, requestInput(offeredTask.version, duplicates)), errorCode("duplicate_account"));
    const selection = offered.accounts.filter(account => ["101", "202"].includes(account.accountId!));
    const input = requestInput(offeredTask.version, selection.map(account => account.id));
    const [confirmed, replay] = await Promise.all([confirmTaskScopeAndEnqueueImport(scope, google.id, input), confirmTaskScopeAndEnqueueImport(scope, google.id, input)]);
    assert.equal(confirmed.importJobId, replay.importJobId);
    const scopeData = ConfirmedScopeSchema.parse(confirmed.confirmedScope);
    assert.equal(scopeData.targets?.length, 2);
    const job = await db.warehouseImportJob.findUniqueOrThrow({ where: { id: confirmed.importJobId! } });
    assert.deepEqual((job.items as { connectionId: string; accountId: string }[]).map(({ connectionId, accountId }) => ({ connectionId, accountId })).sort((a,b) => a.accountId.localeCompare(b.accountId)), [{ connectionId: ids[0], accountId: "101" }, { connectionId: ids[1], accountId: "202" }]);
    await db.campaignMetric.create({ data: { workspaceId, connectionId: ids[0], platform: "google_ads", accountId: "101", level: "campaign", entityId: randomUUID(), date: new Date(`${initialImportWindow().until}T00:00:00Z`), spend: 8, currency: "USD" } });
    await db.warehouseImportJob.update({ where: { id: job.id }, data: { status: "partial", approximateRows: 1, results: [{ connectionId: ids[0], provider: "google_ads", accountId: "101", ok: true }, { connectionId: ids[1], provider: "google_ads", accountId: "202", ok: false }] } });
    const partial = await reconcileTaskImportOutcome(scope, google.id);
    discoveredRoots.length = 0;
    const retried = await retryFailedTaskAccounts(scope, google.id, partial.version);
    assert.deepEqual(discoveredRoots, ["9002"], "successful roots must not be contacted by a failed-only retry");
    const retryJob = await db.warehouseImportJob.findUniqueOrThrow({ where: { id: retried.importJobId! } });
    assert.deepEqual((retryJob.items as { connectionId: string; accountId: string }[]).map(({ connectionId, accountId }) => ({ connectionId, accountId })), [{ connectionId: ids[1], accountId: "202" }]);
    await db.campaignMetric.create({ data: { workspaceId, connectionId: ids[1], platform: "google_ads", accountId: "202", level: "campaign", entityId: randomUUID(), date: new Date(`${initialImportWindow().until}T00:00:00Z`), spend: 12, currency: "EUR" } });
    await db.warehouseImportJob.update({ where: { id: retryJob.id }, data: { status: "completed", approximateRows: 1, results: [{ connectionId: ids[1], provider: "google_ads", accountId: "202", ok: true }] } });
    assert.equal((await reconcileTaskImportOutcome(scope, google.id)).state, "ready");
    const preview = await getTaskDataPreview(scope, google.id);
    assert.equal(preview.rowsCount, 2); assert.equal(preview.aggregates.totalSpend, null);
    assert.deepEqual(preview.accounts.map(account => account.accountId).sort(), ["101", "202"]);
  });
  it("Shopee verifies the shop binding and reviews only order rows, excluding Ads", async () => {
    await db.workspaceProviderAccess.create({ data: { workspaceId, provider: "shopee", enabled: true } });
    const shopConnection = `shopee-${suffix}`;
    await db.connection.create({ data: { id: shopConnection, workspaceId, name: "Synthetic shop", provider: "shopee", type: "source", status: "connected", remoteAccountId: "555", credentials: encrypt(JSON.stringify({ access_token: "synthetic-shop-only", shop_id: 555, refresh_token: "synthetic-refresh", access_token_obtained_at: new Date().toISOString(), expire_in: 14400 })) } });
    shopeeDataClient.getShopInfo = async opts => { assert.equal(opts.shopId, 555); return { shop_name: "Fixture shop", status: "NORMAL", region: "VN", auth_time: 1, expire_time: 2099999999, is_cb: false }; };
    const snapshot = await getAgentRun(scope, runId);
    const shop = await createProviderTask(scope, runId, "shopee", snapshot.run.version);
    const offered = await reuseTaskConnection(scope, shop.id, shopConnection, shop.version);
    await assert.rejects(() => confirmTaskScopeAndEnqueueImport(scope, shop.id, requestInput(offered.version, ["777"])), errorCode("unavailable_account"));
    const confirmed = await confirmTaskScopeAndEnqueueImport(scope, shop.id, requestInput(offered.version, ["555"]));
    const original = { list: shopeeDataClient.getOrderList, detail: shopeeDataClient.getOrderDetail, items: shopeeDataClient.getItemList, catalog: shopeeAdsClient.getAllProductLevelCampaignPages };
    let sync;
    try {
      shopeeDataClient.getShopInfo = async () => ({ shop_name: "Fixture shop", status: "NORMAL", region: "SG", auth_time: 1, expire_time: 2099999999, is_cb: false });
      shopeeDataClient.getOrderList = async () => ({ order_list: [{ order_sn: "fixture-order" }], next_cursor: "" });
      shopeeDataClient.getOrderDetail = async () => ({ order_list: [{ order_sn: "fixture-order", create_time: new Date(`${initialImportWindow().until}T12:00:00Z`).getTime() / 1000, total_amount: 100, currency: "SGD" }] });
      shopeeDataClient.getItemList = async () => ({ item: [], has_next_page: false });
      shopeeAdsClient.getAllProductLevelCampaignPages = async () => { throw new Error("Ads permission denied"); };
      sync = await syncConnectionData({ workspaceId, connectionId: shopConnection, provider: "shopee", credentials: {}, userPlan: "professional", ...initialImportWindow() });
      assert.equal(sync.success, true); assert.equal(sync.rowsIngested, 1);
      assert.equal(sync.children.find(child => child.id === "ads_performance")?.ok, false);
      assert.equal(sync.children.find(child => child.id === "ads_performance")?.optional, true);
      assert.equal(sync.children.find(child => child.id === "campaign_catalog")?.ok, false);
    } finally {
      shopeeDataClient.getOrderList = original.list; shopeeDataClient.getOrderDetail = original.detail; shopeeDataClient.getItemList = original.items; shopeeAdsClient.getAllProductLevelCampaignPages = original.catalog;
    }
    await db.campaignMetric.create({ data: { workspaceId, connectionId: shopConnection, platform: "shopee", accountId: "555", level: "campaign", entityId: "ad-only", breakdownHash: "none", date: new Date(`${initialImportWindow().until}T00:00:00Z`), conversions: 20, revenue: 900, currency: "SGD" } });
    await db.warehouseImportJob.update({ where: { id: confirmed.importJobId! }, data: { status: "completed", approximateRows: sync.rowsIngested, results: [{ connectionId: shopConnection, provider: "shopee", accountId: "555", ok: sync.success }] } });
    assert.equal((await reconcileTaskImportOutcome(scope, shop.id)).state, "ready");
    const preview = await getTaskDataPreview(scope, shop.id);
    assert.equal(preview.rowsCount, 1); assert.equal(preview.accounts[0].groups[0].conversions, 1); assert.equal(preview.accounts[0].groups[0].currency, "SGD"); assert.equal(preview.accounts[0].groups[0].revenue, 100);
    assert.ok(preview.coverage.limitations.some(note => note.includes("Ads coverage is optional")));
  });
  it("rejects foreign actors, revoked membership, disabled providers and paused OAuth", async () => {
    await assert.rejects(() => discoverTaskAccounts({ userId: peerId, workspaceId }, taskId, 0), errorCode("run_not_found"));
    await assert.rejects(() => discoverTaskAccounts({ userId, workspaceId: otherWorkspaceId }, taskId, 0), errorCode("task_not_found"));
    await db.workspaceMember.updateMany({ where: { workspaceId, userId }, data: { role: "viewer" } });
    await assert.rejects(() => validateAgentOAuthTask(scope, taskId, "tiktok_business"), errorCode("insufficient_role"));
    await db.workspaceMember.updateMany({ where: { workspaceId, userId }, data: { role: "owner" } });
    await db.workspaceProviderAccess.updateMany({ where: { workspaceId }, data: { enabled: false } });
    await assert.rejects(() => validateAgentOAuthTask(scope, taskId, "tiktok_business"), errorCode("provider_not_enabled"));
    await db.workspaceProviderAccess.updateMany({ where: { workspaceId }, data: { enabled: true } });
    const snapshot = await getAgentRun(scope, runId); await setAgentRunPaused(scope, runId, snapshot.run.version, true);
    await assert.rejects(() => validateAgentOAuthTask(scope, taskId, "tiktok_business"), errorCode("run_not_active"));
  });
  it("does not treat remoteAccountId as authorization when discovery fails or is empty", async () => {
    tiktokBusinessClient.listAuthorizedAdvertisers = async () => ({ advertiser_ids: [] });
    const empty = await prepare(); assert.equal(empty.state, "needs_attention"); assert.equal(empty.reasonCode, "no_accounts");
    tiktokBusinessClient.listAuthorizedAdvertisers = async () => { throw new Error("synthetic provider outage"); };
    const failed = await discoverTaskAccounts(scope, taskId, empty.version); assert.equal(failed.reasonCode, "discovery_failed"); assert.equal(await jobs(), 0);
  });
  it("rechecks a pause that occurs during external account discovery", async () => {
    let release!: () => void; let entered!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    tiktokBusinessClient.listAuthorizedAdvertisers = async () => { entered(); await wait; return { advertiser_ids: ["1001"] }; };
    const running = prepare(); const rejected = assert.rejects(running, errorCode("run_not_active")); await started;
    const snapshot = await getAgentRun(scope, runId); await setAgentRunPaused(scope, runId, snapshot.run.version, true); release(); await rejected; assert.equal(await jobs(), 0);
  });
  it("rejects undisclosed accounts and newly revoked advertiser access before creating work", async () => {
    const prepared = await prepare();
    await assert.rejects(() => confirmTaskScopeAndEnqueueImport(scope, taskId, requestInput(prepared.version, ["9999"])), errorCode("unavailable_account"));
    tiktokBusinessClient.listAuthorizedAdvertisers = async () => ({ advertiser_ids: ["1002"] });
    await assert.rejects(() => confirmTaskScopeAndEnqueueImport(scope, taskId, requestInput(prepared.version)), errorCode("unavailable_account")); assert.equal(await jobs(), 0);
  });
  it("concurrent/replayed confirmation creates exactly one scope and job; changed scope is rejected", async () => {
    const prepared = await prepare(); const input = requestInput(prepared.version);
    const results = await Promise.all(Array.from({ length: 4 }, () => confirmTaskScopeAndEnqueueImport(scope, taskId, input)));
    assert.equal(new Set(results.map(result => result.importJobId)).size, 1); assert.equal(await jobs(), 1);
    assert.equal((await confirmTaskScopeAndEnqueueImport(scope, taskId, input)).importJobId, results[0].importJobId);
    await assert.rejects(() => confirmTaskScopeAndEnqueueImport(scope, taskId, { ...input, selectedAccountIds: ["1002"] }), errorCode("scope_conflict"));
    const current = await task(); assert.ok(!JSON.stringify(results).includes("credentials")); assert.equal(current.scopeRevision, 1); assert.equal(current.confirmedByUserId, userId);
  });
  it("requires reconfirmation when plan dates change and rejects future/oversized windows", async () => {
    const prepared = await prepare(); const input = requestInput(prepared.version);
    await db.workspace.update({ where: { id: workspaceId }, data: { plan: "free" } });
    const oldSince = new Date(`${input.until}T00:00:00Z`); oldSince.setUTCDate(oldSince.getUTCDate() - 25);
    await assert.rejects(() => confirmTaskScopeAndEnqueueImport(scope, taskId, { ...input, since: oldSince.toISOString().slice(0, 10) }), errorCode("scope_changed"));
    await assert.rejects(() => confirmTaskScopeAndEnqueueImport(scope, taskId, { ...input, until: "2099-01-01" }), errorCode("invalid_date_range")); assert.equal(await jobs(), 0);
  });
  it("zero-row, failed and partial jobs cannot award readiness even with old warehouse data", async () => {
    await confirm(); await row();
    const zero = await outcome("completed", ["1001"], 0); assert.equal(zero.state, "needs_attention"); assert.equal(zero.reasonCode, "no_data_found");
    await db.agentTask.update({ where: { id: taskId }, data: { state: "queued" } });
    assert.equal((await outcome("partial")).reasonCode, "partial_import");
    await db.agentTask.update({ where: { id: taskId }, data: { state: "queued" } }); assert.equal((await outcome("failed")).reasonCode, "import_failed");
    const snapshot = await getAgentRun(scope, runId); await assert.rejects(() => finishOnboardingRun(scope, runId, snapshot.run.version), errorCode("review_not_ready"));
  });
  it("queries full exact-scope evidence, keeps currencies separate, and records explicit review", async () => {
    await confirm();
    for (let i = 0; i < 55; i++) await row("1001", i % 2 ? "USD" : "VND"); await row("1002", "USD");
    const ready = await outcome("completed", ["1001"], 55); assert.equal(ready.state, "ready");
    assert.notEqual((await getAgentRun(scope, runId)).run.status, "completed");
    const preview = await getTaskDataPreview(scope, taskId); assert.equal(preview.rowsCount, 55); assert.equal(preview.sampleRows.length, 10); assert.equal(preview.accounts.length, 1); assert.equal(preview.accounts[0].groups.length, 2); assert.equal(preview.aggregates.totalSpend, null);
    await assert.rejects(() => getTaskDataPreview({ userId: peerId, workspaceId }, taskId), errorCode("run_not_found"));
    const snapshot = await getAgentRun(scope, runId); const finished = await finishOnboardingRun(scope, runId, snapshot.run.version);
    assert.equal(finished.status, "completed"); assert.ok(finished.reviewedAt); assert.equal(await db.auditEvent.count({ where: { workspaceId, action: "onboarding.dashboard_reviewed" } }), 1);
  });
  it("cannot finish an empty setup or quietly omit a pending source", async () => {
    let snapshot = await getAgentRun(scope, runId); await assert.rejects(() => finishOnboardingRun(scope, runId, snapshot.run.version), errorCode("review_not_ready"));
    await confirm(); await row(); await outcome(); snapshot = await getAgentRun(scope, runId);
    await createProviderTask(scope, runId, "meta_ads", snapshot.run.version); snapshot = await getAgentRun(scope, runId);
    await assert.rejects(() => finishOnboardingRun(scope, runId, snapshot.run.version), errorCode("review_not_ready"));
  });
  it("client scope conflicts roll back the job, and later reassignment blocks review", async () => {
    const clientA = await db.client.create({ data: { workspaceId, name: "Client A" } });
    const clientB = await db.client.create({ data: { workspaceId, name: "Client B" } });
    try {
      await db.agentRun.update({ where: { id: runId }, data: { clientId: clientA.id } });
      await db.clientProviderAccountAssignment.create({ data: { workspaceId, clientId: clientB.id, provider: "tiktok_business", accountId: "1001", connectionId } });
      const prepared = await prepare();
      await assert.rejects(() => confirmTaskScopeAndEnqueueImport(scope, taskId, requestInput(prepared.version)), errorCode("client_scope_conflict"));
      assert.equal(await jobs(), 0); assert.equal((await task()).confirmedScope, null);
      await db.clientProviderAccountAssignment.deleteMany({ where: { workspaceId } });
      await confirmTaskScopeAndEnqueueImport(scope, taskId, requestInput(prepared.version)); await row(); await outcome();
      await db.clientProviderAccountAssignment.updateMany({ where: { workspaceId }, data: { clientId: clientB.id } });
      await assert.rejects(() => getTaskDataPreview(scope, taskId), errorCode("client_scope_changed"));
      const snapshot = await getAgentRun(scope, runId);
      await assert.rejects(() => finishOnboardingRun(scope, runId, snapshot.run.version), errorCode("client_scope_changed"));
    } finally {
      await db.agentRun.update({ where: { id: runId }, data: { clientId: null } });
      await db.client.deleteMany({ where: { workspaceId, id: { in: [clientA.id, clientB.id] } } });
    }
  });
  it("explicit recovery preserves old job evidence and requires a new confirmed revision", async () => {
    const first = await confirm(); const failed = await outcome("failed");
    const deferred = await transitionAgentTask(scope, taskId, { state: "deferred", expectedVersion: failed.version });
    const restored = await restoreDeferredImport(scope, taskId, deferred.version);
    const offered = await reopenTaskImportChoice(scope, taskId, restored.version);
    assert.equal(offered.state, "waiting_selection"); assert.equal(offered.confirmedScope, null);
    const next = await confirmTaskScopeAndEnqueueImport(scope, taskId, requestInput(offered.version, ["1002"]));
    assert.notEqual(next.importJobId, first.importJobId); assert.equal(next.scopeRevision, 2); assert.equal(await jobs(), 2);
  });
  it("M4 retries only failed targets, preserves exact scope, deduplicates replay and retains receipts", async () => {
    await confirm(["1001", "1002"]); await row("1001");
    const original = await task();
    await db.warehouseImportJob.update({ where: { id: original.importJobId! }, data: { status: "partial", approximateRows: 1, results: [{ connectionId, provider: "tiktok_business", accountId: "1001", ok: true, rowsIngested: 1 }, { connectionId, provider: "tiktok_business", accountId: "1002", ok: false }], finishedAt: new Date() } });
    const partial = await reconcileTaskImportOutcome(scope, taskId);
    const retried = await Promise.all([retryFailedTaskAccounts(scope, taskId, partial.version), retryFailedTaskAccounts(scope, taskId, partial.version)]);
    assert.equal(retried[0].importJobId, retried[1].importJobId); assert.equal(await jobs(), 2);
    const job = await db.warehouseImportJob.findUniqueOrThrow({ where: { id: retried[0].importJobId! } });
    assert.deepEqual(job.items, [{ connectionId, accountId: "1002", requestedSince: initialImportWindow().since, requestedUntil: initialImportWindow().until, clamped: false }]); assert.equal(job.retryCount, 1);
    assert.deepEqual(retried[0].confirmedScope, original.confirmedScope); assert.equal(retried[0].scopeRevision, original.scopeRevision);
    await row("1002"); assert.equal((await outcome("completed", ["1002"], 1)).state, "ready");
    assert.equal((await getTaskDataPreview(scope, taskId)).rowsCount, 2);
  });
  it("M4 rejects exhausted or newly unauthorized retry targets without creating another job", async () => {
    await confirm(); const failed = await outcome("failed");
    tiktokBusinessClient.listAuthorizedAdvertisers = async () => ({ advertiser_ids: [] });
    await assert.rejects(() => retryFailedTaskAccounts(scope, taskId, failed.version), errorCode("reconnect_required"));
    await db.warehouseImportJob.update({ where: { id: failed.importJobId! }, data: { retryCount: 3 } });
    await assert.rejects(() => retryFailedTaskAccounts(scope, taskId, failed.version), errorCode("retry_exhausted")); assert.equal(await jobs(), 1);
  });
  it("M4 Meta uses task-linked consent, live account selection and provider-isolated evidence", async () => {
    await db.workspaceProviderAccess.create({ data: { workspaceId, provider: "meta_ads", enabled: true } });
    const metaConnectionId = `meta-${suffix}`;
    await db.connection.create({ data: { id: metaConnectionId, workspaceId, name: "Synthetic Meta", provider: "meta_ads", type: "source", status: "connected", credentials: encrypt(JSON.stringify({ accessToken: "synthetic-meta-only" })) } });
    metaAdsClient.getAdAccounts = async () => [{ id: "act_101", name: "Meta fixture advertiser", currency: "USD", account_status: 1 }];
    const snapshot = await getAgentRun(scope, runId);
    const meta = await createProviderTask(scope, runId, "meta_ads", snapshot.run.version);
    const token = await createOAuthAttempt({ userId, workspaceId, provider: "meta_ads", agentTaskId: meta.id });
    const attempt = await consumeOAuthAttempt({ token, provider: "meta_ads", sessionUserId: userId }); assert.equal(attempt.agentTaskId, meta.id);
    const current = await db.agentTask.findUniqueOrThrow({ where: { id: meta.id } });
    const linked = await attachTaskConnections(scope, meta.id, [metaConnectionId], current.version);
    const offered = await discoverTaskAccounts(scope, meta.id, linked.version);
    assert.equal((offered.requestedScope as any).accounts[0].id, "act_101");
    await assert.rejects(() => confirmTaskScopeAndEnqueueImport(scope, meta.id, requestInput(offered.version, ["1001"])), errorCode("unavailable_account"));
    const confirmed = await confirmTaskScopeAndEnqueueImport(scope, meta.id, requestInput(offered.version, ["act_101"]));
    const job = await db.warehouseImportJob.findUniqueOrThrow({ where: { id: confirmed.importJobId! } });
    assert.deepEqual(job.items, [{ connectionId: metaConnectionId, accountId: "act_101", adAccountId: "act_101", requestedSince: initialImportWindow().since, requestedUntil: initialImportWindow().until, clamped: false }]);
    await db.campaignMetric.create({ data: { workspaceId, connectionId: metaConnectionId, platform: "meta_ads", accountId: "act_101", level: "ad", entityId: "meta-campaign", date: new Date(`${initialImportWindow().until}T00:00:00Z`), spend: 10, currency: "USD" } });
    await db.warehouseImportJob.update({ where: { id: job.id }, data: { status: "completed", approximateRows: 1, results: [{ connectionId: metaConnectionId, provider: "meta_ads", adAccountId: "act_101", ok: true, rowsIngested: 1 }] } });
    assert.equal((await reconcileTaskImportOutcome(scope, meta.id)).state, "ready");
    assert.equal((await getTaskDataPreview(scope, meta.id)).rowsCount, 1);
    const waiting = await task(); await transitionAgentTask(scope, taskId, { state: "deferred", expectedVersion: waiting.version });
    const ready = await getAgentRun(scope, runId); assert.equal((await finishOnboardingRun(scope, runId, ready.run.version)).status, "completed");
  });
  it("task-linked consent is single-use, replaces older pending consent, and binds identity", async () => {
    const input = { userId, workspaceId, provider: "tiktok_business", agentTaskId: taskId };
    const old = await createOAuthAttempt(input); const token = await createOAuthAttempt(input);
    await assert.rejects(() => consumeOAuthAttempt({ token: old, provider: "tiktok_business", sessionUserId: userId }));
    await assert.rejects(() => consumeOAuthAttempt({ token, provider: "tiktok_business", sessionUserId: peerId }));
    const attempt = await consumeOAuthAttempt({ token, provider: "tiktok_business", sessionUserId: userId }); assert.equal(attempt.agentTaskId, taskId);
    await assert.rejects(() => consumeOAuthAttempt({ token, provider: "tiktok_business", sessionUserId: userId })); assert.equal(await jobs(), 0);
  });
  it("provider denial consumes validated state, returns to the original workspace and launches no import", async () => {
    const token = await createOAuthAttempt({ userId, workspaceId, provider: "tiktok_business", agentTaskId: taskId });
    const response = await callback(new NextRequest(`http://localhost/api/auth/callback?provider=tiktok_business&state=${token}&error=access_denied`));
    assert.ok(response.headers.get("location")?.includes(`/onboarding?workspaceId=${encodeURIComponent(workspaceId)}`));
    assert.equal((await task()).reasonCode, "authorization_denied"); assert.equal(await jobs(), 0);
  });
  it("expired job lease transitions task to needs_attention with reasonCode lease_lost_or_stalled", async () => {
    await confirm(["1001"]);
    const current = await task();
    assert.ok(current.importJobId);
    await db.warehouseImportJob.update({
      where: { id: current.importJobId },
      data: {
        status: "running",
        leaseExpiresAt: new Date(Date.now() - 30_000), // expired 30s ago
      },
    });
    const reconciled = await reconcileTaskImportOutcome(scope, taskId);
    assert.equal(reconciled.state, "needs_attention");
    assert.equal(reconciled.reasonCode, "lease_lost_or_stalled");
  });
  it("observes worker recovery after an expired lease without duplicate attention events or lost receipts", async () => {
    await confirm(["1001", "1002"]); await row("1001");
    const current = await task();
    await db.warehouseImportJob.update({ where: { id: current.importJobId! }, data: { status: "partial", approximateRows: 1, results: [{ connectionId, provider: "tiktok_business", accountId: "1001", ok: true }, { connectionId, provider: "tiktok_business", accountId: "1002", ok: false }] } });
    const partial = await reconcileTaskImportOutcome(scope, taskId);
    const retried = await retryFailedTaskAccounts(scope, taskId, partial.version);
    await db.warehouseImportJob.update({ where: { id: retried.importJobId! }, data: { status: "running", leaseExpiresAt: new Date(Date.now() - 30_000) } });
    await reconcileRunImports(scope, runId);
    const stalled = await task(); assert.equal(stalled.reasonCode, "lease_lost_or_stalled");
    const events = await db.agentRunEvent.count({ where: { workspaceId, runId } });
    await reconcileRunImports(scope, runId);
    assert.equal((await task()).version, stalled.version);
    assert.equal(await db.agentRunEvent.count({ where: { workspaceId, runId } }), events);
    await row("1002");
    await db.warehouseImportJob.update({ where: { id: retried.importJobId! }, data: { status: "completed", approximateRows: 1, results: [{ connectionId, provider: "tiktok_business", accountId: "1002", ok: true }] } });
    await reconcileRunImports(scope, runId);
    assert.equal((await task()).state, "ready"); assert.equal((await getTaskDataPreview(scope, taskId)).rowsCount, 2);
    assert.equal(await jobs(), 2, "worker recovery must reuse the submitted job");
  });
  it("paused run ignores reconcileRunImports while direct reconcileTaskImportOutcome rejects with run_not_active", async () => {
    await confirm(["1001"]);
    const runState = await getAgentRun(scope, runId);
    await setAgentRunPaused(scope, runId, runState.run.version, true);
    // Batch run reconcile on paused run should no-op and not mutate tasks
    await reconcileRunImports(scope, runId);
    const afterBatch = await task();
    assert.equal(afterBatch.state, "queued"); // remains queued
    // Direct task reconcile should reject with run_not_active
    await assert.rejects(() => reconcileTaskImportOutcome(scope, taskId), errorCode("run_not_active"));
  });
});
