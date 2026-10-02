process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/monstera_c2_test";
process.env.DIRECT_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { setAuthSessionOverride } from "@/lib/auth-session";

// Route handlers
import { POST as createResponsibilityPost, GET as listResponsibilitiesGet } from "@/app/api/agent-console/responsibilities/route";
import { POST as confirmResponsibilityPost } from "@/app/api/agent-console/responsibilities/[id]/confirm/route";
import { POST as handleResponsibilityActionPost } from "@/app/api/agent-console/responsibilities/[id]/actions/route";
import { GET as listCasesGet } from "@/app/api/agent-console/cases/route";
import { GET as getCaseDetailGet } from "@/app/api/agent-console/cases/[id]/route";
import { POST as handleCaseActionPost } from "@/app/api/agent-console/cases/[id]/actions/route";
import { POST as approveOperationPost } from "@/app/api/agent-console/operations/[id]/approve/route";
import { GET as getEvidenceGet } from "@/app/api/agent-console/evidence/[id]/route";
import { computeCanonicalScopeHash } from "@/lib/agent-console/persistence";

describe("C2 Scoped HTTP API Route Handlers against real PostgreSQL", () => {
  const initialMonitoringFlag = process.env.ENABLE_AGENT_CONSOLE_MONITORING;
  const initialWorkerFlag = process.env.ENABLE_AGENT_CONSOLE_WORKER;
  const initialWorkspaceCohort = process.env.AGENT_CONSOLE_WORKSPACE_IDS;
  const db = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/monstera_c2_test",
      },
    },
  });

  const suffix = randomUUID();
  const ownerId = `u-api-owner-${suffix}`;
  const adminId = `u-api-admin-${suffix}`;
  const memberId = `u-api-member-${suffix}`;
  const viewerId = `u-api-viewer-${suffix}`;
  const outsiderId = `u-api-outsider-${suffix}`;

  const workspaceIdA = `ws-api-a-${suffix}`;
  const workspaceIdB = `ws-api-b-${suffix}`;
  const clientIdA = `client-api-a-${suffix}`;
  const connectionIdA = `conn-api-a-${suffix}`;
  const connectionIdB = `conn-api-b-${suffix}`;

  before(async () => {
    process.env.ENABLE_AGENT_CONSOLE = "1";
    process.env.ENABLE_AGENT_CONSOLE_MONITORING = "1";
    process.env.ENABLE_AGENT_CONSOLE_WORKER = "1";
    process.env.AGENT_CONSOLE_WORKSPACE_IDS = workspaceIdA;
    await db.$connect();

    // Create users
    for (const [id, email] of [
      [ownerId, `owner-${suffix}@example.test`],
      [adminId, `admin-${suffix}@example.test`],
      [memberId, `member-${suffix}@example.test`],
      [viewerId, `viewer-${suffix}@example.test`],
      [outsiderId, `outsider-${suffix}@example.test`],
    ]) {
      await db.user.create({ data: { id, email, name: id, plan: "professional" } });
    }

    // Create workspaces
    await db.workspace.create({
      data: { id: workspaceIdA, name: "Workspace A", slug: `ws-api-a-${suffix}`, ownerId },
    });
    await db.workspace.create({
      data: { id: workspaceIdB, name: "Workspace B", slug: `ws-api-b-${suffix}`, ownerId: outsiderId },
    });

    // Workspace memberships
    await db.workspaceMember.createMany({
      data: [
        { workspaceId: workspaceIdA, userId: ownerId, role: "owner" },
        { workspaceId: workspaceIdA, userId: adminId, role: "admin" },
        { workspaceId: workspaceIdA, userId: memberId, role: "member" },
        { workspaceId: workspaceIdA, userId: viewerId, role: "viewer" },
        { workspaceId: workspaceIdB, userId: outsiderId, role: "owner" },
      ],
    });

    // Client and Connection in Workspace A
    await db.client.create({
      data: { id: clientIdA, workspaceId: workspaceIdA, name: "Client A" },
    });
    await db.connection.create({
      data: {
        id: connectionIdA,
        workspaceId: workspaceIdA,
        name: "Meta Ads Account A",
        type: "meta",
        provider: "meta",
        credentials: "encrypted-token",
        remoteAccountId: "act_12345",
      },
    });

    // Connection in Workspace B
    await db.connection.create({
      data: {
        id: connectionIdB,
        workspaceId: workspaceIdB,
        name: "Meta Ads Account B",
        type: "meta",
        provider: "meta",
        credentials: "encrypted-token",
        remoteAccountId: "act_67890",
      },
    });
  });

  after(async () => {
    setAuthSessionOverride(null);
    delete process.env.ENABLE_AGENT_CONSOLE;
    if (initialMonitoringFlag === undefined) delete process.env.ENABLE_AGENT_CONSOLE_MONITORING;
    else process.env.ENABLE_AGENT_CONSOLE_MONITORING = initialMonitoringFlag;
    if (initialWorkerFlag === undefined) delete process.env.ENABLE_AGENT_CONSOLE_WORKER;
    else process.env.ENABLE_AGENT_CONSOLE_WORKER = initialWorkerFlag;
    if (initialWorkspaceCohort === undefined) delete process.env.AGENT_CONSOLE_WORKSPACE_IDS;
    else process.env.AGENT_CONSOLE_WORKSPACE_IDS = initialWorkspaceCohort;
    // Clean up created test entities
    await db.workspace.deleteMany({ where: { id: { in: [workspaceIdA, workspaceIdB] } } });
    await db.user.deleteMany({ where: { id: { in: [ownerId, adminId, memberId, viewerId, outsiderId] } } });
    await db.$disconnect();
  });

  function setSessionUser(userId: string | null) {
    if (!userId) {
      setAuthSessionOverride(async () => null);
    } else {
      setAuthSessionOverride(async () => ({
        user: { id: userId, email: `${userId}@example.test` },
        expires: new Date(Date.now() + 86400000).toISOString(),
      }));
    }
  }

  it("1. Feature Flag & Authentication gates: reject disabled flag and unauthenticated requests", async () => {
    // 1a. Feature flag disabled -> 404
    process.env.ENABLE_AGENT_CONSOLE = "0";
    setSessionUser(ownerId);
    const reqFlag = new Request("http://localhost/api/agent-console/responsibilities", {
      method: "POST",
      body: JSON.stringify({ workspaceId: workspaceIdA, configuration: {} }),
      headers: { "Content-Type": "application/json" },
    });
    const resFlag = await createResponsibilityPost(reqFlag);
    assert.equal(resFlag.status, 404);
    const jsonFlag = await resFlag.json();
    assert.equal(jsonFlag.code, "not_found");

    // Re-enable flag
    process.env.ENABLE_AGENT_CONSOLE = "1";

    // 1b. Unauthenticated -> 401
    setSessionUser(null);
    const reqUnauth = new Request("http://localhost/api/agent-console/responsibilities", {
      method: "POST",
      body: JSON.stringify({ workspaceId: workspaceIdA, configuration: {} }),
      headers: { "Content-Type": "application/json" },
    });
    const resUnauth = await createResponsibilityPost(reqUnauth);
    assert.equal(resUnauth.status, 401);
    const jsonUnauth = await resUnauth.json();
    assert.equal(jsonUnauth.code, "unauthorized");
  });

  it("2. RBAC & Tenant isolation: enforce role rules and cross-workspace rejection", async () => {
    // 2a. Viewer cannot create responsibility (requires member/admin/owner)
    setSessionUser(viewerId);
    const reqViewer = new Request("http://localhost/api/agent-console/responsibilities", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        configuration: { budget: 1000 },
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resViewer = await createResponsibilityPost(reqViewer);
    assert.equal(resViewer.status, 403);
    const jsonViewer = await resViewer.json();
    assert.equal(jsonViewer.code, "insufficient_role");

    // 2b. Non-member cannot access workspace resources
    setSessionUser(outsiderId);
    const reqOutsider = new Request(`http://localhost/api/agent-console/responsibilities?workspaceId=${workspaceIdA}`, {
      method: "GET",
    });
    const resOutsider = await listResponsibilitiesGet(reqOutsider);
    assert.equal(resOutsider.status, 403);
    const jsonOutsider = await resOutsider.json();
    assert.equal(jsonOutsider.code, "access_denied");
  });

  let createdResponsibilityId = "";
  let responsibilityVersion = 0;
  let canonicalHash = "";

  it("3. Responsibilities API: draft creation, scope assignment, and listing", async () => {
    setSessionUser(memberId);

    // 3a. Member creates draft responsibility with scope item
    const reqCreate = new Request("http://localhost/api/agent-console/responsibilities", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        clientId: clientIdA,
        kind: "budget_pacing",
        configuration: { pacingMode: "uniform", budgetAmount: 5000, currency: "USD" },
        cadence: "daily",
        timezone: "America/New_York",
        scopeItems: [
          {
            connectionId: connectionIdA,
            provider: "meta",
            providerAccountId: "act_12345",
            accountName: "Meta Client Account",
            currency: "USD",
            timezone: "America/New_York",
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const resCreate = await createResponsibilityPost(reqCreate);
    assert.equal(resCreate.status, 201);
    const jsonCreate = await resCreate.json();
    assert.ok(jsonCreate.responsibility.id);
    assert.equal(jsonCreate.responsibility.status, "draft");
    assert.equal(jsonCreate.scopes.length, 1);
    assert.equal(jsonCreate.scopes[0].providerAccountId, "act_12345");

    createdResponsibilityId = jsonCreate.responsibility.id;
    responsibilityVersion = jsonCreate.responsibility.version;

    // 3b. List responsibilities (as viewer)
    setSessionUser(viewerId);
    const reqList = new Request(`http://localhost/api/agent-console/responsibilities?workspaceId=${workspaceIdA}`, {
      method: "GET",
    });
    const resList = await listResponsibilitiesGet(reqList);
    assert.equal(resList.status, 200);
    const jsonList = await resList.json();
    assert.ok(Array.isArray(jsonList.responsibilities));
    const found = jsonList.responsibilities.find((r: any) => r.id === createdResponsibilityId);
    assert.ok(found);
    assert.equal(found.status, "draft");
    assert.equal(found.scopes.length, 1);
  });

  it("4. Responsibility Confirmation & Stale Version Concurrency", async () => {
    const scopeItems = [
      { provider: "meta", connectionId: connectionIdA, providerAccountId: "act_12345" },
    ];
    canonicalHash = computeCanonicalScopeHash(scopeItems);

    // 4a. Member cannot confirm (requires admin/owner)
    setSessionUser(memberId);
    const reqMemberConfirm = new Request(`http://localhost/api/agent-console/responsibilities/${createdResponsibilityId}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        expectedVersion: responsibilityVersion,
        scopeHash: canonicalHash,
        allowlistedTools: ["inspect_source", "query_metric_window"],
        allowedPairs: scopeItems,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resMemberConfirm = await confirmResponsibilityPost(reqMemberConfirm, {
      params: Promise.resolve({ id: createdResponsibilityId }),
    });
    assert.equal(resMemberConfirm.status, 403);
    const jsonMemberConfirm = await resMemberConfirm.json();
    assert.equal(jsonMemberConfirm.code, "insufficient_role");

    // Negative 4a.1: Invalid tool not in registry -> 422
    setSessionUser(adminId);
    const reqInvalidTool = new Request(`http://localhost/api/agent-console/responsibilities/${createdResponsibilityId}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        expectedVersion: responsibilityVersion,
        scopeHash: canonicalHash,
        allowlistedTools: ["unregistered_malicious_tool"],
        allowedPairs: scopeItems,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resInvalidTool = await confirmResponsibilityPost(reqInvalidTool, {
      params: Promise.resolve({ id: createdResponsibilityId }),
    });
    assert.equal(resInvalidTool.status, 422);
    assert.equal((await resInvalidTool.json()).code, "invalid_tool");

    // Negative 4a.2: Foreign connection in allowedPairs -> 404
    const reqForeignConn = new Request(`http://localhost/api/agent-console/responsibilities/${createdResponsibilityId}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        expectedVersion: responsibilityVersion,
        scopeHash: canonicalHash,
        allowlistedTools: ["inspect_source"],
        allowedPairs: [{ provider: "meta", connectionId: connectionIdB, providerAccountId: "act_12345" }],
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resForeignConn = await confirmResponsibilityPost(reqForeignConn, {
      params: Promise.resolve({ id: createdResponsibilityId }),
    });
    assert.equal(resForeignConn.status, 404);
    assert.equal((await resForeignConn.json()).code, "connection_not_found");

    // Negative 4a.3: Mismatched scopeHash -> 400
    const reqMismatchHash = new Request(`http://localhost/api/agent-console/responsibilities/${createdResponsibilityId}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        expectedVersion: responsibilityVersion,
        scopeHash: "tampered_scope_hash",
        allowlistedTools: ["inspect_source", "query_metric_window"],
        allowedPairs: scopeItems,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resMismatchHash = await confirmResponsibilityPost(reqMismatchHash, {
      params: Promise.resolve({ id: createdResponsibilityId }),
    });
    assert.equal(resMismatchHash.status, 400);
    assert.equal((await resMismatchHash.json()).code, "scope_hash_mismatch");

    // 4b. Admin confirms successfully
    const reqAdminConfirm = new Request(`http://localhost/api/agent-console/responsibilities/${createdResponsibilityId}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        expectedVersion: responsibilityVersion,
        scopeHash: canonicalHash,
        allowlistedTools: ["inspect_source", "query_metric_window"],
        allowedPairs: scopeItems,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resAdminConfirm = await confirmResponsibilityPost(reqAdminConfirm, {
      params: Promise.resolve({ id: createdResponsibilityId }),
    });
    assert.equal(resAdminConfirm.status, 200);
    const jsonAdminConfirm = await resAdminConfirm.json();
    assert.equal(jsonAdminConfirm.responsibility.status, "active");
    assert.equal(jsonAdminConfirm.authorization.policyRevision, 1);

    responsibilityVersion = jsonAdminConfirm.responsibility.version;

    // 4c. Stale version concurrency rejection: Re-submitting with old expectedVersion -> 409
    const reqStale = new Request(`http://localhost/api/agent-console/responsibilities/${createdResponsibilityId}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        expectedVersion: responsibilityVersion - 1,
        scopeHash: "sha256-scope-hash-1",
        allowlistedTools: ["inspect_source"],
        allowedPairs: [
          { provider: "meta", connectionId: connectionIdA, providerAccountId: "act_12345" },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resStale = await confirmResponsibilityPost(reqStale, {
      params: Promise.resolve({ id: createdResponsibilityId }),
    });
    assert.equal(resStale.status, 409);
    const jsonStale = await resStale.json();
    assert.equal(jsonStale.code, "stale_version");
    assert.equal(jsonStale.retryable, true);
  });

  it("5. Responsibility Actions: pause, resume, and update_scope", async () => {
    setSessionUser(adminId);

    // 5a. Pause responsibility
    const reqPause = new Request(`http://localhost/api/agent-console/responsibilities/${createdResponsibilityId}/actions`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        expectedVersion: responsibilityVersion,
        action: "pause",
        reason: "User requested pause",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resPause = await handleResponsibilityActionPost(reqPause, {
      params: Promise.resolve({ id: createdResponsibilityId }),
    });
    assert.equal(resPause.status, 200);
    const jsonPause = await resPause.json();
    assert.equal(jsonPause.responsibility.status, "paused");
    responsibilityVersion = jsonPause.responsibility.version;

    // 5b. Resume responsibility
    const reqResume = new Request(`http://localhost/api/agent-console/responsibilities/${createdResponsibilityId}/actions`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        expectedVersion: responsibilityVersion,
        action: "resume",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resResume = await handleResponsibilityActionPost(reqResume, {
      params: Promise.resolve({ id: createdResponsibilityId }),
    });
    assert.equal(resResume.status, 200);
    const jsonResume = await resResume.json();
    assert.equal(jsonResume.responsibility.status, "active");
    responsibilityVersion = jsonResume.responsibility.version;
  });

  let caseId = "";
  let caseVersion = 0;
  let evidenceId = "";
  let validCaseForInv: any;

  it("6. Cases API: inbox listing with cursor pagination, detail, and actions", async () => {
    // Seed an evidence snapshot and 3 test cases
    const evidence = await db.agentEvidenceSnapshot.create({
      data: {
        workspaceId: workspaceIdA,
        datasetFingerprint: `fp-test-${suffix}`,
        grain: "campaign",
        metrics: { spend: 1200.5, conversions: 45 },
        inventory: { accounts: ["act_12345"] },
        actualSince: new Date("2026-09-01"),
        actualUntil: new Date("2026-09-07"),
        currencies: ["USD"],
        timezones: ["America/New_York"],
        calculationVersion: 1,
        provenance: { source: "meta_daily" },
        citations: { campaignId: "camp_1" },
      },
    });
    evidenceId = evidence.id;

    const evaluation = await db.agentEvaluation.create({
      data: {
        workspaceId: workspaceIdA,
        responsibilityId: createdResponsibilityId,
        configVersion: 1,
        scopeRevision: 1,
        policyRevision: 1,
        scheduledSlot: new Date("2026-09-10T12:00:00Z"),
        status: "finding_detected",
        evidenceId: evidence.id,
      },
    });

    const c1 = await db.agentCase.create({
      data: {
        workspaceId: workspaceIdA,
        clientId: clientIdA,
        responsibilityId: createdResponsibilityId,
        evaluationId: evaluation.id,
        fingerprint: `fp_budget_${suffix}_1`,
        episode: 1,
        type: "budget_pacing",
        priority: "high",
        state: "detected",
        title: "Budget pacing breach 1",
      },
    });
    caseId = c1.id;
    caseVersion = c1.version;

    await db.agentCase.create({
      data: {
        workspaceId: workspaceIdA,
        clientId: clientIdA,
        responsibilityId: createdResponsibilityId,
        fingerprint: `fp_budget_${suffix}_2`,
        episode: 1,
        type: "budget_pacing",
        priority: "medium",
        state: "detected",
        title: "Budget pacing breach 2",
      },
    });

    await db.agentCase.create({
      data: {
        workspaceId: workspaceIdA,
        clientId: null, // No client assigned -> allClientMode test
        responsibilityId: createdResponsibilityId,
        fingerprint: `fp_budget_${suffix}_3`,
        episode: 1,
        type: "budget_pacing",
        priority: "low",
        state: "resolved",
        title: "Old resolved issue",
      },
    });

    await db.agentCase.create({
      data: {
        workspaceId: workspaceIdA,
        clientId: clientIdA,
        responsibilityId: createdResponsibilityId,
        fingerprint: `fp_budget_${suffix}_4`,
        episode: 1,
        type: "budget_pacing",
        priority: "medium",
        state: "detected",
        title: "Budget pacing breach 4",
      },
    });

    await db.agentCase.create({
      data: {
        workspaceId: workspaceIdA,
        clientId: clientIdA,
        responsibilityId: createdResponsibilityId,
        fingerprint: `fp_budget_${suffix}_5`,
        episode: 1,
        type: "budget_pacing",
        priority: "high",
        state: "detected",
        title: "Budget pacing breach 5",
      },
    });

    setSessionUser(viewerId);

    // 6a. Multi-page cursor traversal with limit: 2 across 5 cases
    // Page 1
    const resP1 = await listCasesGet(new Request(`http://localhost/api/agent-console/cases?workspaceId=${workspaceIdA}&limit=2`));
    assert.equal(resP1.status, 200);
    const jsonP1 = await resP1.json();
    assert.equal(jsonP1.cases.length, 2);
    assert.ok(jsonP1.nextCursor);
    assert.equal(jsonP1.nextCursor, jsonP1.cases[1].id, "nextCursor must be the last returned item");
    assert.equal(jsonP1.totalCount, 5);
    assert.equal(jsonP1.allClientMode, true);

    // Page 2
    const resP2 = await listCasesGet(new Request(`http://localhost/api/agent-console/cases?workspaceId=${workspaceIdA}&limit=2&cursor=${jsonP1.nextCursor}`));
    assert.equal(resP2.status, 200);
    const jsonP2 = await resP2.json();
    assert.equal(jsonP2.cases.length, 2);
    assert.ok(jsonP2.nextCursor);
    assert.equal(jsonP2.nextCursor, jsonP2.cases[1].id, "nextCursor must be the last returned item");

    // Page 3
    const resP3 = await listCasesGet(new Request(`http://localhost/api/agent-console/cases?workspaceId=${workspaceIdA}&limit=2&cursor=${jsonP2.nextCursor}`));
    assert.equal(resP3.status, 200);
    const jsonP3 = await resP3.json();
    assert.equal(jsonP3.cases.length, 1);
    assert.equal(jsonP3.nextCursor, null, "Final page nextCursor must be null");

    // Combine all retrieved cases: exactly 5 unique cases, 0 omissions, 0 duplicates
    const allRetrievedIds = [
      ...jsonP1.cases.map((c: any) => c.id),
      ...jsonP2.cases.map((c: any) => c.id),
      ...jsonP3.cases.map((c: any) => c.id),
    ];
    assert.equal(allRetrievedIds.length, 5, "All 5 cases must be retrieved across 3 pages");
    const uniqueIds = new Set(allRetrievedIds);
    assert.equal(uniqueIds.size, 5, "Zero duplicates across paginated traversal");

    // 6a.1 Non-existent or invalid cursor returns 400
    const reqInvalidCursor = new Request(`http://localhost/api/agent-console/cases?workspaceId=${workspaceIdA}&cursor=non_existent_cuid_123`, {
      method: "GET",
    });
    const resInvalidCursor = await listCasesGet(reqInvalidCursor);
    assert.equal(resInvalidCursor.status, 400);
    assert.equal((await resInvalidCursor.json()).code, "invalid_cursor");

    // 6b. Filter by clientId
    const reqClientCases = new Request(`http://localhost/api/agent-console/cases?workspaceId=${workspaceIdA}&clientId=${clientIdA}`, {
      method: "GET",
    });
    const resClientCases = await listCasesGet(reqClientCases);
    assert.equal(resClientCases.status, 200);
    const jsonClientCases = await resClientCases.json();
    assert.equal(jsonClientCases.allClientMode, false);
    assert.equal(jsonClientCases.cases.length, 4);

    // 6c. Get Case Detail
    const reqDetail = new Request(`http://localhost/api/agent-console/cases/${caseId}?workspaceId=${workspaceIdA}`, {
      method: "GET",
    });
    const resDetail = await getCaseDetailGet(reqDetail, {
      params: Promise.resolve({ id: caseId }),
    });
    assert.equal(resDetail.status, 200);
    const jsonDetail = await resDetail.json();
    assert.equal(jsonDetail.case.id, caseId);
    assert.ok(jsonDetail.evidence);
    assert.equal(jsonDetail.evidence.datasetFingerprint, `fp-test-${suffix}`);

    // 6d. Cross-workspace / non-existent case -> 404
    const req404 = new Request(`http://localhost/api/agent-console/cases/non-existent-id?workspaceId=${workspaceIdA}`, {
      method: "GET",
    });
    const res404 = await getCaseDetailGet(req404, {
      params: Promise.resolve({ id: "non-existent-id" }),
    });
    assert.equal(res404.status, 404);

    // 6e. Snooze Case action
    setSessionUser(memberId);
    const snoozeDate = new Date(Date.now() + 7 * 86400000).toISOString();
    const reqSnooze = new Request(`http://localhost/api/agent-console/cases/${caseId}/actions`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        expectedVersion: caseVersion,
        action: "snooze",
        snoozedUntil: snoozeDate,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resSnooze = await handleCaseActionPost(reqSnooze, {
      params: Promise.resolve({ id: caseId }),
    });
    assert.equal(resSnooze.status, 200);
    const jsonSnooze = await resSnooze.json();
    assert.ok(jsonSnooze.case.snoozedUntil);
    caseVersion = jsonSnooze.case.version;

    // 6f. False-resolution prevention: Interactive user claiming automated_recovery -> 403
    const reqFakeAuto = new Request(`http://localhost/api/agent-console/cases/${caseId}/actions`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        expectedVersion: caseVersion,
        action: "manual_resolve",
        resolutionType: "automated_recovery",
        resolutionReason: "Bypass attempt",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resFakeAuto = await handleCaseActionPost(reqFakeAuto, {
      params: Promise.resolve({ id: caseId }),
    });
    assert.equal(resFakeAuto.status, 403);
    assert.equal((await resFakeAuto.json()).code, "unauthorized_resolution_type");

    // 6g. False-resolution prevention: Manual resolve without reason -> 400
    const reqNoReason = new Request(`http://localhost/api/agent-console/cases/${caseId}/actions`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        expectedVersion: caseVersion,
        action: "manual_resolve",
        resolutionType: "manual_resolved",
        resolutionReason: "",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resNoReason = await handleCaseActionPost(reqNoReason, {
      params: Promise.resolve({ id: caseId }),
    });
    assert.equal(resNoReason.status, 400);
    assert.equal((await resNoReason.json()).code, "resolution_reason_required");

    // 6h. Valid Manual Resolve action
    const reqResolve = new Request(`http://localhost/api/agent-console/cases/${caseId}/actions`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        expectedVersion: caseVersion,
        action: "manual_resolve",
        resolutionType: "manual_resolved",
        resolutionReason: "Issue reviewed and dismissed by marketing manager",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resResolve = await handleCaseActionPost(reqResolve, {
      params: Promise.resolve({ id: caseId }),
    });
    assert.equal(resResolve.status, 200);
    const jsonResolve = await resResolve.json();
    assert.equal(jsonResolve.case.state, "resolved");
    assert.equal(jsonResolve.case.resolutionType, "manual_resolved");

    // 6i. Investigation action tests: schema validation and authorized context
    // 6i.1 Case without responsibility rejected
    const caseWithoutResp = await db.agentCase.create({
      data: {
        workspaceId: workspaceIdA,
        fingerprint: `fp_no_resp_${suffix}`,
        title: "No responsibility case",
      },
    });
    const reqInvNoResp = new Request(`http://localhost/api/agent-console/cases/${caseWithoutResp.id}/actions`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        expectedVersion: 0,
        action: "investigate",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resInvNoResp = await handleCaseActionPost(reqInvNoResp, { params: Promise.resolve({ id: caseWithoutResp.id }) });
    assert.equal(resInvNoResp.status, 400);
    assert.equal((await resInvNoResp.json()).code, "unsupported_investigation");

    // 6i.2 Valid investigation: active responsibility, active auth, schema-validated arguments
    // Create new active case linked to createdResponsibilityId
    validCaseForInv = await db.agentCase.create({
      data: {
        workspaceId: workspaceIdA,
        responsibilityId: createdResponsibilityId,
        fingerprint: `fp_inv_valid_${suffix}`,
        title: "Valid investigation case",
        state: "detected",
      },
    });

    const reqValidInv = new Request(`http://localhost/api/agent-console/cases/${validCaseForInv.id}/actions`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        expectedVersion: 0,
        action: "investigate",
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resValidInv = await handleCaseActionPost(reqValidInv, { params: Promise.resolve({ id: validCaseForInv.id }) });
    assert.equal(resValidInv.status, 200);
    const jsonValidInv = await resValidInv.json();
    assert.equal(jsonValidInv.case.state, "investigating");
    assert.equal(jsonValidInv.operation.toolName, "inspect_source");
    assert.equal(jsonValidInv.operation.arguments.workspaceId, workspaceIdA);
    assert.equal(jsonValidInv.operation.arguments.connectionId, connectionIdA);
    assert.equal(jsonValidInv.operation.arguments.provider, "meta");
  });

  it("7. Operation Approval: exact binding verification and atomic single-use consumption", async () => {
    // Seed valid evidence snapshot for ev-fp-exact
    await db.agentEvidenceSnapshot.create({
      data: {
        workspaceId: workspaceIdA,
        datasetFingerprint: "ev-fp-exact",
        actualSince: new Date("2026-09-01"),
        actualUntil: new Date("2026-09-07"),
        metrics: {},
        inventory: {},
        provenance: {},
        isExpired: false,
      },
    });

    // Seed operation and approval bound to validCaseForInv (which has active responsibility and authorization)
    const operation = await db.agentOperation.create({
      data: {
        workspaceId: workspaceIdA,
        caseId: validCaseForInv.id,
        operationKey: `op-test-${suffix}`,
        toolName: "inspect_source",
        arguments: { connectionId: connectionIdA, provider: "meta", adAccountId: "act_12345" },
        scopeHash: canonicalHash,
        policyRevision: 1,
        state: "queued",
      },
    });

    const approval = await db.agentApproval.create({
      data: {
        workspaceId: workspaceIdA,
        operationId: operation.id,
        proposalHash: "prop-hash-exact",
        approverUserId: memberId,
        evidenceFingerprint: "ev-fp-exact",
        evidenceRevision: 1,
        policyRevision: 1,
        scopeRevision: 1,
        status: "pending",
        expiresAt: new Date(Date.now() + 86400000), // 24 hours
      },
    });

    setSessionUser(memberId);

    // 7a. Mismatched proposal hash -> 400
    const reqMismatch = new Request(`http://localhost/api/agent-console/operations/${operation.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        approvalId: approval.id,
        proposalHash: "wrong-proposal-hash",
        evidenceFingerprint: "ev-fp-exact",
        evidenceRevision: 1,
        policyRevision: 1,
        scopeRevision: 1,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resMismatch = await approveOperationPost(reqMismatch, {
      params: Promise.resolve({ id: operation.id }),
    });
    assert.equal(resMismatch.status, 400);
    const jsonMismatch = await resMismatch.json();
    assert.equal(jsonMismatch.code, "approval_binding_mismatch");

    // 7a.1 Mismatched scopeRevision -> 400
    const reqScopeMismatch = new Request(`http://localhost/api/agent-console/operations/${operation.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        approvalId: approval.id,
        proposalHash: "prop-hash-exact",
        evidenceFingerprint: "ev-fp-exact",
        evidenceRevision: 1,
        policyRevision: 1,
        scopeRevision: 999, // Mismatched!
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resScopeMismatch = await approveOperationPost(reqScopeMismatch, {
      params: Promise.resolve({ id: operation.id }),
    });
    assert.equal(resScopeMismatch.status, 400);
    assert.equal((await resScopeMismatch.json()).code, "approval_binding_mismatch");

    // 7a.2 Mismatched evidenceRevision -> 400
    const reqEvRevMismatch = new Request(`http://localhost/api/agent-console/operations/${operation.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        approvalId: approval.id,
        proposalHash: "prop-hash-exact",
        evidenceFingerprint: "ev-fp-exact",
        evidenceRevision: 99, // Mismatched revision!
        policyRevision: 1,
        scopeRevision: 1,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resEvRevMismatch = await approveOperationPost(reqEvRevMismatch, {
      params: Promise.resolve({ id: operation.id }),
    });
    assert.equal(resEvRevMismatch.status, 400);
    assert.equal((await resEvRevMismatch.json()).code, "approval_binding_mismatch");

    // 7b. Valid approval consumption -> 200
    const reqApprove = new Request(`http://localhost/api/agent-console/operations/${operation.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        approvalId: approval.id,
        proposalHash: "prop-hash-exact",
        evidenceFingerprint: "ev-fp-exact",
        evidenceRevision: 1,
        policyRevision: 1,
        scopeRevision: 1,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resApprove = await approveOperationPost(reqApprove, {
      params: Promise.resolve({ id: operation.id }),
    });
    assert.equal(resApprove.status, 200);
    const jsonApprove = await resApprove.json();
    assert.equal(jsonApprove.approval.isSingleUseConsumed, true);
    assert.equal(jsonApprove.approval.status, "consumed");

    // 7c. Replay attack: second consumption attempt with fresh request returns 409
    const reqReplay = new Request(`http://localhost/api/agent-console/operations/${operation.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        approvalId: approval.id,
        proposalHash: "prop-hash-exact",
        evidenceFingerprint: "ev-fp-exact",
        evidenceRevision: 1,
        policyRevision: 1,
        scopeRevision: 1,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resReplay = await approveOperationPost(reqReplay, {
      params: Promise.resolve({ id: operation.id }),
    });
    assert.equal(resReplay.status, 409);
    const jsonReplay = await resReplay.json();
    assert.equal(jsonReplay.code, "approval_already_consumed");

    // 7d. Reject approval when operation state is not queued (e.g. failed)
    const opFailed = await db.agentOperation.create({
      data: {
        workspaceId: workspaceIdA,
        caseId: validCaseForInv.id,
        operationKey: `op-failed-${suffix}`,
        toolName: "inspect_source",
        arguments: { connectionId: connectionIdA, provider: "meta" },
        scopeHash: canonicalHash,
        policyRevision: 1,
        state: "failed",
      },
    });
    const appFailed = await db.agentApproval.create({
      data: {
        workspaceId: workspaceIdA,
        operationId: opFailed.id,
        proposalHash: "prop-hash-failed",
        evidenceFingerprint: "ev-fp-exact",
        policyRevision: 1,
        scopeRevision: 1,
        status: "pending",
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const reqOpNotQueued = new Request(`http://localhost/api/agent-console/operations/${opFailed.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        approvalId: appFailed.id,
        proposalHash: "prop-hash-failed",
        evidenceFingerprint: "ev-fp-exact",
        policyRevision: 1,
        scopeRevision: 1,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resOpNotQueued = await approveOperationPost(reqOpNotQueued, {
      params: Promise.resolve({ id: opFailed.id }),
    });
    assert.equal(resOpNotQueued.status, 400);
    assert.equal((await resOpNotQueued.json()).code, "invalid_operation_state");

    // 7e. Unbound operation rejected with unbound_operation
    const opUnbound = await db.agentOperation.create({
      data: {
        workspaceId: workspaceIdA,
        operationKey: `op-unbound-${suffix}`,
        toolName: "inspect_source",
        arguments: { connectionId: connectionIdA },
        scopeHash: canonicalHash,
        policyRevision: 1,
        state: "queued",
      },
    });
    const appUnbound = await db.agentApproval.create({
      data: {
        workspaceId: workspaceIdA,
        operationId: opUnbound.id,
        proposalHash: "prop-unbound",
        evidenceFingerprint: "ev-fp-exact",
        policyRevision: 1,
        scopeRevision: 1,
        status: "pending",
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const reqUnbound = new Request(`http://localhost/api/agent-console/operations/${opUnbound.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        workspaceId: workspaceIdA,
        approvalId: appUnbound.id,
        proposalHash: "prop-unbound",
        evidenceFingerprint: "ev-fp-exact",
        policyRevision: 1,
        scopeRevision: 1,
      }),
      headers: { "Content-Type": "application/json" },
    });
    const resUnbound = await approveOperationPost(reqUnbound, {
      params: Promise.resolve({ id: opUnbound.id }),
    });
    assert.equal(resUnbound.status, 400);
    assert.equal((await resUnbound.json()).code, "unbound_operation");
  });

  it("8. Evidence API: redacted immutable snapshot retrieval and expiration disclosure", async () => {
    setSessionUser(viewerId);

    // 8a. Retrieve active evidence
    const reqEvidence = new Request(`http://localhost/api/agent-console/evidence/${evidenceId}?workspaceId=${workspaceIdA}`, {
      method: "GET",
    });
    const resEvidence = await getEvidenceGet(reqEvidence, {
      params: Promise.resolve({ id: evidenceId }),
    });
    assert.equal(resEvidence.status, 200);
    const jsonEvidence = await resEvidence.json();
    assert.equal(jsonEvidence.evidence.id, evidenceId);
    assert.equal(jsonEvidence.evidence.isExpired, false);
    assert.equal(jsonEvidence.evidence.retentionStatus, "retained");
    assert.ok(jsonEvidence.evidence.metrics);
    assert.ok(jsonEvidence.evidence.citations);

    // 8b. Expired evidence disclosure
    await db.agentEvidenceSnapshot.update({
      where: { workspaceId_id: { workspaceId: workspaceIdA, id: evidenceId } },
      data: { isExpired: true },
    });

    const resExpired = await getEvidenceGet(reqEvidence, {
      params: Promise.resolve({ id: evidenceId }),
    });
    assert.equal(resExpired.status, 200);
    const jsonExpired = await resExpired.json();
    assert.equal(jsonExpired.evidence.isExpired, true);
    assert.equal(jsonExpired.evidence.retentionStatus, "marked_expired");
    assert.ok(jsonExpired.evidence.message.includes("expired and unavailable"));

    // 8c. Sensitive provenance and credentials redaction
    const secretSnapshot = await db.agentEvidenceSnapshot.create({
      data: {
        workspaceId: workspaceIdA,
        datasetFingerprint: `fp-secret-${suffix}`,
        grain: "campaign",
        metrics: {},
        inventory: {},
        actualSince: new Date("2026-09-01"),
        actualUntil: new Date("2026-09-07"),
        currencies: ["USD"],
        timezones: ["UTC"],
        calculationVersion: 1,
        provenance: {
          accessToken: "EAABtest_oauth_access_token_12345",
          apiKey: "sk_live_secret_key_67890",
          safeSource: "meta_marketing_api",
        },
        citations: {
          authHeader: "Bearer EAABsecret",
          campaignId: "camp_123",
        },
      },
    });

    const reqSecretEvidence = new Request(`http://localhost/api/agent-console/evidence/${secretSnapshot.id}?workspaceId=${workspaceIdA}`, {
      method: "GET",
    });
    const resSecretEvidence = await getEvidenceGet(reqSecretEvidence, {
      params: Promise.resolve({ id: secretSnapshot.id }),
    });
    assert.equal(resSecretEvidence.status, 200);
    const jsonSecretEvidence = await resSecretEvidence.json();
    assert.equal(jsonSecretEvidence.evidence.provenance.accessToken, "[REDACTED]");
    assert.equal(jsonSecretEvidence.evidence.provenance.apiKey, "[REDACTED]");
    assert.equal(jsonSecretEvidence.evidence.provenance.safeSource, "meta_marketing_api");
    assert.equal(jsonSecretEvidence.evidence.citations.authHeader, "[REDACTED]");
    assert.equal(jsonSecretEvidence.evidence.citations.campaignId, "camp_123");

    // 8d. Cross-workspace evidence query by member of Workspace B -> 404 (not found in workspace B)
    setSessionUser(outsiderId);
    const reqCrossWs = new Request(`http://localhost/api/agent-console/evidence/${evidenceId}?workspaceId=${workspaceIdB}`, {
      method: "GET",
    });
    const resCrossWs = await getEvidenceGet(reqCrossWs, {
      params: Promise.resolve({ id: evidenceId }),
    });
    assert.equal(resCrossWs.status, 404);
    const jsonCrossWs = await resCrossWs.json();
    assert.equal(jsonCrossWs.code, "evidence_not_found");

    // 8e. Accessing Workspace B by viewer of Workspace A -> 403 (access denied)
    setSessionUser(viewerId);
    const reqForbidden = new Request(`http://localhost/api/agent-console/evidence/${evidenceId}?workspaceId=${workspaceIdB}`, {
      method: "GET",
    });
    const resForbidden = await getEvidenceGet(reqForbidden, {
      params: Promise.resolve({ id: evidenceId }),
    });
    assert.equal(resForbidden.status, 403);
    const jsonForbidden = await resForbidden.json();
    assert.equal(jsonForbidden.code, "access_denied");
  });
});
