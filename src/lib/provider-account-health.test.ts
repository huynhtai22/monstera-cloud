import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import prisma from "@/lib/prisma";
import {
  categorizeProviderError,
  recordAccountOutcome,
  getSkippedAccountIds,
  QUARANTINE_THRESHOLD,
} from "./provider-account-health";

describe("provider-account-health unit tests", () => {
  describe("categorizeProviderError", () => {
    it("categorizes auth errors as AUTH_EXPIRED", () => {
      assert.equal(
        categorizeProviderError("Error validating access token: Session has expired"),
        "AUTH_EXPIRED"
      );
      assert.equal(categorizeProviderError("OAuthException code 190"), "AUTH_EXPIRED");
      assert.equal(categorizeProviderError("Token was revoked by user"), "AUTH_EXPIRED");
      assert.equal(categorizeProviderError("invalid_grant: refresh token expired"), "AUTH_EXPIRED");
    });

    it("categorizes permission and developer token errors as PERMISSION_DENIED", () => {
      assert.equal(
        categorizeProviderError("DEVELOPER_TOKEN_NOT_APPROVED"),
        "PERMISSION_DENIED"
      );
      assert.equal(
        categorizeProviderError("User does not have permission for ad account"),
        "PERMISSION_DENIED"
      );
      assert.equal(
        categorizeProviderError("Account has been disabled or suspended"),
        "PERMISSION_DENIED"
      );
    });

    it("categorizes 429 and quota errors as RATE_LIMITED", () => {
      assert.equal(categorizeProviderError("User request limit reached (429)"), "RATE_LIMITED");
      assert.equal(categorizeProviderError("Rate limit exceeded for provider"), "RATE_LIMITED");
      assert.equal(categorizeProviderError("API calls quota exceeded"), "RATE_LIMITED");
    });

    it("categorizes schema mismatch as SCHEMA_DRIFT", () => {
      assert.equal(categorizeProviderError("Schema drift detected in report payload"), "SCHEMA_DRIFT");
      assert.equal(categorizeProviderError("Missing property expected column"), "SCHEMA_DRIFT");
    });

    it("categorizes socket timeouts as TRANSIENT_NETWORK", () => {
      assert.equal(categorizeProviderError("Connection ECONNRESET"), "TRANSIENT_NETWORK");
      assert.equal(categorizeProviderError("Gateway timeout 504"), "TRANSIENT_NETWORK");
      assert.equal(categorizeProviderError("Socket hang up after 30000ms"), "TRANSIENT_NETWORK");
    });

    it("falls back to UNKNOWN for generic errors", () => {
      assert.equal(categorizeProviderError("Something random failed"), "UNKNOWN");
    });
  });

  describe("recordAccountOutcome with Prisma mock", () => {
    let mockStore: Map<string, any>;

    beforeEach(() => {
      mockStore = new Map();

      (prisma as any).providerAccountHealth = {
        findUnique: async ({ where }: any) => {
          const key = `${where.connectionId_accountId.connectionId}:${where.connectionId_accountId.accountId}`;
          return mockStore.get(key) || null;
        },
        upsert: async ({ where, create, update }: any) => {
          const key = `${where.connectionId_accountId.connectionId}:${where.connectionId_accountId.accountId}`;
          const existing = mockStore.get(key);
          const val = existing ? { ...existing, ...update } : { ...create };
          mockStore.set(key, val);
          return val;
        },
        findMany: async ({ where }: any) => {
          const results: any[] = [];
          for (const val of mockStore.values()) {
            if (where.connectionId && val.connectionId !== where.connectionId) continue;
            if (where.status?.in && !where.status.in.includes(val.status)) continue;
            results.push(val);
          }
          return results;
        },
      };

      // Mock support ticket & alerts dependencies
      (prisma as any).supportTicket = {
        findFirst: async () => null,
        create: async ({ data }: any) => ({ id: "mock-ticket", ...data }),
        update: async ({ data }: any) => ({ id: "mock-ticket", ...data }),
      };
      (prisma as any).workspace = {
        findUnique: async () => ({ telegramChatId: null }),
      };
    });

    it("resets consecutiveFailures and marks status healthy on success", async () => {
      await recordAccountOutcome({
        workspaceId: "ws-1",
        connectionId: "conn-1",
        provider: "meta_ads",
        accountId: "act-1",
        ok: true,
      });

      const row = mockStore.get("conn-1:act-1");
      assert.equal(row.status, "healthy");
      assert.equal(row.consecutiveFailures, 0);
      assert.equal(row.errorCategory, null);
      assert.ok(row.lastSuccessAt);
    });

    it("marks reconnect_required immediately on auth failure", async () => {
      await recordAccountOutcome({
        workspaceId: "ws-1",
        connectionId: "conn-1",
        provider: "meta_ads",
        accountId: "act-auth",
        ok: false,
        authFailure: true,
        error: "OAuthException code 190 token expired",
      });

      const row = mockStore.get("conn-1:act-auth");
      assert.equal(row.status, "reconnect_required");
      assert.equal(row.errorCategory, "AUTH_EXPIRED");
      assert.equal(row.consecutiveFailures, 1);

      const skipped = await getSkippedAccountIds("conn-1");
      assert.ok(skipped.has("act-auth"));
    });

    it("degrades on retryable errors and never quarantines even beyond threshold", async () => {
      for (let i = 0; i < QUARANTINE_THRESHOLD + 2; i++) {
        await recordAccountOutcome({
          workspaceId: "ws-1",
          connectionId: "conn-1",
          provider: "meta_ads",
          accountId: "act-rate",
          ok: false,
          retryable: true,
          error: "Rate limit 429",
        });
      }

      const row = mockStore.get("conn-1:act-rate");
      assert.equal(row.status, "degraded");
      assert.equal(row.consecutiveFailures, QUARANTINE_THRESHOLD + 2);

      const skipped = await getSkippedAccountIds("conn-1");
      assert.ok(!skipped.has("act-rate"), "degraded accounts are not skipped");
    });

    it("quarantines on non-retryable failures reaching QUARANTINE_THRESHOLD", async () => {
      for (let i = 0; i < QUARANTINE_THRESHOLD - 1; i++) {
        await recordAccountOutcome({
          workspaceId: "ws-1",
          connectionId: "conn-1",
          provider: "meta_ads",
          accountId: "act-bad",
          ok: false,
          retryable: false,
          error: "Account disabled by provider",
        });
      }
      let row = mockStore.get("conn-1:act-bad");
      assert.equal(row.status, "degraded");

      // Reach threshold
      await recordAccountOutcome({
        workspaceId: "ws-1",
        connectionId: "conn-1",
        provider: "meta_ads",
        accountId: "act-bad",
        ok: false,
        retryable: false,
        error: "Account disabled by provider",
      });

      row = mockStore.get("conn-1:act-bad");
      assert.equal(row.status, "quarantined");
      assert.equal(row.consecutiveFailures, QUARANTINE_THRESHOLD);

      const skipped = await getSkippedAccountIds("conn-1");
      assert.ok(skipped.has("act-bad"), "quarantined account is skipped");
    });
  });
});
