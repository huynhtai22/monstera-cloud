import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, beforeEach, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  agentConsoleTransaction,
  createResponsibility,
  setResponsibilityScope,
  confirmResponsibility,
  updateResponsibilityStatus,
  recordEvaluation,
  openOrUpdateCase,
  resolveCase,
  enqueueOperation,
  createApproval,
  consumeApproval,
  publishNotificationOutbox,
  cleanupRetention,
  appendConsoleEvent,
  computeCanonicalScopeHash,
  canonicalJsonStringify,
  AgentConsoleError,
} from "./persistence";

const errorCode = (code: string) => (error: unknown) =>
  error instanceof AgentConsoleError && error.code === code;

describe("C2 Agent Console persistence & isolation against real PostgreSQL", () => {
  const db = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/monstera_c2_test",
      },
    },
  });

  const suffix = randomUUID();
  const ownerId = `u-owner-${suffix}`;
  const adminId = `u-admin-${suffix}`;
  const memberId = `u-member-${suffix}`;
  const viewerId = `u-viewer-${suffix}`;
  const workspaceIdA = `ws-c2-a-${suffix}`;
  const workspaceIdB = `ws-c2-b-${suffix}`;
  const connectionIdA = `conn-c2-a-${suffix}`;
  const connectionIdB = `conn-c2-b-${suffix}`;
  const clientIdA = `client-c2-a-${suffix}`;

  before(async () => {
    await db.$connect();

    // Create users
    for (const [id, email] of [
      [ownerId, `owner-${suffix}@example.test`],
      [adminId, `admin-${suffix}@example.test`],
      [memberId, `member-${suffix}@example.test`],
      [viewerId, `viewer-${suffix}@example.test`],
    ]) {
      await db.user.create({ data: { id, email, name: id, plan: "professional" } });
    }

    // Create workspaces
    for (const [id, name, slug] of [
      [workspaceIdA, "Workspace A", `ws-a-${suffix}`],
      [workspaceIdB, "Workspace B", `ws-b-${suffix}`],
    ]) {
      await db.workspace.create({
        data: { id, name, slug, ownerId, plan: "professional", status: "ACTIVE" },
      });
    }

    // Memberships for Workspace A
    await db.workspaceMember.createMany({
      data: [
        { workspaceId: workspaceIdA, userId: ownerId, role: "owner" },
        { workspaceId: workspaceIdA, userId: adminId, role: "admin" },
        { workspaceId: workspaceIdA, userId: memberId, role: "member" },
        { workspaceId: workspaceIdA, userId: viewerId, role: "viewer" },
        // Workspace B has only owner
        { workspaceId: workspaceIdB, userId: ownerId, role: "owner" },
      ],
    });

    // Clients
    await db.client.create({
      data: { id: clientIdA, workspaceId: workspaceIdA, name: "Client A" },
    });

    // Connections
    await db.connection.create({
      data: {
        id: connectionIdA,
        workspaceId: workspaceIdA,
        name: "Conn A",
        type: "source",
        provider: "meta_ads",
        credentials: "enc",
        remoteAccountId: "act_a",
        status: "connected",
      },
    });

    await db.connection.create({
      data: {
        id: connectionIdB,
        workspaceId: workspaceIdB,
        name: "Conn B",
        type: "source",
        provider: "meta_ads",
        credentials: "enc",
        remoteAccountId: "act_b",
        status: "connected",
      },
    });
  });

  after(async () => {
    await db.workspace.deleteMany({
      where: { id: { in: [workspaceIdA, workspaceIdB] } },
    });
    await db.user.deleteMany({
      where: { id: { in: [ownerId, adminId, memberId, viewerId] } },
    });
    await db.$disconnect();
  });

  beforeEach(async () => {
    // Clear out C2 tables in Workspace A between tests
    await db.agentNotificationOutbox.deleteMany({ where: { workspaceId: workspaceIdA } });
    await db.agentApproval.deleteMany({ where: { workspaceId: workspaceIdA } });
    await db.agentOperation.deleteMany({ where: { workspaceId: workspaceIdA } });
    await db.agentCase.deleteMany({ where: { workspaceId: workspaceIdA } });
    await db.agentEvaluation.deleteMany({ where: { workspaceId: workspaceIdA } });
    await db.agentEvidenceSnapshot.deleteMany({ where: { workspaceId: workspaceIdA } });
    await db.agentAuthorization.deleteMany({ where: { workspaceId: workspaceIdA } });
    await db.agentResponsibilityScope.deleteMany({ where: { workspaceId: workspaceIdA } });
    await db.agentConsoleEvent.deleteMany({ where: { workspaceId: workspaceIdA } });
    await db.agentResponsibility.deleteMany({ where: { workspaceId: workspaceIdA } });
  });

  it("1. Cross-workspace relationships and access rejection", async () => {
    // Viewer cannot create responsibility
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          createResponsibility(tx, {
            workspaceId: workspaceIdA,
            ownerId,
            createdByUserId: viewerId,
            configuration: { targetCpa: 25 },
          })
        , db),
      errorCode("insufficient_role")
    );

    // Foreign client rejected
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          createResponsibility(tx, {
            workspaceId: workspaceIdB,
            clientId: clientIdA, // clientIdA belongs to workspace A!
            ownerId,
            createdByUserId: ownerId,
            configuration: {},
          })
        , db),
      errorCode("client_not_found")
    );

    // Member creates responsibility in Workspace A
    const resp = await agentConsoleTransaction(tx =>
      createResponsibility(tx, {
        workspaceId: workspaceIdA,
        ownerId,
        createdByUserId: memberId,
        configuration: { threshold: 10 },
      })
    , db);
    assert.equal(resp.status, "draft");
    assert.equal(resp.version, 0);

    // Negative cpaFloor or non-numeric cpaFloor in configuration is rejected
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          createResponsibility(tx, {
            workspaceId: workspaceIdA,
            ownerId,
            createdByUserId: memberId,
            configuration: { cpaFloor: -5 },
          })
        , db),
      errorCode("invalid_configuration")
    );

    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          createResponsibility(tx, {
            workspaceId: workspaceIdA,
            ownerId,
            createdByUserId: memberId,
            configuration: { cpaFloor: NaN },
          })
        , db),
      errorCode("invalid_configuration")
    );

    // Valid cpaFloor is accepted
    const respValidFloor = await agentConsoleTransaction(tx =>
      createResponsibility(tx, {
        workspaceId: workspaceIdA,
        ownerId,
        createdByUserId: memberId,
        configuration: { cpaFloor: 15 },
      })
    , db);
    assert.equal((respValidFloor.configuration as any).cpaFloor, 15);

    // Attaching connection from Workspace B to Workspace A responsibility fails
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          setResponsibilityScope(tx, {
            workspaceId: workspaceIdA,
            responsibilityId: resp.id,
            scopeRevision: 1,
            items: [
              {
                connectionId: connectionIdB, // belongs to Workspace B!
                provider: "meta_ads",
                providerAccountId: "act_b",
              },
            ],
          })
        , db),
      errorCode("connection_not_found")
    );

    // Negative tests for DB composite foreign keys (cross-workspace reference rejection at database layer)
    // 1. Evidence in Workspace B referenced by Evaluation in Workspace A
    const evidenceB = await db.agentEvidenceSnapshot.create({
      data: {
        workspaceId: workspaceIdB,
        datasetFingerprint: `fp-b-${suffix}`,
        grain: "campaign",
        metrics: {},
        inventory: {},
        actualSince: new Date("2026-09-01"),
        actualUntil: new Date("2026-09-07"),
        currencies: ["USD"],
        timezones: ["UTC"],
        calculationVersion: 1,
        provenance: {},
        citations: {},
      },
    });

    await assert.rejects(
      async () => {
        await db.agentEvaluation.create({
          data: {
            workspaceId: workspaceIdA,
            responsibilityId: resp.id,
            evidenceId: evidenceB.id, // cross-workspace evidence ID!
            configVersion: 0,
            scopeRevision: 1,
            policyRevision: 0,
            scheduledSlot: new Date("2026-10-01T10:00:00Z"),
            status: "success",
          },
        });
      },
      (err: any) => err.code === "P2003" || /foreign key/i.test(err.message),
      "Cross-workspace evidence reference in evaluation must be rejected by PostgreSQL composite foreign key"
    );

    // 2. Evaluation in Workspace B referenced by Case in Workspace A
    const respB = await db.agentResponsibility.create({
      data: {
        workspaceId: workspaceIdB,
        ownerId,
        createdByUserId: ownerId,
        configuration: {},
      },
    });
    const evalB = await db.agentEvaluation.create({
      data: {
        workspaceId: workspaceIdB,
        responsibilityId: respB.id,
        configVersion: 0,
        scopeRevision: 0,
        policyRevision: 0,
        scheduledSlot: new Date("2026-10-01T10:00:00Z"),
        status: "success",
      },
    });

    await assert.rejects(
      async () => {
        await db.agentCase.create({
          data: {
            workspaceId: workspaceIdA,
            responsibilityId: resp.id,
            evaluationId: evalB.id, // cross-workspace evaluation ID!
            fingerprint: `fp-cross-${suffix}`,
            title: "Cross Workspace Case",
          },
        });
      },
      (err: any) => err.code === "P2003" || /foreign key/i.test(err.message),
      "Cross-workspace evaluation reference in case must be rejected by PostgreSQL composite foreign key"
    );

    // 3. Evaluation in Workspace B referenced by Operation in Workspace A
    await assert.rejects(
      async () => {
        await db.agentOperation.create({
          data: {
            workspaceId: workspaceIdA,
            evaluationId: evalB.id, // cross-workspace evaluation ID!
            operationKey: `op-cross-${suffix}`,
            toolName: "inspect_source",
            arguments: {},
            scopeHash: "hash_test",
            policyRevision: 1,
          },
        });
      },
      (err: any) => err.code === "P2003" || /foreign key/i.test(err.message),
      "Cross-workspace evaluation reference in operation must be rejected by PostgreSQL composite foreign key"
    );
  });

  it("2. Concurrent evaluation, case, operation, and outbox creation", async () => {
    const resp = await agentConsoleTransaction(tx =>
      createResponsibility(tx, {
        workspaceId: workspaceIdA,
        ownerId,
        createdByUserId: adminId,
        configuration: {},
      })
    , db);

    const slot = new Date("2026-10-01T12:00:00Z");

    // Concurrent recordEvaluation: exactly one succeeds or deduplicates idempotently
    const [evalA, evalB] = await Promise.all([
      agentConsoleTransaction(tx =>
        recordEvaluation(tx, {
          workspaceId: workspaceIdA,
          responsibilityId: resp.id,
          configVersion: 0,
          scopeRevision: 0,
          policyRevision: 0,
          scheduledSlot: slot,
          status: "no_finding",
        })
      , db),
      agentConsoleTransaction(tx =>
        recordEvaluation(tx, {
          workspaceId: workspaceIdA,
          responsibilityId: resp.id,
          configVersion: 0,
          scopeRevision: 0,
          policyRevision: 0,
          scheduledSlot: slot,
          status: "no_finding",
        })
      , db),
    ]);
    assert.equal(evalA.evaluation.id, evalB.evaluation.id);

    // Concurrent openOrUpdateCase for the same fingerprint
    const fp = "fp_cpa_spike_meta_101";
    const [caseA, caseB] = await Promise.all([
      agentConsoleTransaction(tx =>
        openOrUpdateCase(tx, {
          workspaceId: workspaceIdA,
          fingerprint: fp,
          title: "CPA Spike Meta",
          priority: "high",
        })
      , db),
      agentConsoleTransaction(tx =>
        openOrUpdateCase(tx, {
          workspaceId: workspaceIdA,
          fingerprint: fp,
          title: "CPA Spike Meta",
          priority: "high",
        })
      , db),
    ]);
    assert.equal(caseA.caseRecord.id, caseB.caseRecord.id);
    assert.equal(caseA.caseRecord.episode, 1);

    // Enforce partial unique index: attempting to create a second open case for same fingerprint fails
    await assert.rejects(async () => {
      await db.agentCase.create({
        data: {
          workspaceId: workspaceIdA,
          fingerprint: fp,
          episode: 2,
          title: "Second open episode",
          state: "detected", // still not resolved
        },
      });
    });

    // Concurrent enqueueOperation for the same operationKey
    const opKey = "op_sync_recovery_20261001";
    const [opA, opB] = await Promise.all([
      agentConsoleTransaction(tx =>
        enqueueOperation(tx, {
          workspaceId: workspaceIdA,
          operationKey: opKey,
          toolName: "submit_recovery_import",
          arguments: { days: 7 },
          scopeHash: "hash_meta_1",
          policyRevision: 1,
        })
      , db),
      agentConsoleTransaction(tx =>
        enqueueOperation(tx, {
          workspaceId: workspaceIdA,
          operationKey: opKey,
          toolName: "submit_recovery_import",
          arguments: { days: 7 },
          scopeHash: "hash_meta_1",
          policyRevision: 1,
        })
      , db),
    ]);
    assert.equal(opA.operation.id, opB.operation.id);

    // Concurrent publishNotificationOutbox for same deliveryKey
    const delivKey = `outbox:${caseA.caseRecord.id}:1:detected:in_app:${ownerId}`;
    const [outA, outB] = await Promise.all([
      agentConsoleTransaction(tx =>
        publishNotificationOutbox(tx, {
          workspaceId: workspaceIdA,
          caseId: caseA.caseRecord.id,
          recipientUserId: ownerId,
          deliveryKey: delivKey,
          payload: { text: "Alert" },
        })
      , db),
      agentConsoleTransaction(tx =>
        publishNotificationOutbox(tx, {
          workspaceId: workspaceIdA,
          caseId: caseA.caseRecord.id,
          recipientUserId: ownerId,
          deliveryKey: delivKey,
          payload: { text: "Alert" },
        })
      , db),
    ]);
    assert.equal(outA.outbox.id, outB.outbox.id);
  });

  it("3. Duplicate requests and conflicting idempotency payloads", async () => {
    const resp = await agentConsoleTransaction(tx =>
      createResponsibility(tx, {
        workspaceId: workspaceIdA,
        ownerId,
        createdByUserId: adminId,
        configuration: {},
      })
    , db);

    const slot = new Date("2026-10-01T15:00:00Z");

    await agentConsoleTransaction(tx =>
      recordEvaluation(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: resp.id,
        configVersion: 0,
        scopeRevision: 0,
        policyRevision: 0,
        scheduledSlot: slot,
        status: "success",
      })
    , db);

    // Competing evaluation for same slot with conflicting status throws 409
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          recordEvaluation(tx, {
            workspaceId: workspaceIdA,
            responsibilityId: resp.id,
            configVersion: 0,
            scopeRevision: 0,
            policyRevision: 0,
            scheduledSlot: slot,
            status: "failed", // Conflicting!
          })
        , db),
      errorCode("evaluation_conflict")
    );

    // Enqueue operation
    await agentConsoleTransaction(tx =>
      enqueueOperation(tx, {
        workspaceId: workspaceIdA,
        operationKey: "op_idempotency_test",
        toolName: "inspect_source",
        arguments: { connectionId: connectionIdA },
        scopeHash: "hash_meta_2",
        policyRevision: 1,
      })
    , db);

    // Competing operation for same key with different arguments throws 409
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          enqueueOperation(tx, {
            workspaceId: workspaceIdA,
            operationKey: "op_idempotency_test",
            toolName: "inspect_source",
            arguments: { connectionId: connectionIdA, changed: true },
            scopeHash: "hash_meta_different",
            policyRevision: 1,
          })
        , db),
      errorCode("idempotency_conflict")
    );

    // 3b. Recursive canonical JSON serializer assertions
    // Nested object key order invariance
    const objA = { b: { z: 1, a: 2, m: { y: "deep", x: 10 } }, a: "top" };
    const objB = { a: "top", b: { m: { x: 10, y: "deep" }, a: 2, z: 1 } };
    assert.equal(canonicalJsonStringify(objA), canonicalJsonStringify(objB));

    // Nested Date normalisation
    const testDate = new Date("2026-10-01T12:30:00.000Z");
    const dateObjA = { filter: { since: testDate, until: "2026-10-02" } };
    const dateObjB = { filter: { since: "2026-10-01T12:30:00.000Z", until: "2026-10-02" } };
    assert.equal(canonicalJsonStringify(dateObjA), canonicalJsonStringify(dateObjB));

    // Changed nested date/args produce different strings
    const dateObjC = { filter: { since: "2026-10-01T12:31:00.000Z", until: "2026-10-02" } };
    assert.notEqual(canonicalJsonStringify(dateObjA), canonicalJsonStringify(dateObjC));

    // Nested argument idempotency: matching nested args returns existing without error
    const opReplaySame = await agentConsoleTransaction(tx =>
      enqueueOperation(tx, {
        workspaceId: workspaceIdA,
        operationKey: "op_nested_idempotency",
        toolName: "query_coverage",
        arguments: { config: { window: { days: 7, nested: { enabled: true } } } },
        scopeHash: "scope_hash_cov",
        policyRevision: 1,
      })
    , db);
    assert.equal(opReplaySame.created, true);

    const opReplayPermuted = await agentConsoleTransaction(tx =>
      enqueueOperation(tx, {
        workspaceId: workspaceIdA,
        operationKey: "op_nested_idempotency",
        toolName: "query_coverage",
        arguments: { config: { window: { nested: { enabled: true }, days: 7 } } },
        scopeHash: "scope_hash_cov",
        policyRevision: 1,
      })
    , db);
    assert.equal(opReplayPermuted.created, false);
    assert.equal(opReplayPermuted.operation.id, opReplaySame.operation.id);

    // Conflicting evaluation findings payload throws evaluation_conflict
    const evalSlot = new Date("2026-10-01T16:00:00Z");
    await agentConsoleTransaction(tx =>
      recordEvaluation(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: resp.id,
        configVersion: 0,
        scopeRevision: 0,
        policyRevision: 0,
        scheduledSlot: evalSlot,
        status: "success",
        result: { findings: [{ code: "drop_detected", amount: 50 }] },
      })
    , db);

    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          recordEvaluation(tx, {
            workspaceId: workspaceIdA,
            responsibilityId: resp.id,
            configVersion: 0,
            scopeRevision: 0,
            policyRevision: 0,
            scheduledSlot: evalSlot,
            status: "success",
            result: { findings: [{ code: "increase_detected", amount: 20 }] }, // Different findings!
          })
        , db),
      errorCode("evaluation_conflict")
    );

    // 3c. Evaluation replay comparison includes reporting window dates
    const windowSlot = new Date("2026-10-01T17:00:00Z");
    const sinceDate = new Date("2026-09-01T00:00:00Z");
    const untilDate = new Date("2026-09-30T23:59:59Z");
    await agentConsoleTransaction(tx =>
      recordEvaluation(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: resp.id,
        configVersion: 0,
        scopeRevision: 0,
        policyRevision: 0,
        scheduledSlot: windowSlot,
        status: "success",
        windowSince: sinceDate,
        windowUntil: untilDate,
      })
    , db);

    // Replay with identical window succeeds idempotently
    const replayIdenticalWindow = await agentConsoleTransaction(tx =>
      recordEvaluation(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: resp.id,
        configVersion: 0,
        scopeRevision: 0,
        policyRevision: 0,
        scheduledSlot: windowSlot,
        status: "success",
        windowSince: sinceDate,
        windowUntil: untilDate,
      })
    , db);
    assert.equal(replayIdenticalWindow.created, false);

    // Replay with different windowSince returns evaluation_conflict (409)
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          recordEvaluation(tx, {
            workspaceId: workspaceIdA,
            responsibilityId: resp.id,
            configVersion: 0,
            scopeRevision: 0,
            policyRevision: 0,
            scheduledSlot: windowSlot,
            status: "success",
            windowSince: new Date("2026-09-02T00:00:00Z"), // Changed windowSince!
            windowUntil: untilDate,
          })
        , db),
      errorCode("evaluation_conflict")
    );

    // Conflicting outbox notification payload throws outbox_conflict
    const delivKeyConflict = `deliv:conflict:${randomUUID()}`;
    const outboxConfCase = await agentConsoleTransaction(tx =>
      openOrUpdateCase(tx, { workspaceId: workspaceIdA, fingerprint: "fp_outbox_conf", title: "Outbox Conf Case" })
    , db);

    await agentConsoleTransaction(tx =>
      publishNotificationOutbox(tx, {
        workspaceId: workspaceIdA,
        caseId: outboxConfCase.caseRecord.id,
        recipientUserId: ownerId,
        deliveryKey: delivKeyConflict,
        payload: { summary: "Original message", nested: { code: 1 } },
      })
    , db);

    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          publishNotificationOutbox(tx, {
            workspaceId: workspaceIdA,
            caseId: outboxConfCase.caseRecord.id,
            recipientUserId: ownerId,
            deliveryKey: delivKeyConflict,
            payload: { summary: "Conflicting message", nested: { code: 2 } }, // Conflicting!
          })
        , db),
      errorCode("outbox_conflict")
    );

    // Confirm resp so it has active authorization for creating approvals
    const approvalScopeItems = [{ provider: "meta_ads", connectionId: connectionIdA, providerAccountId: "act_12345" }];
    const approvalScopeHash = computeCanonicalScopeHash(approvalScopeItems);
    await agentConsoleTransaction(async tx => {
      await setResponsibilityScope(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: resp.id,
        scopeRevision: 1,
        items: approvalScopeItems,
      });
      await confirmResponsibility(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: resp.id,
        expectedVersion: 0,
        authorizingUserId: adminId,
        scopeHash: approvalScopeHash,
        allowlistedTools: ["submit_recovery_import", "inspect_source"],
        allowedPairs: approvalScopeItems,
      });
    }, db);

    const approvalCase = await agentConsoleTransaction(tx =>
      openOrUpdateCase(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: resp.id,
        fingerprint: `fp_approval_conf_${suffix}`,
        title: "Approval Conf Case",
      })
    , db);

    // Conflicting approval throws approval_conflict
    const approvalOp = await agentConsoleTransaction(tx =>
      enqueueOperation(tx, {
        workspaceId: workspaceIdA,
        caseId: approvalCase.caseRecord.id,
        operationKey: "op_approval_conf_test",
        toolName: "submit_recovery_import",
        arguments: { connectionId: connectionIdA, provider: "meta_ads", adAccountId: "act_12345", days: 7 },
        scopeHash: approvalScopeHash,
        policyRevision: 1,
      })
    , db);

    await agentConsoleTransaction(tx =>
      createApproval(tx, {
        workspaceId: workspaceIdA,
        operationId: approvalOp.operation.id,
        proposalHash: "prop_conf_1",
        evidenceFingerprint: "ev_conf_1",
        policyRevision: 1,
        scopeRevision: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
    , db);

    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          createApproval(tx, {
            workspaceId: workspaceIdA,
            operationId: approvalOp.operation.id,
            proposalHash: "prop_conf_1",
            evidenceFingerprint: "ev_conf_DIFFERENT", // Conflicting!
            policyRevision: 1,
            scopeRevision: 1,
            expiresAt: new Date(Date.now() + 60_000),
          })
        , db),
      errorCode("approval_conflict")
    );
  });

  it("4. Stale versions and transaction rollback", async () => {
    const resp = await agentConsoleTransaction(tx =>
      createResponsibility(tx, {
        workspaceId: workspaceIdA,
        ownerId,
        createdByUserId: ownerId,
        configuration: {},
      })
    , db);

    // Negative test 4a: Confirm with empty scope roster -> scope_empty
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          confirmResponsibility(tx, {
            workspaceId: workspaceIdA,
            responsibilityId: resp.id,
            expectedVersion: 0,
            scopeHash: "dummy_hash",
            authorizingUserId: ownerId,
            allowlistedTools: ["inspect_source"],
            allowedPairs: [{ provider: "meta_ads", connectionId: connectionIdA, providerAccountId: "act_a" }],
          })
        , db),
      errorCode("scope_empty")
    );

    // Set scope roster
    const scopeItems = [{ provider: "meta_ads", connectionId: connectionIdA, providerAccountId: "act_a" }];
    await agentConsoleTransaction(tx =>
      setResponsibilityScope(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: resp.id,
        scopeRevision: 1,
        items: scopeItems,
      })
    , db);
    const validScopeHash = computeCanonicalScopeHash(scopeItems);

    // Negative test 4b: Invalid tool not in registry -> invalid_tool
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          confirmResponsibility(tx, {
            workspaceId: workspaceIdA,
            responsibilityId: resp.id,
            expectedVersion: 0,
            scopeHash: validScopeHash,
            authorizingUserId: ownerId,
            allowlistedTools: ["unregistered_malicious_tool"],
            allowedPairs: scopeItems,
          })
        , db),
      errorCode("invalid_tool")
    );

    // Negative test 4c: Foreign connection in allowedPairs -> connection_not_found
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          confirmResponsibility(tx, {
            workspaceId: workspaceIdA,
            responsibilityId: resp.id,
            expectedVersion: 0,
            scopeHash: validScopeHash,
            authorizingUserId: ownerId,
            allowlistedTools: ["inspect_source"],
            allowedPairs: [{ provider: "meta_ads", connectionId: connectionIdB, providerAccountId: "act_b" }],
          })
        , db),
      errorCode("connection_not_found")
    );

    // Negative test 4d: Tampered / mismatched scopeHash -> scope_hash_mismatch
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          confirmResponsibility(tx, {
            workspaceId: workspaceIdA,
            responsibilityId: resp.id,
            expectedVersion: 0,
            scopeHash: "tampered_scope_hash_value",
            authorizingUserId: ownerId,
            allowlistedTools: ["inspect_source"],
            allowedPairs: scopeItems,
          })
        , db),
      errorCode("scope_hash_mismatch")
    );

    // Confirm with correct expectedVersion = 0 and canonical scopeHash
    const confirmed = await agentConsoleTransaction(tx =>
      confirmResponsibility(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: resp.id,
        expectedVersion: 0,
        scopeHash: validScopeHash,
        authorizingUserId: ownerId,
        allowlistedTools: ["inspect_source"],
        allowedPairs: scopeItems,
      })
    , db);
    assert.equal(confirmed.responsibility.version, 1);
    assert.equal(confirmed.responsibility.status, "active");

    // Updating status with stale expectedVersion 0 (current is 1) throws stale_version and rolls back
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          updateResponsibilityStatus(tx, {
            workspaceId: workspaceIdA,
            responsibilityId: resp.id,
            expectedVersion: 0, // Stale!
            status: "paused",
            actorUserId: ownerId,
          })
        , db),
      errorCode("stale_version")
    );

    const reloadedResp = await db.agentResponsibility.findUniqueOrThrow({
      where: { id: resp.id },
    });
    assert.equal(reloadedResp.status, "active"); // Preserved!

    // Case state machine stale version
    const { caseRecord } = await agentConsoleTransaction(tx =>
      openOrUpdateCase(tx, {
        workspaceId: workspaceIdA,
        fingerprint: "fp_version_test",
        title: "Version test",
      })
    , db);
    assert.equal(caseRecord.version, 0);

    // Negative test 4e: Missing resolution reason -> resolution_reason_required
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          resolveCase(tx, {
            workspaceId: workspaceIdA,
            caseId: caseRecord.id,
            expectedVersion: 0,
            resolutionType: "manual_resolved",
            resolutionReason: "", // Empty!
            actorUserId: ownerId,
          })
        , db),
      errorCode("resolution_reason_required")
    );

    // Negative test 4f: Interactive user attempting automated_recovery -> unauthorized_resolution_type
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          resolveCase(tx, {
            workspaceId: workspaceIdA,
            caseId: caseRecord.id,
            expectedVersion: 0,
            resolutionType: "automated_recovery",
            resolutionReason: "User claims automated recovery",
            actorUserId: ownerId,
            isSystemVerifier: false, // Interactive user!
          })
        , db),
      errorCode("unauthorized_resolution_type")
    );

    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          resolveCase(tx, {
            workspaceId: workspaceIdA,
            caseId: caseRecord.id,
            expectedVersion: 99, // Stale!
            resolutionType: "manual_resolved",
            resolutionReason: "Manually investigated and approved",
            actorUserId: ownerId,
          })
        , db),
      errorCode("stale_version")
    );

    const reloadedCase = await db.agentCase.findUniqueOrThrow({
      where: { id: caseRecord.id },
    });
    assert.equal(reloadedCase.state, "detected"); // Not resolved!
  });

  it("5. Permission loss, revoked/expired policies, and scope changes", async () => {
    const resp = await agentConsoleTransaction(tx =>
      createResponsibility(tx, {
        workspaceId: workspaceIdA,
        ownerId,
        createdByUserId: ownerId,
        configuration: {},
      })
    , db);

    // Set scope roster
    const scopeItems = [{ provider: "meta_ads", connectionId: connectionIdA, providerAccountId: "act_a" }];
    await agentConsoleTransaction(tx =>
      setResponsibilityScope(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: resp.id,
        scopeRevision: 1,
        items: scopeItems,
      })
    , db);
    const validScopeHash = computeCanonicalScopeHash(scopeItems);

    // Confirm with expiresAt in the past
    const expiredDate = new Date(Date.now() - 60_000);
    await agentConsoleTransaction(tx =>
      confirmResponsibility(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: resp.id,
        expectedVersion: 0,
        scopeHash: validScopeHash,
        authorizingUserId: ownerId,
        allowlistedTools: ["inspect_source"],
        allowedPairs: scopeItems,
        expiresAt: expiredDate,
      })
    , db);

    // Pause it
    await agentConsoleTransaction(tx =>
      updateResponsibilityStatus(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: resp.id,
        expectedVersion: 1,
        status: "paused",
        actorUserId: ownerId,
      })
    , db);

    // Reactivation fails because authorization expired!
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          updateResponsibilityStatus(tx, {
            workspaceId: workspaceIdA,
            responsibilityId: resp.id,
            expectedVersion: 2,
            status: "active",
            actorUserId: ownerId,
          })
        , db),
      errorCode("authorization_expired")
    );

    // Member (not admin/owner) cannot confirm or activate
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          confirmResponsibility(tx, {
            workspaceId: workspaceIdA,
            responsibilityId: resp.id,
            expectedVersion: 2,
            scopeHash: validScopeHash,
            authorizingUserId: memberId, // Member lacks owner/admin authority
            allowlistedTools: ["inspect_source"],
            allowedPairs: scopeItems,
          })
        , db),
      errorCode("insufficient_role")
    );

    // Re-confirming with owner creates a new revision and revokes old authorization
    const reconfirmed = await agentConsoleTransaction(tx =>
      confirmResponsibility(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: resp.id,
        expectedVersion: 2,
        scopeHash: validScopeHash,
        authorizingUserId: ownerId,
        allowlistedTools: ["inspect_source"],
        allowedPairs: scopeItems,
      })
    , db);
    assert.equal(reconfirmed.responsibility.policyRevision, 2);

    const oldAuth = await db.agentAuthorization.findUniqueOrThrow({
      where: {
        responsibilityId_policyRevision: {
          responsibilityId: resp.id,
          policyRevision: 1,
        },
      },
    });
    assert.ok(oldAuth.revokedAt !== null, "Prior authorization must be revoked");

    // 5b. Negative test: allowedPairs differing from confirmed roster rejected
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          confirmResponsibility(tx, {
            workspaceId: workspaceIdA,
            responsibilityId: resp.id,
            expectedVersion: reconfirmed.responsibility.version,
            scopeHash: validScopeHash,
            authorizingUserId: ownerId,
            allowlistedTools: ["inspect_source"],
            allowedPairs: [
              ...scopeItems,
              { provider: "meta_ads", connectionId: connectionIdA, providerAccountId: "act_UNAUTHORIZED_EXTRA" },
            ],
          })
        , db),
      errorCode("allowed_pairs_mismatch")
    );

    // 5c. Negative test: update_scope -> resume must fail until fresh authorization matches current roster/hash/revisions
    const newScopeItems = [
      { provider: "meta_ads", connectionId: connectionIdA, providerAccountId: "act_a" },
      { provider: "meta_ads", connectionId: connectionIdA, providerAccountId: "act_b_new" },
    ];
    await agentConsoleTransaction(tx =>
      setResponsibilityScope(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: resp.id,
        scopeRevision: 3,
        items: newScopeItems,
      })
    , db);

    // Update responsibility to scopeRevision 3, status paused
    const pausedWithNewScope = await db.agentResponsibility.update({
      where: { id: resp.id },
      data: {
        scopeRevision: 3,
        status: "paused",
        version: { increment: 1 },
      },
    });

    // Attempting to resume fails because authorization is for scopeRevision 2
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          updateResponsibilityStatus(tx, {
            workspaceId: workspaceIdA,
            responsibilityId: resp.id,
            expectedVersion: pausedWithNewScope.version,
            status: "active",
            actorUserId: ownerId,
          })
        , db),
      errorCode("authorization_required")
    );

    // 5d. Recheck authorizer: authorizer demotion rejects resume
    // Create dedicated admin user for authorizer demotion check
    const tempAdminId = `u-temp-admin-${suffix}`;
    await db.user.create({
      data: { id: tempAdminId, email: `tempadmin-${suffix}@example.test`, name: "Temp Admin", plan: "professional" },
    });
    await db.workspaceMember.create({
      data: { workspaceId: workspaceIdA, userId: tempAdminId, role: "admin" },
    });

    const newScopeHash = computeCanonicalScopeHash(newScopeItems);
    const authByAdmin = await agentConsoleTransaction(tx =>
      confirmResponsibility(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: resp.id,
        expectedVersion: pausedWithNewScope.version,
        scopeHash: newScopeHash,
        authorizingUserId: tempAdminId,
        allowlistedTools: ["inspect_source"],
        allowedPairs: newScopeItems,
      })
    , db);
    assert.equal(authByAdmin.responsibility.status, "active");

    // Pause it
    const pausedResp = await agentConsoleTransaction(tx =>
      updateResponsibilityStatus(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: resp.id,
        expectedVersion: authByAdmin.responsibility.version,
        status: "paused",
        actorUserId: ownerId,
      })
    , db);

    // Demote tempAdminId to viewer
    await db.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: workspaceIdA, userId: tempAdminId } },
      data: { role: "viewer" },
    });

    // Resuming now fails with authorizer_permission_lost!
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          updateResponsibilityStatus(tx, {
            workspaceId: workspaceIdA,
            responsibilityId: resp.id,
            expectedVersion: pausedResp.version,
            status: "active",
            actorUserId: ownerId,
          })
        , db),
      errorCode("authorizer_permission_lost")
    );
  });

  it("6. Exact approval binding and concurrent single-use consumption", async () => {
    const test6ScopeItems = [{ provider: "meta_ads", connectionId: connectionIdA, providerAccountId: "act_12345" }];
    const test6ScopeHash = computeCanonicalScopeHash(test6ScopeItems);

    const respConfirmed = await agentConsoleTransaction(async tx => {
      const r = await createResponsibility(tx, {
        workspaceId: workspaceIdA,
        ownerId,
        createdByUserId: adminId,
        configuration: {},
      });
      await setResponsibilityScope(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: r.id,
        scopeRevision: 1,
        items: test6ScopeItems,
      });
      return confirmResponsibility(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: r.id,
        expectedVersion: 0,
        authorizingUserId: adminId,
        scopeHash: test6ScopeHash,
        allowlistedTools: ["submit_recovery_import", "inspect_source"],
        allowedPairs: test6ScopeItems,
      });
    }, db);

    const { caseRecord } = await agentConsoleTransaction(tx =>
      openOrUpdateCase(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respConfirmed.responsibility.id,
        fingerprint: `fp_test_6_${suffix}`,
        title: "Test 6 Case",
      })
    , db);

    const { operation } = await agentConsoleTransaction(tx =>
      enqueueOperation(tx, {
        workspaceId: workspaceIdA,
        caseId: caseRecord.id,
        operationKey: "op_approval_binding",
        toolName: "submit_recovery_import",
        arguments: { connectionId: connectionIdA, provider: "meta_ads", adAccountId: "act_12345", days: 14 },
        scopeHash: test6ScopeHash,
        policyRevision: 1,
      })
    , db);

    const proposalHash = "prop_hash_999";
    const evidenceFingerprint = "ev_fp_888";

    // Seed valid evidence snapshot for ev_fp_888
    await db.agentEvidenceSnapshot.create({
      data: {
        workspaceId: workspaceIdA,
        datasetFingerprint: evidenceFingerprint,
        actualSince: new Date("2026-09-01"),
        actualUntil: new Date("2026-09-07"),
        metrics: {},
        inventory: {},
        provenance: {},
        isExpired: false,
      },
    });

    const approval = await agentConsoleTransaction(tx =>
      createApproval(tx, {
        workspaceId: workspaceIdA,
        operationId: operation.id,
        proposalHash,
        evidenceFingerprint,
        policyRevision: 1,
        scopeRevision: 1,
        expiresAt: new Date(Date.now() + 60_000), // 1 min validity
      })
    , db);

    // Mismatched proposalHash rejected
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          consumeApproval(tx, {
            workspaceId: workspaceIdA,
            approvalId: approval.id,
            operationId: operation.id,
            proposalHash: "wrong_proposal_hash",
            evidenceFingerprint,
            policyRevision: 1,
            scopeRevision: 1,
            actorUserId: ownerId,
          })
        , db),
      errorCode("approval_binding_mismatch")
    );

    // Mismatched evidenceFingerprint rejected
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          consumeApproval(tx, {
            workspaceId: workspaceIdA,
            approvalId: approval.id,
            operationId: operation.id,
            proposalHash,
            evidenceFingerprint: "wrong_fingerprint",
            policyRevision: 1,
            scopeRevision: 1,
            actorUserId: ownerId,
          })
        , db),
      errorCode("approval_binding_mismatch")
    );

    // Mismatched scopeRevision rejected
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          consumeApproval(tx, {
            workspaceId: workspaceIdA,
            approvalId: approval.id,
            operationId: operation.id,
            proposalHash,
            evidenceFingerprint,
            policyRevision: 1,
            scopeRevision: 999, // Mismatched!
            actorUserId: ownerId,
          })
        , db),
      errorCode("approval_binding_mismatch")
    );

    // Expired underlying evidence snapshot rejects approval consumption
    const expiredEvFp = `fp_expired_ev_${suffix}`;
    await db.agentEvidenceSnapshot.create({
      data: {
        workspaceId: workspaceIdA,
        datasetFingerprint: expiredEvFp,
        actualSince: new Date("2026-09-01"),
        actualUntil: new Date("2026-09-07"),
        metrics: {},
        inventory: {},
        provenance: {},
        isExpired: true, // Marked expired
      },
    });

    const approvalWithExpiredEv = await agentConsoleTransaction(tx =>
      createApproval(tx, {
        workspaceId: workspaceIdA,
        operationId: operation.id,
        proposalHash: "prop_with_expired_ev",
        evidenceFingerprint: expiredEvFp,
        policyRevision: 1,
        scopeRevision: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
    , db);

    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          consumeApproval(tx, {
            workspaceId: workspaceIdA,
            approvalId: approvalWithExpiredEv.id,
            operationId: operation.id,
            proposalHash: "prop_with_expired_ev",
            evidenceFingerprint: expiredEvFp,
            policyRevision: 1,
            scopeRevision: 1,
            actorUserId: ownerId,
          })
        , db),
      errorCode("approval_expired")
    );

    // Concurrent single-use consumption: exactly ONE succeeds, the second throws 409
    const results = await Promise.allSettled([
      agentConsoleTransaction(tx =>
        consumeApproval(tx, {
          workspaceId: workspaceIdA,
          approvalId: approval.id,
          operationId: operation.id,
          proposalHash,
          evidenceFingerprint,
          policyRevision: 1,
          scopeRevision: 1,
          actorUserId: ownerId,
        })
      , db),
      agentConsoleTransaction(tx =>
        consumeApproval(tx, {
          workspaceId: workspaceIdA,
          approvalId: approval.id,
          operationId: operation.id,
          proposalHash,
          evidenceFingerprint,
          policyRevision: 1,
          scopeRevision: 1,
          actorUserId: ownerId,
        })
      , db),
    ]);

    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "Exactly one consume call must succeed");
    assert.equal(rejected.length, 1, "Competing consume call must be rejected");

    const consumedRecord = await db.agentApproval.findUniqueOrThrow({
      where: { id: approval.id },
    });
    assert.equal(consumedRecord.isSingleUseConsumed, true);
    assert.equal(consumedRecord.status, "consumed");

    // Any subsequent consumption attempt rejects
    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          consumeApproval(tx, {
            workspaceId: workspaceIdA,
            approvalId: approval.id,
            operationId: operation.id,
            proposalHash,
            evidenceFingerprint,
            policyRevision: 1,
            scopeRevision: 1,
            actorUserId: ownerId,
          })
        , db),
      errorCode("approval_already_consumed")
    );

    // 6b. Missing evidence snapshot throws evidence_missing
    const approvalMissingEv = await agentConsoleTransaction(tx =>
      createApproval(tx, {
        workspaceId: workspaceIdA,
        operationId: operation.id,
        proposalHash: "prop_missing_ev",
        evidenceFingerprint: "ev_non_existent_fp",
        policyRevision: 1,
        scopeRevision: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
    , db);

    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          consumeApproval(tx, {
            workspaceId: workspaceIdA,
            approvalId: approvalMissingEv.id,
            operationId: operation.id,
            proposalHash: "prop_missing_ev",
            evidenceFingerprint: "ev_non_existent_fp",
            policyRevision: 1,
            scopeRevision: 1,
            actorUserId: ownerId,
          })
        , db),
      errorCode("evidence_missing")
    );

    // 6c. Operation state must be queued: operation in executing/failed throws invalid_operation_state
    const opFailed = await agentConsoleTransaction(tx =>
      enqueueOperation(tx, {
        workspaceId: workspaceIdA,
        caseId: caseRecord.id,
        operationKey: "op_failed_state_test",
        toolName: "submit_recovery_import",
        arguments: { connectionId: connectionIdA, provider: "meta_ads", adAccountId: "act_12345", days: 3 },
        scopeHash: test6ScopeHash,
        policyRevision: 1,
      })
    , db);
    await db.agentOperation.update({
      where: { id: opFailed.operation.id },
      data: { state: "failed" },
    });

    const approvalOpFailed = await agentConsoleTransaction(tx =>
      createApproval(tx, {
        workspaceId: workspaceIdA,
        operationId: opFailed.operation.id,
        proposalHash: "prop_op_failed",
        evidenceFingerprint, // valid non-expired fingerprint
        policyRevision: 1,
        scopeRevision: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
    , db);

    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          consumeApproval(tx, {
            workspaceId: workspaceIdA,
            approvalId: approvalOpFailed.id,
            operationId: opFailed.operation.id,
            proposalHash: "prop_op_failed",
            evidenceFingerprint,
            policyRevision: 1,
            scopeRevision: 1,
            actorUserId: ownerId,
          })
        , db),
      errorCode("invalid_operation_state")
    );

    // 6d. Unbound operation rejected with unbound_operation
    const unboundOp = await agentConsoleTransaction(tx =>
      enqueueOperation(tx, {
        workspaceId: workspaceIdA,
        operationKey: `op_unbound_${suffix}`,
        toolName: "inspect_source",
        arguments: {},
        scopeHash: "hash_scope_1",
        policyRevision: 1,
      })
    , db);

    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          createApproval(tx, {
            workspaceId: workspaceIdA,
            operationId: unboundOp.operation.id,
            proposalHash: "prop_unbound",
            evidenceFingerprint,
            policyRevision: 1,
            scopeRevision: 1,
            expiresAt: new Date(Date.now() + 60_000),
          })
        , db),
      errorCode("unbound_operation")
    );

    // 6e. Evaluation-linked operation succeeds when responsibility and authorization exist
    const evalForOp = await agentConsoleTransaction(tx =>
      recordEvaluation(tx, {
        workspaceId: workspaceIdA,
        responsibilityId: respConfirmed.responsibility.id,
        configVersion: 0,
        scopeRevision: 1,
        policyRevision: 1,
        scheduledSlot: new Date("2026-10-01T20:00:00Z"),
        status: "success",
      })
    , db);

    const evalOp = await agentConsoleTransaction(tx =>
      enqueueOperation(tx, {
        workspaceId: workspaceIdA,
        evaluationId: evalForOp.evaluation.id,
        operationKey: `op_eval_linked_${suffix}`,
        toolName: "inspect_source",
        arguments: { connectionId: connectionIdA, provider: "meta_ads", adAccountId: "act_12345" },
        scopeHash: test6ScopeHash,
        policyRevision: 1,
      })
    , db);

    const evalApproval = await agentConsoleTransaction(tx =>
      createApproval(tx, {
        workspaceId: workspaceIdA,
        operationId: evalOp.operation.id,
        proposalHash: "prop_eval_linked",
        evidenceFingerprint,
        evidenceRevision: 1,
        policyRevision: 1,
        scopeRevision: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
    , db);

    const consumedEvalApproval = await agentConsoleTransaction(tx =>
      consumeApproval(tx, {
        workspaceId: workspaceIdA,
        approvalId: evalApproval.id,
        operationId: evalOp.operation.id,
        proposalHash: "prop_eval_linked",
        evidenceFingerprint,
        evidenceRevision: 1,
        policyRevision: 1,
        scopeRevision: 1,
        actorUserId: ownerId,
      })
    , db);
    assert.equal(consumedEvalApproval.status, "consumed");

    // 6f. Tool not allowlisted rejected in consumeApproval
    const unallowedToolOp = await agentConsoleTransaction(tx =>
      enqueueOperation(tx, {
        workspaceId: workspaceIdA,
        caseId: caseRecord.id,
        operationKey: `op_unallowed_tool_${suffix}`,
        toolName: "unauthorized_tool_name",
        arguments: { connectionId: connectionIdA, provider: "meta_ads" },
        scopeHash: test6ScopeHash,
        policyRevision: 1,
      })
    , db);

    const unallowedToolApproval = await agentConsoleTransaction(tx =>
      createApproval(tx, {
        workspaceId: workspaceIdA,
        operationId: unallowedToolOp.operation.id,
        proposalHash: "prop_unallowed_tool",
        evidenceFingerprint,
        evidenceRevision: 1,
        policyRevision: 1,
        scopeRevision: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
    , db);

    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          consumeApproval(tx, {
            workspaceId: workspaceIdA,
            approvalId: unallowedToolApproval.id,
            operationId: unallowedToolOp.operation.id,
            proposalHash: "prop_unallowed_tool",
            evidenceFingerprint,
            evidenceRevision: 1,
            policyRevision: 1,
            scopeRevision: 1,
            actorUserId: ownerId,
          })
        , db),
      errorCode("tool_not_allowlisted")
    );

    // 6g. Target connection not authorized rejected in consumeApproval
    const unallowedTargetOp = await agentConsoleTransaction(tx =>
      enqueueOperation(tx, {
        workspaceId: workspaceIdA,
        caseId: caseRecord.id,
        operationKey: `op_unallowed_target_${suffix}`,
        toolName: "inspect_source",
        arguments: { connectionId: "conn_unauthorized_999", provider: "meta_ads" },
        scopeHash: test6ScopeHash,
        policyRevision: 1,
      })
    , db);

    const unallowedTargetApproval = await agentConsoleTransaction(tx =>
      createApproval(tx, {
        workspaceId: workspaceIdA,
        operationId: unallowedTargetOp.operation.id,
        proposalHash: "prop_unallowed_target",
        evidenceFingerprint,
        evidenceRevision: 1,
        policyRevision: 1,
        scopeRevision: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
    , db);

    await assert.rejects(
      () =>
        agentConsoleTransaction(tx =>
          consumeApproval(tx, {
            workspaceId: workspaceIdA,
            approvalId: unallowedTargetApproval.id,
            operationId: unallowedTargetOp.operation.id,
            proposalHash: "prop_unallowed_target",
            evidenceFingerprint,
            evidenceRevision: 1,
            policyRevision: 1,
            scopeRevision: 1,
            actorUserId: ownerId,
          })
        , db),
      errorCode("target_not_authorized")
    );
  });

  it("7. Outbox replay and crash recovery", async () => {
    const { caseRecord } = await agentConsoleTransaction(tx =>
      openOrUpdateCase(tx, {
        workspaceId: workspaceIdA,
        fingerprint: "fp_outbox_replay",
        title: "Outbox Replay Case",
      })
    , db);

    const deliveryKey = `deliv:${caseRecord.id}:1:detected`;

    const outbox1 = await agentConsoleTransaction(tx =>
      publishNotificationOutbox(tx, {
        workspaceId: workspaceIdA,
        caseId: caseRecord.id,
        recipientUserId: ownerId,
        deliveryKey,
        payload: { summary: "Case detected" },
      })
    , db);
    assert.equal(outbox1.created, true);
    assert.equal(outbox1.outbox.status, "pending");

    // Replay with same deliveryKey returns existing without creating duplicate
    const outbox2 = await agentConsoleTransaction(tx =>
      publishNotificationOutbox(tx, {
        workspaceId: workspaceIdA,
        caseId: caseRecord.id,
        recipientUserId: ownerId,
        deliveryKey,
        payload: { summary: "Case detected" },
      })
    , db);
    assert.equal(outbox2.created, false);
    assert.equal(outbox2.outbox.id, outbox1.outbox.id);

    const count = await db.agentNotificationOutbox.count({
      where: { workspaceId: workspaceIdA, deliveryKey },
    });
    assert.equal(count, 1);
  });

  it("8. Retention cleanup and workspace deletion cascade", async () => {
    // Create an old evidence snapshot and a new evidence snapshot
    const oldSnapshot = await db.agentEvidenceSnapshot.create({
      data: {
        workspaceId: workspaceIdA,
        datasetFingerprint: "fp_old",
        actualSince: new Date("2026-01-01"),
        actualUntil: new Date("2026-01-31"),
        metrics: {},
        inventory: {},
        provenance: {},
        createdAt: new Date("2026-02-01T00:00:00Z"), // 7 months ago
      },
    });

    const newSnapshot = await db.agentEvidenceSnapshot.create({
      data: {
        workspaceId: workspaceIdA,
        datasetFingerprint: "fp_recent",
        actualSince: new Date("2026-09-01"),
        actualUntil: new Date("2026-09-30"),
        metrics: {},
        inventory: {},
        provenance: {},
        createdAt: new Date(), // Now
      },
    });

    // Create an old console event and a new console event
    await db.agentConsoleEvent.create({
      data: {
        workspaceId: workspaceIdA,
        type: "old_event",
        payload: {},
        sequence: 1,
        createdAt: new Date("2026-08-01T00:00:00Z"), // 60 days ago
      },
    });

    await db.agentConsoleEvent.create({
      data: {
        workspaceId: workspaceIdA,
        type: "recent_event",
        payload: {},
        sequence: 2,
        createdAt: new Date(),
      },
    });

    // Run retention cleanup with 180-day cutoff for evidence and 30-day cutoff for events
    const evidenceCutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const eventCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const cleanup = await agentConsoleTransaction(tx =>
      cleanupRetention(tx, {
        workspaceId: workspaceIdA,
        evidenceRetentionCutoff: evidenceCutoff,
        eventRetentionCutoff: eventCutoff,
      })
    , db);

    assert.equal(cleanup.expiredEvidenceCount, 1);
    assert.equal(cleanup.deletedEventsCount, 1);

    const reloadedOld = await db.agentEvidenceSnapshot.findUniqueOrThrow({
      where: { id: oldSnapshot.id },
    });
    assert.equal(reloadedOld.isExpired, true);

    const reloadedNew = await db.agentEvidenceSnapshot.findUniqueOrThrow({
      where: { id: newSnapshot.id },
    });
    assert.equal(reloadedNew.isExpired, false);

    // 8d. Bounded batch cleanup: batchSize parameter limits items processed per batch
    for (let i = 0; i < 4; i++) {
      await db.agentEvidenceSnapshot.create({
        data: {
          workspaceId: workspaceIdA,
          datasetFingerprint: `fp_batch_${i}_${suffix}`,
          actualSince: new Date("2026-01-01"),
          actualUntil: new Date("2026-01-31"),
          metrics: {},
          inventory: {},
          provenance: {},
          createdAt: new Date("2026-01-01T00:00:00Z"),
          isExpired: false,
        },
      });
    }

    const batch1 = await agentConsoleTransaction(tx =>
      cleanupRetention(tx, {
        workspaceId: workspaceIdA,
        evidenceRetentionCutoff: evidenceCutoff,
        eventRetentionCutoff: eventCutoff,
        batchSize: 2,
      })
    , db);
    assert.equal(batch1.expiredEvidenceCount, 2, "Batch size limit 2 must only process 2 items in first execution");

    // Verify monotonic event sequence even after retention purge of event sequence 1
    const postCleanupEvent = await agentConsoleTransaction(tx =>
      appendConsoleEvent(tx, {
        workspaceId: workspaceIdA,
        type: "post_cleanup_event",
        payload: { detail: "monotonic check" },
      })
    , db);
    assert.ok(postCleanupEvent.sequence >= 3, "New event sequence must be strictly monotonic despite earlier events being purged");

    // 8b. Monotonic sequence counter persistence: delete 100% of events in workspace,
    // then publish new event and ensure sequence continues monotonically without resetting to 1
    const prevSeq = postCleanupEvent.sequence;
    await db.agentConsoleEvent.deleteMany({
      where: { workspaceId: workspaceIdA },
    });
    assert.equal(await db.agentConsoleEvent.count({ where: { workspaceId: workspaceIdA } }), 0);

    const eventAfterFullPurge = await agentConsoleTransaction(tx =>
      appendConsoleEvent(tx, {
        workspaceId: workspaceIdA,
        type: "event_after_all_purged",
        payload: { check: "still monotonic" },
      })
    , db);
    assert.equal(
      eventAfterFullPurge.sequence,
      prevSeq + 1,
      `Sequence must be ${prevSeq + 1} and never reset to 1 even after all events are purged`
    );

    // 8c. Concurrent event writers get unique, strictly increasing sequences with 0 collisions
    const concurrentCount = 5;
    const concurrentEvents = await Promise.all(
      Array.from({ length: concurrentCount }, (_, i) =>
        agentConsoleTransaction(tx =>
          appendConsoleEvent(tx, {
            workspaceId: workspaceIdA,
            type: "concurrent_write_event",
            payload: { index: i },
          })
        , db)
      )
    );
    const sequences = concurrentEvents.map(e => e.sequence);
    const uniqueSequences = new Set(sequences);
    assert.equal(uniqueSequences.size, concurrentCount, "All concurrent writers must receive unique sequences");
    for (const seq of sequences) {
      assert.ok(seq > eventAfterFullPurge.sequence, `Sequence ${seq} must be greater than previous ${eventAfterFullPurge.sequence}`);
    }

    // Workspace deletion cascade test:
    // Create a temporary workspace with full C2 entity graph and delete it
    const tempWsId = `ws-cascade-${suffix}`;
    await db.workspace.create({
      data: { id: tempWsId, name: "Cascade WS", slug: tempWsId, ownerId, plan: "professional" },
    });
    await db.workspaceMember.create({
      data: { workspaceId: tempWsId, userId: ownerId, role: "owner" },
    });

    const tempResp = await db.agentResponsibility.create({
      data: {
        workspaceId: tempWsId,
        ownerId,
        createdByUserId: ownerId,
        configuration: {},
      },
    });

    const tempCase = await db.agentCase.create({
      data: {
        workspaceId: tempWsId,
        responsibilityId: tempResp.id,
        fingerprint: "fp_cascade",
        title: "Cascade Case",
      },
    });

    await db.agentNotificationOutbox.create({
      data: {
        workspaceId: tempWsId,
        caseId: tempCase.id,
        recipientUserId: ownerId,
        deliveryKey: "deliv_cascade",
        payload: {},
      },
    });

    // Delete workspace
    await db.workspace.delete({ where: { id: tempWsId } });

    // Assert all cascaded records were deleted cleanly
    assert.equal(await db.agentResponsibility.count({ where: { workspaceId: tempWsId } }), 0);
    assert.equal(await db.agentCase.count({ where: { workspaceId: tempWsId } }), 0);
    assert.equal(await db.agentNotificationOutbox.count({ where: { workspaceId: tempWsId } }), 0);
  });
});
