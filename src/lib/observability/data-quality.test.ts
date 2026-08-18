import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  evaluateRule,
  recordViolation,
  inspectObservedSchema,
  type DataQualityRule,
} from "./data-quality";
import prisma from "@/lib/prisma";

describe("Data Quality Rules Engine & Notification Boundary", () => {
  const mockWorkspaceId = "ws-quality-test-123";
  let capturedTelegramRequests: any[] = [];
  let capturedViolations: any[] = [];

  beforeEach(() => {
    capturedTelegramRequests = [];
    capturedViolations = [];

    // Mock global fetch for Telegram webhook spying
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("api.telegram.org")) {
        capturedTelegramRequests.push({
          url: urlStr,
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("OK", { status: 200 });
    }) as any;

    process.env.TELEGRAM_BOT_TOKEN = "mock-bot-token-123";
    process.env.TELEGRAM_ALERT_CHAT_ID = "-100987654321";

    // Mock prisma for violations and workspace queries
    (prisma as any).workspace = {
      findUnique: async () => ({
        id: mockWorkspaceId,
        name: "Test Quality Workspace",
        telegramChatId: "-100987654321",
      }),
    };

    (prisma as any).dataQualityViolation = {
      create: async ({ data }: any) => {
        capturedViolations.push(data);
        return { id: `violation-${Date.now()}`, ...data };
      },
    };
  });

  describe("Operator & Anomaly Evaluations", () => {
    it("detects threshold violations for greater-than operator", () => {
      const rule: DataQualityRule = {
        id: "rule-gt",
        name: "Spend Cap",
        ruleType: "threshold",
        metric: "spend",
        operator: "gt",
        threshold: 500,
        severity: "critical",
      };

      const res = evaluateRule(rule, {
        metric: "spend",
        current: 650,
        timestamp: new Date(),
      });
      assert.equal(res.violated, true);
      assert.equal(res.actualValue, 650);
      assert.equal(res.expectedValue, 500);
    });

    it("detects threshold violations for less-than operator (e.g. zero row sync)", () => {
      const rule: DataQualityRule = {
        id: "rule-lt",
        name: "Minimum Row Ingestion",
        ruleType: "threshold",
        metric: "row_count",
        operator: "lt",
        threshold: 10,
        severity: "warning",
      };

      const res = evaluateRule(rule, {
        metric: "row_count",
        current: 0,
        timestamp: new Date(),
      });
      assert.equal(res.violated, true);
      assert.equal(res.actualValue, 0);
    });

    it("detects exact equality threshold checks", () => {
      const rule: DataQualityRule = {
        id: "rule-eq",
        name: "Orders Match",
        ruleType: "threshold",
        metric: "orders",
        operator: "eq",
        threshold: 100,
        severity: "warning",
      };

      const res = evaluateRule(rule, {
        metric: "orders",
        current: 95,
        timestamp: new Date(),
      });
      assert.equal(res.violated, true);
    });

    it("detects significant drop percentage anomalies", () => {
      const rule: DataQualityRule = {
        id: "rule-drop",
        name: "Revenue Drop Alert",
        ruleType: "comparison",
        metric: "revenue",
        operator: "drop_pct",
        pctThreshold: 0.3, // 30% drop threshold
        severity: "critical",
      };

      const res = evaluateRule(rule, {
        metric: "revenue",
        current: 600,
        previous: 1000, // 40% drop
        timestamp: new Date(),
      });
      assert.equal(res.violated, true);
      assert.equal(res.pctChange, -0.4);
    });

    it("detects significant increase percentage anomalies", () => {
      const rule: DataQualityRule = {
        id: "rule-inc",
        name: "Spend Spike Alert",
        ruleType: "comparison",
        metric: "spend",
        operator: "increase_pct",
        pctThreshold: 0.5, // 50% increase threshold
        severity: "critical",
      };

      const res = evaluateRule(rule, {
        metric: "spend",
        current: 1600,
        previous: 1000, // 60% increase
        timestamp: new Date(),
      });
      assert.equal(res.violated, true);
      assert.equal(res.pctChange, 0.6);
    });
  });

  describe("Schema Check Evaluations", () => {
    it("evaluates schema check rules and catches missing expected columns", () => {
      const rule: DataQualityRule = {
        id: "rule-schema",
        name: "Orders Table Schema",
        ruleType: "schema_check",
        metric: "orders",
        operator: "schema_check",
        severity: "critical",
        expectedColumns: ["orderId", "grossRevenue", "currency"],
      };

      // 1. Schema valid snapshot
      const resValid = evaluateRule(rule, {
        metric: "orders",
        current: 1,
        schemaValid: true,
        missingColumns: [],
        timestamp: new Date(),
      });
      assert.equal(resValid.violated, false);

      // 2. Schema invalid snapshot with missing columns
      const resInvalid = evaluateRule(rule, {
        metric: "orders",
        current: 0,
        schemaValid: false,
        missingColumns: ["grossRevenue"],
        timestamp: new Date(),
      });
      assert.equal(resInvalid.violated, true);
      assert.match(resInvalid.message, /missing columns \[grossRevenue\]/);
    });

    it("inspectObservedSchema accurately identifies missing columns from warehouse records and JSON rawData", async () => {
      (prisma as any).campaignMetric = {
        findFirst: async () => ({
          id: "cm-1",
          workspaceId: mockWorkspaceId,
          spend: 100,
          impressions: 5000,
          clicks: 200,
          rawData: JSON.stringify({ customMetaCost: 100, adSetId: "adset-123" }),
          date: new Date(),
        }),
      };
      (prisma as any).retailOrder = {
        findFirst: async () => null,
      };

      // 1. When all expected columns (including rawData JSON fields) are present
      const res1 = await inspectObservedSchema(mockWorkspaceId, undefined, ["spend", "clicks", "customMetaCost", "adSetId"]);
      assert.equal(res1.schemaValid, true);
      assert.equal(res1.missingColumns.length, 0);

      // 2. When expected columns are missing
      const res2 = await inspectObservedSchema(mockWorkspaceId, undefined, ["spend", "nonExistentField"]);
      assert.equal(res2.schemaValid, false);
      assert.deepEqual(res2.missingColumns, ["nonExistentField"]);
    });

    it("inspectObservedSchema safely handles malformed JSON in rawData without crashing", async () => {
      (prisma as any).campaignMetric = {
        findFirst: async () => ({
          id: "cm-2",
          workspaceId: mockWorkspaceId,
          spend: 100,
          rawData: "{ invalid_json: unquoted, broken: ",
          date: new Date(),
        }),
      };
      (prisma as any).retailOrder = {
        findFirst: async () => null,
      };

      const res = await inspectObservedSchema(mockWorkspaceId, undefined, ["spend", "missingRawField"]);
      assert.equal(res.schemaValid, false);
      assert.deepEqual(res.missingColumns, ["missingRawField"]);
    });

    it("inspectObservedSchema and evaluateRule fail when expectedColumns is empty", async () => {
      // Empty expectedColumns must fail
      const res = await inspectObservedSchema(mockWorkspaceId, undefined, []);
      assert.equal(res.schemaValid, false);
      assert.ok(res.missingColumns.length > 0);

      const emptyRule: DataQualityRule = {
        id: "rule-empty-cols",
        name: "Empty Columns Rule",
        ruleType: "schema_check",
        metric: "orders",
        operator: "schema_check",
        severity: "critical",
        expectedColumns: [],
      };

      const evalRes = evaluateRule(emptyRule, {
        metric: "orders",
        current: 1,
        schemaValid: true,
        timestamp: new Date(),
      });
      assert.equal(evalRes.violated, true);
      assert.match(evalRes.message, /invalid/i);
    });

    it("inspectObservedSchema scopes inspection to connection provider table", async () => {
      (prisma as any).connection = {
        findFirst: async ({ where }: any) => {
          if (where.id === "conn-meta-1") return { provider: "meta_ads" };
          if (where.id === "conn-shopee-1") return { provider: "shopee" };
          return null;
        },
      };

      (prisma as any).campaignMetric = {
        findFirst: async () => ({
          id: "cm-meta-1",
          workspaceId: mockWorkspaceId,
          spend: 500,
          date: new Date(),
        }),
      };

      (prisma as any).retailOrder = {
        findFirst: async () => ({
          id: "ro-shopee-1",
          workspaceId: mockWorkspaceId,
          orderId: "order-999",
          createdAtIso: new Date().toISOString(),
        }),
      };

      // For meta_ads connection: only checks CampaignMetric (has spend, does not have orderId)
      const resMeta = await inspectObservedSchema(mockWorkspaceId, "conn-meta-1", ["orderId"]);
      assert.equal(resMeta.schemaValid, false);
      assert.deepEqual(resMeta.missingColumns, ["orderId"]);

      // For shopee connection: only checks RetailOrder (has orderId)
      const resShopee = await inspectObservedSchema(mockWorkspaceId, "conn-shopee-1", ["orderId"]);
      assert.equal(resShopee.schemaValid, true);
    });

    it("inspectObservedSchema never defaults to passed when warehouse has no records or inspection fails", async () => {
      (prisma as any).campaignMetric = {
        findFirst: async () => null,
      };
      (prisma as any).retailOrder = {
        findFirst: async () => null,
      };

      const res = await inspectObservedSchema(mockWorkspaceId, undefined, ["orderId", "revenue"]);
      assert.equal(res.schemaValid, false);
      assert.deepEqual(res.missingColumns, ["orderId", "revenue"]);
    });
  });

  describe("Notification & Cooldown Boundary", () => {
    it("warning-only events record violations in DB but DO NOT send Telegram alerts", async () => {
      const warningRule: DataQualityRule = {
        id: "rule-warning-1",
        name: "Low Volume Warning",
        ruleType: "threshold",
        metric: "orders",
        operator: "lt",
        threshold: 5,
        severity: "warning",
        notifyTelegram: true,
      };

      await recordViolation(warningRule, mockWorkspaceId, {
        actualValue: 2,
        expectedValue: 5,
      });

      // Violation recorded in DB
      assert.equal(capturedViolations.length, 1);
      assert.equal(capturedViolations[0].ruleId, "rule-warning-1");

      // Telegram alert was NOT sent
      assert.equal(capturedTelegramRequests.length, 0);
    });

    it("warning-only events DO NOT start or consume the Telegram cooldown", async () => {
      const warningRule: DataQualityRule = {
        id: "rule-shared-cooldown-test",
        name: "Warning Anomaly",
        ruleType: "threshold",
        metric: "spend",
        operator: "gt",
        threshold: 50,
        severity: "warning",
        notifyTelegram: true,
      };

      // 1. Fire warning violation
      await recordViolation(warningRule, mockWorkspaceId, {
        actualValue: 100,
        expectedValue: 50,
      });
      assert.equal(capturedTelegramRequests.length, 0);

      // 2. Fire critical violation on the same rule id
      const criticalRule: DataQualityRule = {
        ...warningRule,
        severity: "critical",
      };
      await recordViolation(criticalRule, mockWorkspaceId, {
        actualValue: 200,
        expectedValue: 50,
      });

      // The critical alert MUST be sent because warning did not consume cooldown
      assert.equal(capturedTelegramRequests.length, 1);
      assert.match(capturedTelegramRequests[0].body.text, /CRITICAL/);
    });

    it("critical events with notifyTelegram: true send Telegram and enforce 1-hour cooldown", async () => {
      const criticalRule: DataQualityRule = {
        id: `rule-crit-${Date.now()}`,
        name: "Revenue Crash",
        ruleType: "comparison",
        metric: "revenue",
        operator: "drop_pct",
        pctThreshold: 0.5,
        severity: "critical",
        notifyTelegram: true,
      };

      // First critical event -> Sends alert
      await recordViolation(criticalRule, mockWorkspaceId, {
        actualValue: 100,
        expectedValue: 1000,
        pctChange: -0.9,
      });
      assert.equal(capturedTelegramRequests.length, 1);

      // Second immediate critical event on the same rule -> Suppressed by cooldown
      await recordViolation(criticalRule, mockWorkspaceId, {
        actualValue: 120,
        expectedValue: 1000,
        pctChange: -0.88,
      });
      assert.equal(capturedTelegramRequests.length, 1); // Still 1 (second was suppressed)
    });

    it("critical events with notifyTelegram: false suppress Telegram delivery", async () => {
      const silentRule: DataQualityRule = {
        id: `rule-silent-${Date.now()}`,
        name: "Silent Critical Check",
        ruleType: "threshold",
        metric: "spend",
        operator: "gt",
        threshold: 1000,
        severity: "critical",
        notifyTelegram: false,
      };

      await recordViolation(silentRule, mockWorkspaceId, {
        actualValue: 2000,
        expectedValue: 1000,
      });

      // Violation recorded in DB
      assert.equal(capturedViolations.length, 1);
      // No Telegram request made
      assert.equal(capturedTelegramRequests.length, 0);
    });
  });
});
