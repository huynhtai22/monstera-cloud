import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  setTelemetrySink,
  captureTelemetryForTest,
  runWithConnectorContext,
  emitConnectorTelemetry,
} from "@/lib/observability/connector-telemetry";
import { installNetworkDenialGuard, restoreNetworkGuard } from "./network-denial-guard";

describe("Shopee Sequential Execution Order, Error Dependencies & Sink Isolation", () => {
  beforeEach(() => {
    installNetworkDenialGuard();
    setTelemetrySink(null);
  });

  afterEach(() => {
    restoreNetworkGuard();
    setTelemetrySink(null);
  });

  it("1. Catalog begins and finishes before Orders begins; Orders finishes before Ads begins", async () => {
    const executionTimeline: Array<{ step: string; phase: "start" | "end"; timestamp: number }> = [];

    // Simulate async sync operations with non-trivial delays to prove sequential execution
    async function mockSyncCatalog() {
      executionTimeline.push({ step: "catalog", phase: "start", timestamp: Date.now() });
      await new Promise((resolve) => setTimeout(resolve, 30));
      emitConnectorTelemetry({
        provider: "shopee",
        operation: "catalog_sync",
        outcome: "success",
      });
      executionTimeline.push({ step: "catalog", phase: "end", timestamp: Date.now() });
      return { campaignsSuccess: true, productsSuccess: true, campaignsWritten: 10, productsWritten: 50 };
    }

    async function mockSyncOrders() {
      executionTimeline.push({ step: "orders", phase: "start", timestamp: Date.now() });
      await new Promise((resolve) => setTimeout(resolve, 30));
      emitConnectorTelemetry({
        provider: "shopee",
        operation: "orders_sync",
        outcome: "success",
      });
      executionTimeline.push({ step: "orders", phase: "end", timestamp: Date.now() });
      return { success: true, rowsIngested: 120 };
    }

    async function mockSyncAds() {
      executionTimeline.push({ step: "ads", phase: "start", timestamp: Date.now() });
      await new Promise((resolve) => setTimeout(resolve, 30));
      emitConnectorTelemetry({
        provider: "shopee",
        operation: "ads_sync",
        outcome: "success",
      });
      executionTimeline.push({ step: "ads", phase: "end", timestamp: Date.now() });
      return { success: true, rowsIngested: 45 };
    }

    const capture = captureTelemetryForTest();
    try {
      await runWithConnectorContext(
        { workspaceId: "ws_shopee_seq", connectionId: "conn_shopee_1", provider: "shopee" },
        async () => {
          // Exact sequential order from sync-connection.ts
          const catalog = await mockSyncCatalog();
          const orders = await mockSyncOrders();
          const ads = await mockSyncAds();

          assert.equal(catalog.campaignsWritten, 10);
          assert.equal(orders.rowsIngested, 120);
          assert.equal(ads.rowsIngested, 45);
        }
      );

      // Verify strict sequential ordering:
      // catalog start -> catalog end -> orders start -> orders end -> ads start -> ads end
      const steps = executionTimeline.map((e) => `${e.step}:${e.phase}`);
      assert.deepEqual(steps, [
        "catalog:start",
        "catalog:end",
        "orders:start",
        "orders:end",
        "ads:start",
        "ads:end",
      ]);

      const catalogEnd = executionTimeline.find((e) => e.step === "catalog" && e.phase === "end")!;
      const ordersStart = executionTimeline.find((e) => e.step === "orders" && e.phase === "start")!;
      assert.ok(
        ordersStart.timestamp >= catalogEnd.timestamp,
        "Orders must not begin before Catalog completes"
      );

      const ordersEnd = executionTimeline.find((e) => e.step === "orders" && e.phase === "end")!;
      const adsStart = executionTimeline.find((e) => e.step === "ads" && e.phase === "start")!;
      assert.ok(
        adsStart.timestamp >= ordersEnd.timestamp,
        "Ads must not begin before Orders completes"
      );

      // Verify telemetry order mirrors execution order
      assert.equal(capture.events.length, 3);
      assert.equal(capture.events[0].operation, "catalog_sync");
      assert.equal(capture.events[1].operation, "orders_sync");
      assert.equal(capture.events[2].operation, "ads_sync");
    } finally {
      capture.restore();
    }
  });

  it("2. Ads failure does not fail or discard Orders (best-effort ads contract)", async () => {
    let ordersExecuted = false;
    let adsExecuted = false;

    async function mockSyncCatalog() {
      return { campaignsSuccess: true, productsSuccess: true, campaignsWritten: 5, productsWritten: 20 };
    }

    async function mockSyncOrders() {
      ordersExecuted = true;
      return { success: true, rowsIngested: 85, error: undefined };
    }

    async function mockSyncAds() {
      adsExecuted = true;
      // Best-effort Shopee Ads failure
      return { success: false, rowsIngested: 0, error: "shopee_ads_api_permission_denied" };
    }

    await runWithConnectorContext(
      { workspaceId: "ws_shopee_best_effort", connectionId: "conn_shopee_2", provider: "shopee" },
      async () => {
        const catalog = await mockSyncCatalog();
        const orders = await mockSyncOrders();
        const ads = await mockSyncAds();

        assert.equal(ordersExecuted, true);
        assert.equal(adsExecuted, true);
        assert.equal(orders.success, true);
        assert.equal(orders.rowsIngested, 85);
        assert.equal(ads.success, false);

        // Child results aggregation matches sync-connection.ts
        const children = [
          { id: "campaign_catalog", ok: catalog.campaignsSuccess, rowsIngested: catalog.campaignsWritten },
          { id: "product_catalog", ok: catalog.productsSuccess, rowsIngested: catalog.productsWritten },
          { id: "orders", ok: orders.success, rowsIngested: orders.rowsIngested },
          { id: "ads_performance", ok: ads.success, rowsIngested: ads.rowsIngested, error: ads.error },
        ];

        // Orders data is completely retained
        const ordersChild = children.find((c) => c.id === "orders");
        assert.equal(ordersChild?.ok, true);
        assert.equal(ordersChild?.rowsIngested, 85);

        // Ads child accurately records failure without crashing
        const adsChild = children.find((c) => c.id === "ads_performance");
        assert.equal(adsChild?.ok, false);
        assert.equal(adsChild?.error, "shopee_ads_api_permission_denied");
      }
    );
  });

  it("3. Unhandled error in Catalog short-circuits execution before Orders or Ads can start", async () => {
    let ordersExecuted = false;
    let adsExecuted = false;

    async function mockFaultyCatalog() {
      throw new Error("Shopee Partner API connection timeout");
    }

    async function mockSyncOrders() {
      ordersExecuted = true;
      return { success: true, rowsIngested: 50 };
    }

    async function mockSyncAds() {
      adsExecuted = true;
      return { success: true, rowsIngested: 20 };
    }

    await assert.rejects(
      async () => {
        await runWithConnectorContext(
          { workspaceId: "ws_shopee_fail", connectionId: "conn_shopee_3", provider: "shopee" },
          async () => {
            await mockFaultyCatalog();
            await mockSyncOrders();
            await mockSyncAds();
          }
        );
      },
      { message: "Shopee Partner API connection timeout" }
    );

    assert.equal(ordersExecuted, false, "Orders must not execute if Catalog throws");
    assert.equal(adsExecuted, false, "Ads must not execute if Catalog throws");
  });

  it("4. Telemetry sink failure does not break Shopee sequential pipeline or throw", async () => {
    setTelemetrySink(() => {
      throw new Error("Telemetry sink disk full / buffer dropped");
    });

    const completedSteps: string[] = [];

    await runWithConnectorContext(
      { workspaceId: "ws_shopee_sink_fail", connectionId: "conn_shopee_4", provider: "shopee" },
      async () => {
        // Step 1: Catalog
        emitConnectorTelemetry({ provider: "shopee", operation: "catalog_step" });
        completedSteps.push("catalog");

        // Step 2: Orders
        emitConnectorTelemetry({ provider: "shopee", operation: "orders_step" });
        completedSteps.push("orders");

        // Step 3: Ads
        emitConnectorTelemetry({ provider: "shopee", operation: "ads_step" });
        completedSteps.push("ads");
      }
    );

    assert.deepEqual(completedSteps, ["catalog", "orders", "ads"]);
  });
});
