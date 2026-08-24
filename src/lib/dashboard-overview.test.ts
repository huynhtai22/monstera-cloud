import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDashboardDestinations,
  isDashboardImportOutcomeCurrent,
  latestValidDate,
  resolveDashboardSourceState,
  resolveDashboardWarehouseStatus,
  summarizeDashboardSyncCounts,
} from "./dashboard-overview";

const staleBefore = new Date("2026-08-24T00:00:00.000Z");

describe("dashboard overview source truth", () => {
  it("never presents disconnected or stale sources as fresh", () => {
    assert.equal(
      resolveDashboardSourceState({
        connectionStatus: "disconnected",
        lastError: null,
        lastSyncAt: new Date("2026-08-24T12:00:00.000Z"),
        isSyncing: false,
        staleBefore,
      }),
      "disconnected",
    );
    assert.equal(
      resolveDashboardSourceState({
        connectionStatus: "connected",
        lastError: null,
        lastSyncAt: new Date("2026-08-20T12:00:00.000Z"),
        isSyncing: false,
        staleBefore,
      }),
      "stale",
    );
  });

  it("distinguishes pending, syncing, and fresh connected sources", () => {
    assert.equal(
      resolveDashboardSourceState({
        connectionStatus: "connected",
        lastError: null,
        lastSyncAt: null,
        isSyncing: false,
        staleBefore,
      }),
      "pending",
    );
    assert.equal(
      resolveDashboardSourceState({
        connectionStatus: "connected",
        lastError: null,
        lastSyncAt: null,
        isSyncing: true,
        staleBefore,
      }),
      "syncing",
    );
    assert.equal(
      resolveDashboardSourceState({
        connectionStatus: "connected",
        lastError: null,
        lastSyncAt: new Date("2026-08-24T12:00:00.000Z"),
        isSyncing: false,
        staleBefore,
      }),
      "fresh",
    );
  });
});

describe("dashboard warehouse truth", () => {
  it("surfaces partial and failed imports even when historical rows remain", () => {
    const lastPulledAt = new Date("2026-08-24T12:00:00.000Z");
    assert.equal(
      resolveDashboardWarehouseStatus({
        latestImportStatus: "partial",
        latestImportAt: new Date("2026-08-24T13:00:00.000Z"),
        latestSyncStatus: "done",
        lastPulledAt,
        staleBefore,
      }),
      "partial",
    );
    assert.equal(
      resolveDashboardWarehouseStatus({
        latestImportStatus: "failed",
        latestImportAt: new Date("2026-08-24T13:00:00.000Z"),
        latestSyncStatus: "done",
        lastPulledAt,
        staleBefore,
      }),
      "failed",
    );
  });

  it("does not let an older failed batch override a newer successful pull", () => {
    const latestImportAt = new Date("2026-08-24T10:00:00.000Z");
    const lastPulledAt = new Date("2026-08-24T12:00:00.000Z");
    assert.equal(
      isDashboardImportOutcomeCurrent({ latestImportAt, lastPulledAt }),
      false,
    );
    assert.equal(
      resolveDashboardWarehouseStatus({
        latestImportStatus: "failed",
        latestImportAt,
        latestSyncStatus: "done",
        lastPulledAt,
        staleBefore,
      }),
      "fresh",
    );
  });

  it("uses the latest valid fact timestamp across advertising and retail facts", () => {
    assert.equal(
      latestValidDate([
        new Date("2026-08-20T00:00:00.000Z"),
        "2026-08-23T00:00:00.000Z",
        "not-a-date",
      ])?.toISOString(),
      "2026-08-23T00:00:00.000Z",
    );
  });
});

describe("dashboard destination truth", () => {
  it("shows available destination rows without claiming any are active", () => {
    const result = buildDashboardDestinations({
      destinationConnections: [],
      pipelines: [],
      apiKeysCount: 0,
      latestLookerStatus: null,
    });

    assert.deepEqual(result.activeNames, []);
    assert.deepEqual(result.list.map((destination) => destination.status), [
      "unconfigured",
      "unconfigured",
      "unconfigured",
    ]);
  });

  it("requires a successful Sheets pipeline before calling Sheets healthy", () => {
    const destination = { id: "sheet-1", provider: "google_sheets", status: "connected" };
    const basePipeline = {
      destinationConnectionId: destination.id,
      status: "active",
      healthStatus: "healthy",
      lastSyncedAt: null,
      destinationConnection: { provider: "google_sheets", status: "connected" },
    };

    const waiting = buildDashboardDestinations({
      destinationConnections: [destination],
      pipelines: [basePipeline],
      apiKeysCount: 0,
    });
    assert.equal(waiting.list[0].status, "ready");
    assert.deepEqual(waiting.activeNames, []);

    const active = buildDashboardDestinations({
      destinationConnections: [destination],
      pipelines: [{ ...basePipeline, lastSyncedAt: new Date("2026-08-24T12:00:00.000Z") }],
      apiKeysCount: 0,
    });
    assert.equal(active.list[0].status, "healthy");
    assert.deepEqual(active.activeNames, ["Sheets"]);
  });

  it("surfaces mixed healthy and failed Sheets pipelines as partial", () => {
    const destination = { id: "sheet-1", provider: "google_sheets", status: "connected" };
    const result = buildDashboardDestinations({
      destinationConnections: [destination],
      pipelines: [
        {
          destinationConnectionId: destination.id,
          status: "active",
          healthStatus: "healthy",
          lastSyncedAt: new Date("2026-08-24T12:00:00.000Z"),
          destinationConnection: { provider: "google_sheets", status: "connected" },
        },
        {
          destinationConnectionId: destination.id,
          status: "active",
          healthStatus: "error",
          lastSyncedAt: new Date("2026-08-24T11:00:00.000Z"),
          destinationConnection: { provider: "google_sheets", status: "connected" },
        },
      ],
      apiKeysCount: 0,
    });

    assert.equal(result.list[0].status, "partial");
    assert.deepEqual(result.activeNames, []);
  });

  it("treats an API key as active REST access but only ready Looker access until a query succeeds", () => {
    const configured = buildDashboardDestinations({
      destinationConnections: [],
      pipelines: [],
      apiKeysCount: 1,
      latestLookerStatus: null,
    });
    assert.equal(configured.list[1].status, "ready");
    assert.equal(configured.list[2].status, "active");
    assert.deepEqual(configured.activeNames, ["REST API"]);

    const used = buildDashboardDestinations({
      destinationConnections: [],
      pipelines: [],
      apiKeysCount: 1,
      latestLookerStatus: "done",
    });
    assert.equal(used.list[1].status, "healthy");
    assert.deepEqual(used.activeNames, ["Looker Studio", "REST API"]);
  });

  it("keeps an in-progress Looker destination operationally active", () => {
    const result = buildDashboardDestinations({
      destinationConnections: [],
      pipelines: [],
      apiKeysCount: 1,
      latestLookerStatus: "running",
      hasCompletedLookerQuery: true,
    });

    assert.equal(result.list[1].status, "syncing");
    assert.deepEqual(result.activeNames, ["Looker Studio", "REST API"]);
  });
});

describe("dashboard sync totals", () => {
  it("uses complete grouped counts rather than the capped recent-activity list", () => {
    assert.deepEqual(
      summarizeDashboardSyncCounts([
        { status: "success", _count: { _all: 87 } },
        { status: "error", _count: { _all: 13 } },
      ]),
      { successful: 87, failed: 13 },
    );
  });
});
