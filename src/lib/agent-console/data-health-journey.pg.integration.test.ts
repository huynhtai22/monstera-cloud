import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  agentConsoleTransaction,
  createResponsibility,
  setResponsibilityScope,
  confirmResponsibility,
  reconcileLostOperationLeases,
  updateOperationWithFencedLease,
} from "./persistence";
import { confirmResponsibilityAction, handleResponsibilityAction } from "./responsibilities";
import { executeScheduledDataHealthCheck } from "./scheduler";
import {
  prepareCaseRecovery,
  executeRecoveryImportOperation,
  verifyRecoveryAndCloseCase,
  verifyTargetDataHealthAndCoverage,
} from "./recovery";
import { getAgentConsoleOperationalSummary } from "./console-summary";
import { computeCanonicalScopeHash } from "./persistence";
import { GET as runAgentConsoleCronGet } from "@/app/api/agent-console/cron/route";

describe("C4 plus minimum C5 Data Health Journey against real PostgreSQL", () => {
  const initialMonitoringFlag = process.env.ENABLE_AGENT_CONSOLE_MONITORING;
  const initialWorkerFlag = process.env.ENABLE_AGENT_CONSOLE_WORKER;
  const initialWorkspaceCohort = process.env.AGENT_CONSOLE_WORKSPACE_IDS;
  const db = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/clean_c3_verify_fresh",
      },
    },
  });

  const suffix = randomUUID();
  const ownerId = `u-dh-owner-${suffix}`;
  const adminId = `u-dh-admin-${suffix}`;
  const memberId = `u-dh-member-${suffix}`;
  const foreignOwnerId = `u-dh-foreign-${suffix}`;

  const workspaceId = `ws-dh-${suffix}`;
  const foreignWorkspaceId = `ws-dh-foreign-${suffix}`;

  const clientId = `client-dh-${suffix}`;
  const connMetaId = `conn-meta-${suffix}`;
  const connTikTokId = `conn-tt-${suffix}`;

  let responsibilityId: string;
  let detectedCaseId: string;
  let recoveryOperationId: string;
  let recoveryJobId: string;

  before(async () => {
    await db.$connect();

    // 1. Create test users
    for (const [id, email] of [
      [ownerId, `owner-${suffix}@example.test`],
      [adminId, `admin-${suffix}@example.test`],
      [memberId, `member-${suffix}@example.test`],
      [foreignOwnerId, `foreign-${suffix}@example.test`],
    ]) {
      await db.user.create({ data: { id, email, name: id, plan: "professional" } });
    }

    // 2. Create workspaces
    await db.workspace.create({
      data: { id: workspaceId, name: "Data Health WS", slug: `ws-dh-${suffix}`, ownerId, plan: "professional", status: "ACTIVE" },
    });
    await db.workspace.create({
      data: { id: foreignWorkspaceId, name: "Foreign WS", slug: `ws-foreign-${suffix}`, ownerId: foreignOwnerId, plan: "professional", status: "ACTIVE" },
    });

    // 3. Memberships
    await db.workspaceMember.createMany({
      data: [
        { workspaceId, userId: ownerId, role: "owner" },
        { workspaceId, userId: adminId, role: "admin" },
        { workspaceId, userId: memberId, role: "member" },
        { workspaceId: foreignWorkspaceId, userId: foreignOwnerId, role: "owner" },
      ],
    });

    // 4. Clients
    await db.client.create({
      data: { id: clientId, workspaceId, name: "Data Health Client" },
    });

    // 5. Connections: Meta connected, TikTok with fresh sync
    await db.connection.create({
      data: {
        id: connMetaId,
        workspaceId,
        name: "Meta Ads Source",
        type: "source",
        provider: "meta_ads",
        credentials: "enc",
        remoteAccountId: "act_101",
        status: "connected",
        lastSyncAt: new Date(),
        lastDataThrough: new Date("2026-09-28T00:00:00Z"),
      },
    });

    await db.connection.create({
      data: {
        id: connTikTokId,
        workspaceId,
        name: "TikTok Ads Source",
        type: "source",
        provider: "tiktok_business",
        credentials: "enc",
        remoteAccountId: "tt_adv_202",
        status: "connected",
        lastSyncAt: new Date(),
        lastDataThrough: new Date("2026-09-28T00:00:00Z"),
      },
    });
  });

  after(async () => {
    // Cascade cleanup
    await db.campaignMetric.deleteMany({ where: { workspaceId: { in: [workspaceId, foreignWorkspaceId] } } });
    await db.workspace.deleteMany({ where: { id: { in: [workspaceId, foreignWorkspaceId] } } });
    await db.user.deleteMany({ where: { id: { in: [ownerId, adminId, memberId, foreignOwnerId] } } });
    await db.$disconnect();
    if (initialMonitoringFlag === undefined) delete process.env.ENABLE_AGENT_CONSOLE_MONITORING;
    else process.env.ENABLE_AGENT_CONSOLE_MONITORING = initialMonitoringFlag;
    if (initialWorkerFlag === undefined) delete process.env.ENABLE_AGENT_CONSOLE_WORKER;
    else process.env.ENABLE_AGENT_CONSOLE_WORKER = initialWorkerFlag;
    if (initialWorkspaceCohort === undefined) delete process.env.AGENT_CONSOLE_WORKSPACE_IDS;
    else process.env.AGENT_CONSOLE_WORKSPACE_IDS = initialWorkspaceCohort;
  });

  it("Step 1: Customer selects workspace, sources/accounts, cadence and explicitly approves responsibility", async () => {
    const previousMonitoring = process.env.ENABLE_AGENT_CONSOLE_MONITORING;
    const previousWorker = process.env.ENABLE_AGENT_CONSOLE_WORKER;
    try {
      delete process.env.ENABLE_AGENT_CONSOLE_MONITORING;
      delete process.env.ENABLE_AGENT_CONSOLE_WORKER;
      const unavailableSummary = await getAgentConsoleOperationalSummary(workspaceId);
      assert.equal(unavailableSummary.schedulerStatus, "unavailable");
      assert.equal(unavailableSummary.monitoringAvailable, false);
      assert.ok(unavailableSummary.activeBlockers.some((blocker) => blocker.includes("WORKER_UNAVAILABLE")));
    } finally {
      if (previousMonitoring === undefined) delete process.env.ENABLE_AGENT_CONSOLE_MONITORING;
      else process.env.ENABLE_AGENT_CONSOLE_MONITORING = previousMonitoring;
      if (previousWorker === undefined) delete process.env.ENABLE_AGENT_CONSOLE_WORKER;
      else process.env.ENABLE_AGENT_CONSOLE_WORKER = previousWorker;
    }
    process.env.ENABLE_AGENT_CONSOLE_MONITORING = "1";
    process.env.ENABLE_AGENT_CONSOLE_WORKER = "1";
    process.env.AGENT_CONSOLE_WORKSPACE_IDS = workspaceId;

    // Create draft responsibility
    const resp = await agentConsoleTransaction(async (tx) => {
      return createResponsibility(tx, {
        workspaceId,
        clientId,
        ownerId: adminId,
        createdByUserId: adminId,
        kind: "source_health",
        cadence: "daily",
        configuration: { checkFrequency: "daily" },
      });
    });
    responsibilityId = resp.id;
    assert.equal(resp.status, "draft");

    // Assign scope
    const scopeItems = [
      {
        provider: "meta_ads",
        connectionId: connMetaId,
        providerAccountId: "act_101",
        accountName: "Meta Main Account",
        currency: "USD",
        timezone: "America/New_York",
      },
      {
        provider: "tiktok_business",
        connectionId: connTikTokId,
        providerAccountId: "tt_adv_202",
        accountName: "TikTok Main Account",
        currency: "USD",
        timezone: "America/New_York",
      },
    ];

    await agentConsoleTransaction(async (tx) => {
      await setResponsibilityScope(tx, {
        workspaceId,
        responsibilityId,
        scopeRevision: 1,
        items: scopeItems,
      });
    });

    const scopeHash = computeCanonicalScopeHash(scopeItems);

    // Confirm responsibility by admin with permitted recovery actions
    const confirmed = await agentConsoleTransaction(async (tx) => {
      return confirmResponsibility(tx, {
        workspaceId,
        responsibilityId,
        expectedVersion: 0,
        scopeHash,
        authorizingUserId: adminId,
        allowlistedTools: ["inspect_source", "query_coverage", "submit_recovery_import", "verify_coverage"],
        allowedPairs: [
          { provider: "meta_ads", connectionId: connMetaId, providerAccountId: "act_101" },
          { provider: "tiktok_business", connectionId: connTikTokId, providerAccountId: "tt_adv_202" },
        ],
        limits: {
          permittedRecoveryModes: ["retry_failed_window", "full_window_reimport"],
        },
        expiresAt: new Date(Date.now() + 30 * 86400000), // 30 days
      });
    });

    assert.equal(confirmed.responsibility.status, "active");
    assert.equal(confirmed.responsibility.scopeRevision, 1);
    assert.equal(confirmed.authorization.policyRevision, 1);
  });

  it("Step 2: Durable scheduled check detects connection problem and creates exactly one actionable case", async () => {
    // Degrade TikTok connection health (simulate stale sync > 24 hours)
    await db.connection.update({
      where: { id: connTikTokId },
      data: {
        lastSyncAt: new Date(Date.now() - 36 * 3600000), // 36 hours ago (stale)
      },
    });

    const scheduledSlot = new Date("2026-09-30T00:00:00Z");
    const outcome = await executeScheduledDataHealthCheck({
      workspaceId,
      responsibilityId,
      scheduledSlot,
    });

    assert.equal(outcome.status, "incident_detected");
    assert.equal(outcome.caseOpenedOrUpdated, true);
    assert.ok(outcome.caseId);
    detectedCaseId = outcome.caseId!;

    // Verify deduplication: re-running for same problem does NOT create duplicate case
    const repeatOutcome = await executeScheduledDataHealthCheck({
      workspaceId,
      responsibilityId,
      scheduledSlot,
    });
    assert.equal(repeatOutcome.caseId, detectedCaseId);

    const cases = await db.agentCase.findMany({
      where: { workspaceId, responsibilityId, state: { not: "resolved" } },
    });
    assert.equal(cases.length, 1, "Exactly one deduplicated actionable case created");
    assert.equal(cases[0].type, "source_health");
    assert.equal(cases[0].requiredAction, "recovery_import");
  });

  it("Step 3: Console operational summary shows evidence, blockers, last check, data-through, next check and delayed status", async () => {
    const summary = await getAgentConsoleOperationalSummary(workspaceId);

    assert.equal(summary.workspaceId, workspaceId);
    assert.equal(summary.cadence, "daily");
    assert.equal(summary.schedulerStatus, "active");
    assert.equal(summary.supportedCadenceLabel, "Daily checks (evaluation target)");
    assert.ok(summary.nextScheduledCheck);
    assert.equal(summary.dataThroughCoverage, "2026-09-28");
    assert.equal(summary.openCases.length, 1);
    assert.equal(summary.openCases[0].id, detectedCaseId);

    // Test delayed scheduler detection (overdue > 60m)
    await db.agentResponsibility.update({
      where: { workspaceId_id: { workspaceId, id: responsibilityId } },
      data: { nextDueAt: new Date(Date.now() - 75 * 60000) }, // 75 mins overdue
    });

    const delayedSummary = await getAgentConsoleOperationalSummary(workspaceId);
    assert.equal(delayedSummary.schedulerStatus, "delayed");
    assert.ok(delayedSummary.activeBlockers.some((b) => b.includes("SCHEDULER_DELAYED")));

    // Both server-side gates must be enabled before the UI can claim monitoring is available.
    const prevWorkerFlag = process.env.ENABLE_AGENT_CONSOLE_WORKER;
    const prevMonitoringFlag = process.env.ENABLE_AGENT_CONSOLE_MONITORING;
    try {
      process.env.ENABLE_AGENT_CONSOLE_WORKER = "0";
      const unavailSummary = await getAgentConsoleOperationalSummary(workspaceId);
      assert.equal(unavailSummary.schedulerStatus, "unavailable");
      assert.ok(unavailSummary.activeBlockers.some((b) => b.includes("WORKER_UNAVAILABLE")));

      process.env.ENABLE_AGENT_CONSOLE_WORKER = "1";
      process.env.ENABLE_AGENT_CONSOLE_MONITORING = "0";
      const monitoringDisabledSummary = await getAgentConsoleOperationalSummary(workspaceId);
      assert.equal(monitoringDisabledSummary.schedulerStatus, "unavailable");
      assert.ok(monitoringDisabledSummary.activeBlockers.some((b) => b.includes("WORKER_UNAVAILABLE")));
    } finally {
      if (prevWorkerFlag === undefined) {
        delete process.env.ENABLE_AGENT_CONSOLE_WORKER;
      } else {
        process.env.ENABLE_AGENT_CONSOLE_WORKER = prevWorkerFlag;
      }
      if (prevMonitoringFlag === undefined) {
        delete process.env.ENABLE_AGENT_CONSOLE_MONITORING;
      } else {
        process.env.ENABLE_AGENT_CONSOLE_MONITORING = prevMonitoringFlag;
      }
    }
  });

  it("Step 4: Recovery preparation checks credentials (reconnect vs queued import)", async () => {
    // 4a. Expired access requires reconnect
    await db.connection.update({
      where: { id: connTikTokId },
      data: {
        status: "disconnected",
        lastError: "OAuth token expired (invalid_grant)",
      },
    });

    const reconnectOutcome = await prepareCaseRecovery({
      workspaceId,
      caseId: detectedCaseId,
      userId: adminId,
    });

    assert.equal(reconnectOutcome.actionType, "reconnect");
    assert.equal(reconnectOutcome.requiresReconnect, true);
    assert.equal(reconnectOutcome.reconnectProvider, "tiktok_business");

    // 4b. Restored credentials enqueues submit_recovery_import
    await db.connection.update({
      where: { id: connTikTokId },
      data: {
        status: "connected",
        lastError: null,
      },
    });

    const queuedOutcome = await prepareCaseRecovery({
      workspaceId,
      caseId: detectedCaseId,
      userId: adminId,
      since: "2026-09-20",
      until: "2026-09-27",
    });

    assert.equal(queuedOutcome.actionType, "queued");
    assert.equal(queuedOutcome.requiresReconnect, false);
    assert.ok(queuedOutcome.operation);
    recoveryOperationId = (queuedOutcome.operation as any).id;
  });

  it("Step 5: Execute recovery import dispatches durable warehouse import job", async () => {
    const execResult = await executeRecoveryImportOperation({
      workspaceId,
      operationId: recoveryOperationId,
      userId: adminId,
    });

    assert.ok(execResult.jobId);
    recoveryJobId = execResult.jobId;

    const job = await db.warehouseImportJob.findUnique({
      where: { id: recoveryJobId },
    });
    assert.ok(job);
    assert.equal(job.workspaceId, workspaceId);
  });

  it("Step 6: Verification rejects partial imports and confirms restored health before closing case", async () => {
    // 6a. Partial import keeps case open
    await db.warehouseImportJob.update({
      where: { workspaceId_id: { workspaceId, id: recoveryJobId } },
      data: {
        status: "completed",
        results: [
          { connectionId: connTikTokId, accountId: "tt_adv_202", ok: false, outcome: "failed" },
        ],
      },
    });

    const partialOutcome = await verifyRecoveryAndCloseCase({
      workspaceId,
      caseId: detectedCaseId,
      jobId: recoveryJobId,
    });

    assert.equal(partialOutcome.verified, false);
    assert.equal(partialOutcome.status, "partial");
    assert.equal(partialOutcome.caseClosed, false);

    let caseCheck = await db.agentCase.findUnique({ where: { id: detectedCaseId } });
    assert.notEqual(caseCheck?.state, "resolved", "Partial import must NOT close the case");

    // 6b. Full success verifies coverage and closes case
    await db.warehouseImportJob.update({
      where: { workspaceId_id: { workspaceId, id: recoveryJobId } },
      data: {
        status: "completed",
        results: [
          { connectionId: connTikTokId, accountId: "tt_adv_202", ok: true, outcome: "success" },
        ],
      },
    });

    // Mark connection healthy and fresh
    await db.connection.update({
      where: { id: connTikTokId },
      data: {
        status: "connected",
        lastSyncAt: new Date(),
        lastDataThrough: new Date("2026-09-29T00:00:00Z"),
      },
    });

    // Insert actual warehouse metrics for the recovered account covering the entire recovery window (2026-09-20 to 2026-09-27)
    for (let day = 20; day <= 27; day++) {
      await db.campaignMetric.create({
        data: {
          workspaceId,
          connectionId: connTikTokId,
          platform: "tiktok_business",
          accountId: "tt_adv_202",
          currency: "USD",
          spend: 150.0,
          conversions: 10,
          date: new Date(`2026-09-${day}T00:00:00Z`),
          level: "account",
          entityId: "tt_adv_202",
        },
      });
    }

    const fullOutcome = await verifyRecoveryAndCloseCase({
      workspaceId,
      caseId: detectedCaseId,
      jobId: recoveryJobId,
    });

    assert.equal(fullOutcome.verified, true, JSON.stringify(fullOutcome));
    assert.equal(fullOutcome.caseClosed, true);

    caseCheck = await db.agentCase.findUnique({ where: { id: detectedCaseId } });
    assert.equal(caseCheck?.state, "resolved");
    assert.equal(caseCheck?.resolutionType, "automated_recovery");
  });

  it("Step 7: Customer can pause the responsibility and inspect persisted history", async () => {
    // Get current responsibility version
    const currentResp = await db.agentResponsibility.findUniqueOrThrow({
      where: { id: responsibilityId },
    });

    // Pause responsibility
    const pauseRes = await handleResponsibilityAction(adminId, responsibilityId, {
      workspaceId,
      expectedVersion: currentResp.version,
      action: "pause",
    });

    assert.equal(pauseRes.responsibility.status, "paused");

    // Check that scheduled check returns paused and performs no side effects
    const scheduledSlot = new Date("2026-10-01T00:00:00Z");
    const checkOutcome = await executeScheduledDataHealthCheck({
      workspaceId,
      responsibilityId,
      scheduledSlot,
    });

    assert.equal(checkOutcome.status, "paused");
    assert.equal(checkOutcome.caseOpenedOrUpdated, false);

    // Summary reflects paused status
    const summary = await getAgentConsoleOperationalSummary(workspaceId);
    assert.equal(summary.schedulerStatus, "paused");
    assert.ok(summary.activeBlockers.some((b) => b.includes("RESPONSIBILITY_PAUSED")));

    // Inspect persisted events history
    const events = await db.agentConsoleEvent.findMany({
      where: { workspaceId, responsibilityId },
      orderBy: { sequence: "asc" },
    });
    assert.ok(events.length >= 2, "Persisted event history is intact");
  });

  it("Step 8: Failure scenarios: cross-workspace rejection, expired auth, changed scope, and duplicate idempotency", async () => {
    // 8a. Cross-workspace access fails closed
    await assert.rejects(
      () =>
        executeScheduledDataHealthCheck({
          workspaceId: foreignWorkspaceId, // Wrong workspace
          responsibilityId,
        }),
      /Responsibility not found in workspace/
    );

    await assert.rejects(
      () =>
        prepareCaseRecovery({
          workspaceId: foreignWorkspaceId,
          caseId: detectedCaseId,
          userId: foreignOwnerId,
        }),
      /Case not found/
    );

    // 8b. Nonmember requesting summary fails closed with 403
    await assert.rejects(
      () => getAgentConsoleOperationalSummary(workspaceId, foreignOwnerId),
      /Workspace access required/
    );

    // 8c. Expired authorization blocks scheduled check and flags incident
    const pausedResp = await db.agentResponsibility.findUniqueOrThrow({
      where: { id: responsibilityId },
    });

    // Resume responsibility first
    await handleResponsibilityAction(adminId, responsibilityId, {
      workspaceId,
      expectedVersion: pausedResp.version,
      action: "resume",
    });

    // Expire authorization
    await db.agentAuthorization.updateMany({
      where: { workspaceId, responsibilityId },
      data: { expiresAt: new Date(Date.now() - 3600000) }, // Expired 1h ago
    });

    const expOutcome = await executeScheduledDataHealthCheck({
      workspaceId,
      responsibilityId,
      now: new Date(),
    });

    assert.equal(expOutcome.status, "incident_detected");
    assert.equal(expOutcome.blockerCode, "AUTHORIZATION_EXPIRED");

    // 8d. Fencing check: Pause between preparation and dispatch blocks execution
    // Reset authorization to valid unexpired
    await db.agentAuthorization.updateMany({
      where: { workspaceId, responsibilityId },
      data: { expiresAt: new Date(Date.now() + 86400000) },
    });

    // Reset case to investigating so prepareCaseRecovery succeeds with a fresh operation key
    await db.agentCase.update({
      where: { workspaceId_id: { workspaceId, id: detectedCaseId } },
      data: { state: "investigating", version: { increment: 1 } },
    });

    // Prepare a fresh recovery operation
    const prepOutcome = await prepareCaseRecovery({
      workspaceId,
      caseId: detectedCaseId,
      userId: adminId,
    });
    const opToDispatch = (prepOutcome.operation as any).id;

    // Now pause the responsibility
    const respBeforePause = await db.agentResponsibility.findUniqueOrThrow({
      where: { id: responsibilityId },
    });
    await handleResponsibilityAction(adminId, responsibilityId, {
      workspaceId,
      expectedVersion: respBeforePause.version,
      action: "pause",
    });

    // Attempt dispatch while paused -> must throw responsibility_not_active
    await assert.rejects(
      () =>
        executeRecoveryImportOperation({
          workspaceId,
          operationId: opToDispatch,
          userId: adminId,
        }),
      /Responsibility is paused/
    );

    // Resume responsibility
    const respAfterPause = await db.agentResponsibility.findUniqueOrThrow({
      where: { id: responsibilityId },
    });
    await handleResponsibilityAction(adminId, responsibilityId, {
      workspaceId,
      expectedVersion: respAfterPause.version,
      action: "resume",
    });

    // 8e. Scope change between preparation and dispatch blocks execution
    await db.agentResponsibility.update({
      where: { workspaceId_id: { workspaceId, id: responsibilityId } },
      data: { scopeHash: "tampered_scope_hash_after_prep" },
    });

    await assert.rejects(
      () =>
        executeRecoveryImportOperation({
          workspaceId,
          operationId: opToDispatch,
          userId: adminId,
        }),
      /Responsibility scope changed after operation preparation/
    );

    // 8f. Authoritative verification: non-existent job throws job_not_found; existing unrelated job cannot close case
    await assert.rejects(
      () =>
        verifyRecoveryAndCloseCase({
          workspaceId,
          caseId: detectedCaseId,
          jobId: "unrelated-fake-job-id",
        }),
      /Recovery job not found/
    );

    // Create a real existing job that is NOT bound to this case/operation
    const unrelatedRealJob = await db.warehouseImportJob.create({
      data: {
        id: `job-unbound-${suffix}`,
        workspaceId,
        userId: adminId,
        plan: "professional",
        since: "2026-09-01",
        until: "2026-09-10",
        status: "completed",
        items: [{ connectionId: connTikTokId, accountId: "tt_adv_202" }],
        results: [{ connectionId: connTikTokId, accountId: "tt_adv_202", ok: true, outcome: "success" }],
      },
    });

    const unboundOutcome = await verifyRecoveryAndCloseCase({
      workspaceId,
      caseId: detectedCaseId,
      jobId: unrelatedRealJob.id,
    });
    assert.equal(unboundOutcome.verified, false);
    assert.equal(unboundOutcome.caseClosed, false);
    assert.ok(unboundOutcome.reasons.some((r) => r.includes("not bound to an operation")));

    // 8g. Authoritative verification: wrong window (job covers narrower window than operation)
    // Create an operation with window 2026-09-01 to 2026-09-10
    const jobWrongWindow = await db.warehouseImportJob.create({
      data: {
        id: `job-wrong-win-${suffix}`,
        workspaceId,
        userId: adminId,
        plan: "professional",
        since: "2026-09-05", // Narrower since
        until: "2026-09-08", // Narrower until
        status: "completed",
        items: [{ connectionId: connTikTokId, accountId: "tt_adv_202" }],
        results: [{ connectionId: connTikTokId, accountId: "tt_adv_202", ok: true, outcome: "success" }],
      },
    });

    // Bind operation with wider window
    await db.agentOperation.create({
      data: {
        id: `op-wrong-win-${suffix}`,
        workspaceId,
        caseId: detectedCaseId,
        operationKey: `op_key_wrong_win_${suffix}`,
        toolName: "submit_recovery_import",
        jobReference: jobWrongWindow.id,
        arguments: {
          connectionId: connTikTokId,
          accountIds: ["tt_adv_202"],
          since: "2026-09-01",
          until: "2026-09-10",
        },
        state: "running",
        scopeHash: "test_scope_hash",
        policyRevision: 1,
      },
    });

    const wrongWinOutcome = await verifyRecoveryAndCloseCase({
      workspaceId,
      caseId: detectedCaseId,
      jobId: jobWrongWindow.id,
    });
    assert.equal(wrongWinOutcome.verified, false);
    assert.equal(wrongWinOutcome.caseClosed, false);
    assert.ok(wrongWinOutcome.reasons.some((r) => r.includes("does not cover requested since window")));

    // 8h. Authoritative verification: empty results array cannot close case
    const jobEmpty = await db.warehouseImportJob.create({
      data: {
        id: `job-empty-${suffix}`,
        workspaceId,
        userId: adminId,
        plan: "professional",
        since: "2026-09-01",
        until: "2026-09-10",
        status: "completed",
        items: [{ connectionId: connTikTokId, accountId: "tt_adv_202" }],
        results: [],
      },
    });
    await db.agentOperation.create({
      data: {
        id: `op-empty-${suffix}`,
        workspaceId,
        caseId: detectedCaseId,
        operationKey: `op_key_empty_${suffix}`,
        toolName: "submit_recovery_import",
        jobReference: jobEmpty.id,
        arguments: {
          connectionId: connTikTokId,
          accountIds: ["tt_adv_202"],
          since: "2026-09-01",
          until: "2026-09-10",
        },
        state: "running",
        scopeHash: "test_scope_hash",
        policyRevision: 1,
      },
    });

    const emptyOutcome = await verifyRecoveryAndCloseCase({
      workspaceId,
      caseId: detectedCaseId,
      jobId: jobEmpty.id,
    });
    assert.equal(emptyOutcome.verified, false);
    assert.equal(emptyOutcome.caseClosed, false);
    assert.ok(emptyOutcome.reasons.some((r) => r.includes("empty")));

    // 8i. Bounded catch-up: scheduler evaluates latest scheduledSlot without cascading replay
    // Re-activate valid authorization
    await db.agentAuthorization.updateMany({
      where: { workspaceId, responsibilityId },
      data: { expiresAt: new Date(Date.now() + 86400000) },
    });
    // Ensure responsibility scope is reset to valid hash
    const resetScopes = await db.agentResponsibilityScope.findMany({
      where: { workspaceId, responsibilityId, scopeRevision: 1 },
    });
    const validScopeHash = computeCanonicalScopeHash(
      resetScopes.map((s) => ({
        provider: s.provider,
        connectionId: s.connectionId,
        providerAccountId: s.providerAccountId,
      }))
    );
    await db.agentResponsibility.update({
      where: { workspaceId_id: { workspaceId, id: responsibilityId } },
      data: { scopeHash: validScopeHash, status: "active" },
    });

    // Run scheduled check with an overdue slot; it updates nextDueAt forward by exactly 24h
    const catchupTime = new Date(Date.now() + 86400000 * 2);
    const catchupSlot = new Date(Math.floor(catchupTime.getTime() / 86400000) * 86400000);
    const catchupOutcome = await executeScheduledDataHealthCheck({
      workspaceId,
      responsibilityId,
      scheduledSlot: catchupSlot,
      now: catchupTime,
    });
    assert.ok(catchupOutcome.status === "success" || catchupOutcome.status === "incident_detected");
    const respAfterCatchup = await db.agentResponsibility.findUniqueOrThrow({
      where: { id: responsibilityId },
    });
    // nextDueAt should be forward (bounded forward schedule, no infinite loop)
    assert.ok(respAfterCatchup.nextDueAt && respAfterCatchup.nextDueAt.getTime() > catchupTime.getTime());

    // 8j. Lost lease / crashed operation reconciliation: non-queued operation cannot be dispatched
    const crashedOp = await db.agentOperation.create({
      data: {
        id: `op-crashed-${suffix}`,
        workspaceId,
        caseId: detectedCaseId,
        operationKey: `op_key_crashed_${suffix}`,
        toolName: "submit_recovery_import",
        arguments: { connectionId: connTikTokId, accountIds: ["tt_adv_202"], since: "2026-09-01", until: "2026-09-10" },
        state: "failed", // Crashed worker left operation in 'failed' state
        scopeHash: validScopeHash,
        policyRevision: 1,
      },
    });

    await assert.rejects(
      () =>
        executeRecoveryImportOperation({
          workspaceId,
          operationId: crashedOp.id,
          userId: adminId,
        }),
      /Operation state must be 'queued' to dispatch, got 'failed'/
    );

    // 8k. Gate 1: Recovery permission fails closed when limits omit permittedRecoveryModes or requested mode disallowed
    await db.agentAuthorization.updateMany({
      where: { workspaceId, responsibilityId },
      data: {
        limits: {}, // No permittedRecoveryModes configured!
      },
    });

    // Reopen case for testing
    const reopenCase = await db.agentCase.create({
      data: {
        workspaceId,
        responsibilityId,
        fingerprint: `fp:test_modes:${suffix}`,
        type: "source_health",
        priority: "high",
        state: "detected",
        title: "Test mode permission gate",
        description: "Testing fail closed mode permission",
        requiredAction: "recovery_import",
      },
    });

    await assert.rejects(
      () =>
        prepareCaseRecovery({
          workspaceId,
          caseId: reopenCase.id,
          userId: adminId,
          mode: "retry_failed_window",
        }),
      /No recovery modes are permitted by active policy/
    );

    // Restore permitted modes
    await db.agentAuthorization.updateMany({
      where: { workspaceId, responsibilityId },
      data: {
        limits: { permittedRecoveryModes: ["retry_failed_window"] },
      },
    });

    // Requesting unpermitted mode ("full_window_reimport") fails closed
    await assert.rejects(
      () =>
        prepareCaseRecovery({
          workspaceId,
          caseId: reopenCase.id,
          userId: adminId,
          mode: "full_window_reimport",
        }),
      /Recovery mode 'full_window_reimport' is not permitted by active policy limits/
    );

    // 8l. Gate 2: Scheduled check uses shared verifier; connection freshness alone CANNOT close case if warehouse metrics or data-through are missing
    const unverifiedCase = await db.agentCase.create({
      data: {
        workspaceId,
        responsibilityId,
        fingerprint: `fp:source_health:${connMetaId}:act_101`,
        type: "source_health",
        priority: "high",
        state: "detected",
        title: "Meta ads missing coverage",
        description: "Meta connection is fresh but warehouse has no rows for act_101",
        requiredAction: "recovery_import",
      },
    });

    // Meta connection is connected, but has no CampaignMetric rows in DB for act_101
    await db.campaignMetric.deleteMany({
      where: { workspaceId, connectionId: connMetaId, accountId: "act_101" },
    });

    const schedTime1 = new Date(Date.now() + 86400000 * 5);
    const schedSlot1 = new Date(Math.floor(schedTime1.getTime() / 86400000) * 86400000);
    await executeScheduledDataHealthCheck({
      workspaceId,
      responsibilityId,
      scheduledSlot: schedSlot1,
      now: schedTime1,
    });

    // Case must NOT be closed because shared verifier detected metricCount === 0 and no zero receipts
    const unverifiedCheck = await db.agentCase.findUniqueOrThrow({
      where: { id: unverifiedCase.id },
    });
    assert.notEqual(unverifiedCheck.state, "resolved", "Scheduled check must NOT close case without warehouse coverage or zero receipts");

    // Now insert metric rows for act_101 and update lastDataThrough to cover yesterday
    const schedTime2 = new Date(Date.now() + 86400000 * 6);
    const schedSlot2 = new Date(Math.floor(schedTime2.getTime() / 86400000) * 86400000);
    const yesterdayDate = new Date(schedTime2.getTime() - 86400000);

    // Update both scoped connections (connMetaId and connTikTokId) to be fresh relative to schedTime2
    await db.connection.update({
      where: { id: connMetaId },
      data: {
        status: "connected",
        lastSyncAt: schedTime2,
        lastDataThrough: yesterdayDate,
        lastError: null,
      },
    });
    await db.connection.update({
      where: { id: connTikTokId },
      data: {
        status: "connected",
        lastSyncAt: schedTime2,
        lastDataThrough: yesterdayDate,
        lastError: null,
      },
    });

    await db.campaignMetric.create({
      data: {
        workspaceId,
        connectionId: connMetaId,
        platform: "meta_ads",
        accountId: "act_101",
        currency: "USD",
        spend: 200,
        conversions: 5,
        date: yesterdayDate,
        level: "account",
        entityId: "act_101",
      },
    });

    // Ensure authorization is valid for schedTime2
    await db.agentAuthorization.updateMany({
      where: { workspaceId, responsibilityId },
      data: { expiresAt: new Date(schedTime2.getTime() + 86400000) },
    });

    // Run scheduled check again with a subsequent distinct slot
    const schedResult2 = await executeScheduledDataHealthCheck({
      workspaceId,
      responsibilityId,
      scheduledSlot: schedSlot2,
      now: schedTime2,
    });
    assert.equal(schedResult2.caseResolved, true, `Expected case to be resolved, got ${JSON.stringify(schedResult2)}`);

    const verifiedCheck = await db.agentCase.findUniqueOrThrow({
      where: { id: unverifiedCase.id },
    });
    assert.equal(verifiedCheck.state, "resolved", "Scheduled check closed case after shared verifier confirmed coverage");

    // 8m. Gate 3: Lost lease / crash after submission and restart reconciliation
    const leasedOp = await db.agentOperation.create({
      data: {
        id: `op-leased-${suffix}`,
        workspaceId,
        caseId: reopenCase.id,
        operationKey: `op_key_leased_${suffix}`,
        toolName: "submit_recovery_import",
        arguments: { connectionId: connTikTokId, accountIds: ["tt_adv_202"] },
        state: "running",
        attempts: 0,
        maxAttempts: 3,
        leaseOwner: "worker-process-crash-1",
        leaseExpiresAt: new Date(Date.now() - 5000), // Lease expired 5s ago due to worker crash
        scopeHash: validScopeHash,
        policyRevision: 1,
      },
    });

    // Reconcile lost leases: first attempt requeues operation
    const recon1 = await agentConsoleTransaction((tx) =>
      reconcileLostOperationLeases(tx, { workspaceId, now: new Date() })
    );
    assert.equal(recon1.requeuedCount, 1);
    const opRequeued = await db.agentOperation.findUniqueOrThrow({ where: { id: leasedOp.id } });
    assert.equal(opRequeued.state, "queued");
    assert.equal(opRequeued.attempts, 1);
    assert.equal(opRequeued.leaseOwner, null);

    // Simulate crash on final attempt
    await db.agentOperation.update({
      where: { id: leasedOp.id },
      data: {
        state: "running",
        attempts: 2,
        leaseOwner: "worker-process-crash-2",
        leaseExpiresAt: new Date(Date.now() - 5000),
      },
    });

    // 8n. Negative tests: verifier rejects shortcuts (out-of-window rows, partial account coverage, invalid zero receipts)
    // 1) Out-of-window rows must NOT satisfy verifier
    const outOfWindowRes = await agentConsoleTransaction((tx) =>
      verifyTargetDataHealthAndCoverage(tx, {
        workspaceId,
        connectionId: connMetaId,
        accountIds: ["act_101"],
        expectedSince: "2026-08-01",
        expectedUntil: "2026-08-05", // No rows in this window
      })
    );
    assert.equal(outOfWindowRes.verified, false, "Out-of-window rows must NOT satisfy coverage");
    assert.ok(outOfWindowRes.reasons.some((r) => r.includes("Missing warehouse coverage")));

    // 2) Partial account coverage (1 of 2 accounts covered) must NOT satisfy verifier
    const partialAccountRes = await agentConsoleTransaction((tx) =>
      verifyTargetDataHealthAndCoverage(tx, {
        workspaceId,
        connectionId: connTikTokId,
        accountIds: ["tt_adv_202", "tt_uncovered_999"], // tt_uncovered_999 has no rows
        expectedSince: "2026-09-20",
        expectedUntil: "2026-09-27",
      })
    );
    assert.equal(partialAccountRes.verified, false, "Partial account coverage must NOT satisfy verifier");
    assert.ok(partialAccountRes.reasons.some((r) => r.includes("tt_uncovered_999")));

    // 3) Invalid zero-activity receipt (mismatched provider/account/date/origin) rejected
    await db.agentEvidenceSnapshot.create({
      data: {
        workspaceId,
        datasetFingerprint: `ds_fp_bad_${suffix}`,
        grain: "account",
        metrics: {},
        inventory: {},
        actualSince: new Date("2026-09-20T00:00:00Z"),
        actualUntil: new Date("2026-09-27T00:00:00Z"),
        isExpired: false,
        provenance: {
          zeroActivityReceipts: [
            {
              canonicalAccountId: "meta_ads:conn_fake:act_mismatch",
              accountId: "act_mismatch",
              date: "2026-09-25",
              provider: "wrong_provider", // Mismatched provider
              origin: "unverified", // Non-authoritative origin
            },
          ],
        },
      },
    });

    const badReceiptRes = await agentConsoleTransaction((tx) =>
      verifyTargetDataHealthAndCoverage(tx, {
        workspaceId,
        connectionId: connMetaId,
        accountIds: ["act_mismatch"],
        expectedSince: "2026-09-25",
        expectedUntil: "2026-09-25",
      })
    );
    assert.equal(badReceiptRes.verified, false, "Invalid zero receipt must NOT satisfy verifier");

    // 4) Valid zero-activity receipt with verified origin satisfies gap
    await db.agentEvidenceSnapshot.create({
      data: {
        workspaceId,
        datasetFingerprint: `ds_fp_good_${suffix}`,
        grain: "account",
        metrics: {},
        inventory: {},
        actualSince: new Date("2026-09-25T00:00:00Z"),
        actualUntil: new Date("2026-09-25T00:00:00Z"),
        isExpired: false,
        provenance: {
          zeroActivityReceipts: [
            {
              canonicalAccountId: `meta_ads:${connMetaId}:act_zero_verified`,
              accountId: "act_zero_verified",
              connectionId: connMetaId,
              date: "2026-09-25",
              provider: "meta_ads",
              origin: "verified",
              verifiedAt: new Date().toISOString(),
              receiptId: `rcpt_${suffix}`,
            },
          ],
        },
      },
    });

    const goodReceiptRes = await agentConsoleTransaction((tx) =>
      verifyTargetDataHealthAndCoverage(tx, {
        workspaceId,
        connectionId: connMetaId,
        accountIds: ["act_zero_verified"],
        expectedSince: "2026-09-25",
        expectedUntil: "2026-09-25",
      })
    );
    assert.equal(goodReceiptRes.verified, true, "Valid zero receipt with verified origin must satisfy verifier");

    // 8o. Gate 2/3: Worker lease fencing rejects stale worker writes
    const fencedOp = await db.agentOperation.create({
      data: {
        id: `op-fenced-${suffix}`,
        workspaceId,
        caseId: reopenCase.id,
        operationKey: `op_key_fenced_${suffix}`,
        toolName: "submit_recovery_import",
        arguments: { connectionId: connTikTokId, accountIds: ["tt_adv_202"] },
        state: "running",
        attempts: 1,
        maxAttempts: 3,
        leaseOwner: "active-worker-A",
        leaseExpiresAt: new Date(Date.now() + 60000), // Active lease for worker A
        scopeHash: validScopeHash,
        policyRevision: 1,
      },
    });

    // Stale worker B attempts write -> rejected with lease_fencing_conflict (409)
    await assert.rejects(
      () =>
        agentConsoleTransaction((tx) =>
          updateOperationWithFencedLease(tx, {
            workspaceId,
            operationId: fencedOp.id,
            workerId: "stale-worker-B",
            data: { state: "completed" },
          })
        ),
      /Stale worker write rejected: lease is owned by 'active-worker-A', expected 'stale-worker-B'/
    );

    // Active worker A writes before expiry -> succeeds
    const successWrite = await agentConsoleTransaction((tx) =>
      updateOperationWithFencedLease(tx, {
        workspaceId,
        operationId: fencedOp.id,
        workerId: "active-worker-A",
        data: { state: "completed" },
      })
    );
    assert.equal(successWrite.state, "completed");

    // Write after lease expiry -> rejected with lease_fencing_conflict (409)
    await db.agentOperation.update({
      where: { id: fencedOp.id },
      data: { leaseExpiresAt: new Date(Date.now() - 5000) },
    });
    await assert.rejects(
      () =>
        agentConsoleTransaction((tx) =>
          updateOperationWithFencedLease(tx, {
            workspaceId,
            operationId: fencedOp.id,
            workerId: "active-worker-A",
            data: { state: "failed" },
          })
        ),
      /Stale worker write rejected: lease expired/
    );

    // 8p. Gate 3: Crash after submission recovers existing job identity without duplicate dispatch
    const crashJob = await db.warehouseImportJob.create({
      data: {
        id: `job-crash-${suffix}`,
        workspaceId,
        userId: adminId,
        plan: "professional",
        since: "2026-09-20",
        until: "2026-09-27",
        items: [{ connectionId: connTikTokId, accountId: "tt_adv_202" }],
        status: "queued",
        idempotencyKey: `recov_job_crash_${suffix}`,
      },
    });

    const crashOp = await db.agentOperation.create({
      data: {
        id: `op-crash-${suffix}`,
        workspaceId,
        caseId: reopenCase.id,
        operationKey: `op_key_crash_${suffix}`,
        toolName: "submit_recovery_import",
        arguments: {
          workspaceId,
          responsibilityId,
          caseId: reopenCase.id,
          mode: "retry_failed_window",
          provider: "tiktok_business",
          connectionId: connTikTokId,
          accountIds: ["tt_adv_202"],
          since: "2026-09-20",
          until: "2026-09-27",
          idempotencyKey: `recov_job_crash_${suffix}`,
        },
        state: "queued",
        jobReference: crashJob.id, // Job was submitted before crash occurred!
        attempts: 1,
        maxAttempts: 3,
        scopeHash: validScopeHash,
        policyRevision: 1,
      },
    });

    // Ensure authorization valid
    await db.agentAuthorization.updateMany({
      where: { workspaceId, responsibilityId },
      data: { expiresAt: new Date(Date.now() + 86400000) },
    });

    const totalJobsBefore = await db.warehouseImportJob.count({ where: { workspaceId } });

    // Execute recovery import after crash reconciliation: must recover existing job without creating duplicate
    const dispatchRecovered = await executeRecoveryImportOperation({
      workspaceId,
      operationId: crashOp.id,
      userId: adminId,
      workerId: "worker-recovery-restart",
    });

    assert.equal(dispatchRecovered.jobId, crashJob.id, "Must recover existing job identity");
    const totalJobsAfter = await db.warehouseImportJob.count({ where: { workspaceId } });
    assert.equal(totalJobsAfter, totalJobsBefore, "Must NOT create duplicate import job on recovery dispatch");

    const recoveredOp = await db.agentOperation.findUniqueOrThrow({ where: { id: crashOp.id } });
    assert.equal(recoveredOp.state, "running");
    assert.equal(recoveredOp.leaseOwner, "worker-recovery-restart");
    assert.equal(recoveredOp.jobReference, crashJob.id);
  });

  it("Step 9: Scheduler outage leaves work pending; restored cron performs one bounded catch-up", async () => {
    const previous = {
      monitoring: process.env.ENABLE_AGENT_CONSOLE_MONITORING,
      worker: process.env.ENABLE_AGENT_CONSOLE_WORKER,
      scopedSecret: process.env.CRON_SECRET_AGENT_CONSOLE,
      legacySecret: process.env.CRON_SECRET,
      legacyFallback: process.env.CRON_ALLOW_LEGACY_SHARED_SECRET,
      workspaceCohort: process.env.AGENT_CONSOLE_WORKSPACE_IDS,
    };
    const cronSecret = "agent-console-isolated-test-secret-32chars";
    const overdueAt = new Date(Date.now() - 48 * 60 * 60 * 1000);

    try {
      await db.agentResponsibility.update({
        where: { workspaceId_id: { workspaceId, id: responsibilityId } },
        data: { status: "active", nextDueAt: overdueAt },
      });
      const outsideCohortResponsibility = await agentConsoleTransaction((tx) => createResponsibility(tx, {
        workspaceId: foreignWorkspaceId,
        ownerId: foreignOwnerId,
        createdByUserId: foreignOwnerId,
        kind: "data_health",
        cadence: "daily",
        configuration: {},
      }));
      await db.agentResponsibility.update({
        where: { workspaceId_id: { workspaceId: foreignWorkspaceId, id: outsideCohortResponsibility.id } },
        data: { status: "active", nextDueAt: overdueAt },
      });
      const beforeCount = await db.agentEvaluation.count({ where: { workspaceId, responsibilityId } });

      process.env.CRON_SECRET_AGENT_CONSOLE = cronSecret;
      process.env.CRON_ALLOW_LEGACY_SHARED_SECRET = "0";
      process.env.AGENT_CONSOLE_WORKSPACE_IDS = workspaceId;
      process.env.ENABLE_AGENT_CONSOLE_WORKER = "1";
      process.env.ENABLE_AGENT_CONSOLE_MONITORING = "0";
      const offlineResponse = await runAgentConsoleCronGet(new Request("http://localhost/api/agent-console/cron", {
        headers: { Authorization: `Bearer ${cronSecret}` },
      }));
      assert.equal(offlineResponse.status, 503);
      const offlinePayload = await offlineResponse.json();
      assert.equal(offlinePayload.status, "unavailable");
      assert.equal(offlinePayload.executedCount, 0);
      const stillPending = await db.agentResponsibility.findUniqueOrThrow({
        where: { id: responsibilityId },
      });
      assert.equal(stillPending.nextDueAt?.getTime(), overdueAt.getTime(), "outage must not advance the check schedule");
      assert.equal(await db.agentEvaluation.count({ where: { workspaceId, responsibilityId } }), beforeCount);

      process.env.ENABLE_AGENT_CONSOLE_MONITORING = "1";
      const restoredResponse = await runAgentConsoleCronGet(new Request("http://localhost/api/agent-console/cron", {
        headers: { Authorization: `Bearer ${cronSecret}` },
      }));
      assert.equal(restoredResponse.status, 200);
      const restoredPayload = await restoredResponse.json();
      assert.equal(restoredPayload.executedCount, 1, "restored scheduler should process one bounded catch-up check");
      assert.equal(restoredPayload.results.length, 1);
      assert.ok(["success", "incident_detected", "delayed", "paused", "error"].includes(restoredPayload.results[0].outcome), JSON.stringify(restoredPayload));
      const caughtUpEvaluation = await db.agentEvaluation.findFirst({
        where: { workspaceId, responsibilityId, scheduledSlot: overdueAt },
      });
      assert.ok(caughtUpEvaluation, "catch-up evaluation must retain the missed due slot as its evidence time");
      const afterCatchup = await db.agentResponsibility.findUniqueOrThrow({
        where: { id: responsibilityId },
      });
      assert.ok(afterCatchup.nextDueAt && afterCatchup.nextDueAt.getTime() > Date.now(), "restored work advances the next due time");
      const afterCount = await db.agentEvaluation.count({ where: { workspaceId, responsibilityId } });
      assert.equal(afterCount, beforeCount + 1, "the missed slot is evaluated once without colliding with today's slot");
      const outsideCohort = await db.agentResponsibility.findUniqueOrThrow({
        where: { id: outsideCohortResponsibility.id },
      });
      assert.equal(outsideCohort.nextDueAt?.getTime(), overdueAt.getTime(), "the dispatcher must leave non-cohort responsibilities untouched");

      const repeatedResponse = await runAgentConsoleCronGet(new Request("http://localhost/api/agent-console/cron", {
        headers: { Authorization: `Bearer ${cronSecret}` },
      }));
      assert.equal(repeatedResponse.status, 200);
      const repeatedPayload = await repeatedResponse.json();
      assert.equal(repeatedPayload.executedCount, 0, "repeated dispatch must not replay or duplicate the completed catch-up");
      assert.equal(await db.agentEvaluation.count({ where: { workspaceId, responsibilityId } }), afterCount);
    } finally {
      for (const [key, value] of [
        ["ENABLE_AGENT_CONSOLE_MONITORING", previous.monitoring],
        ["ENABLE_AGENT_CONSOLE_WORKER", previous.worker],
        ["CRON_SECRET_AGENT_CONSOLE", previous.scopedSecret],
        ["CRON_SECRET", previous.legacySecret],
        ["CRON_ALLOW_LEGACY_SHARED_SECRET", previous.legacyFallback],
        ["AGENT_CONSOLE_WORKSPACE_IDS", previous.workspaceCohort],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("Step 10: Disabled monitoring cannot be approved or resumed", async () => {
    const previous = {
      monitoring: process.env.ENABLE_AGENT_CONSOLE_MONITORING,
      worker: process.env.ENABLE_AGENT_CONSOLE_WORKER,
    };
    try {
      process.env.ENABLE_AGENT_CONSOLE_MONITORING = "0";
      process.env.ENABLE_AGENT_CONSOLE_WORKER = "1";

      const draft = await agentConsoleTransaction((tx) => createResponsibility(tx, {
        workspaceId,
        clientId,
        ownerId: adminId,
        createdByUserId: adminId,
        kind: "data_health",
        cadence: "daily",
        configuration: { permittedRecoveryModes: ["retry_failed_window"] },
      }));
      const scopeItems = [
        { provider: "meta_ads", connectionId: connMetaId, providerAccountId: "act_101" },
      ];
      await agentConsoleTransaction((tx) => setResponsibilityScope(tx, {
        workspaceId,
        responsibilityId: draft.id,
        scopeRevision: 1,
        items: scopeItems,
      }));

      await assert.rejects(
        () => confirmResponsibilityAction(adminId, draft.id, {
          workspaceId,
          expectedVersion: draft.version,
          scopeHash: computeCanonicalScopeHash(scopeItems),
          allowlistedTools: ["inspect_source", "query_coverage"],
          allowedPairs: scopeItems,
        }),
        (error: unknown) => error instanceof Error && "status" in error && error.status === 503
      );
      const stillDraft = await db.agentResponsibility.findUniqueOrThrow({ where: { id: draft.id } });
      assert.equal(stillDraft.status, "draft");

      const current = await db.agentResponsibility.findUniqueOrThrow({ where: { id: responsibilityId } });
      if (current.status === "active") {
        await handleResponsibilityAction(adminId, responsibilityId, {
          workspaceId,
          expectedVersion: current.version,
          action: "pause",
        });
      }
      const paused = await db.agentResponsibility.findUniqueOrThrow({ where: { id: responsibilityId } });
      assert.equal(paused.status, "paused");
      await assert.rejects(
        () => handleResponsibilityAction(adminId, responsibilityId, {
          workspaceId,
          expectedVersion: paused.version,
          action: "resume",
        }),
        (error: unknown) => error instanceof Error && "status" in error && error.status === 503
      );
      const remainsPaused = await db.agentResponsibility.findUniqueOrThrow({ where: { id: responsibilityId } });
      assert.equal(remainsPaused.status, "paused");
    } finally {
      for (const [key, value] of [
        ["ENABLE_AGENT_CONSOLE_MONITORING", previous.monitoring],
        ["ENABLE_AGENT_CONSOLE_WORKER", previous.worker],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
