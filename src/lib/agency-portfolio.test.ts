import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveClientHealth,
  summarizeWorkspacesPortfolio,
  summarizeClientsPortfolio,
  type WorkspacePortfolioItem,
  type ClientWithConnections,
} from "./agency-portfolio";

describe("agency-portfolio helpers", () => {
  describe("deriveClientHealth", () => {
    it("returns pending when client has no connections", () => {
      const h = deriveClientHealth({ connections: [] });
      assert.equal(h.status, "pending");
      assert.equal(h.label, "No sources");
      assert.equal(h.failingCount, 0);
    });

    it("flags client as needs_attention if any connection has an error", () => {
      const h = deriveClientHealth({
        connections: [
          { id: "c1", name: "Meta Ads", provider: "meta_ads", status: "connected", lastSyncAt: "2026-08-31T10:00:00.000Z" },
          { id: "c2", name: "Google Ads", provider: "google_ads", status: "error", lastError: "OAuth expired" },
        ],
      });
      assert.equal(h.status, "needs_attention");
      assert.equal(h.failingCount, 1);
      assert.match(h.label, /1 source needs attention/);
      assert.deepEqual(h.connectedProviders.sort(), ["google_ads", "meta_ads"]);
    });

    it("returns healthy when all connections have synced without error", () => {
      const h = deriveClientHealth({
        connections: [
          { id: "c1", name: "Meta Ads", provider: "meta_ads", status: "connected", lastSyncAt: "2026-08-31T10:00:00.000Z" },
          { id: "c2", name: "Shopee", provider: "shopee", status: "connected", lastSyncAt: "2026-08-31T12:00:00.000Z" },
        ],
      });
      assert.equal(h.status, "healthy");
      assert.equal(h.failingCount, 0);
      assert.equal(h.label, "All sources healthy");
      assert.equal(h.latestSyncAt, "2026-08-31T12:00:00.000Z");
    });
  });

  describe("summarizeWorkspacesPortfolio", () => {
    it("aggregates healthy, attention, and totals across workspaces", () => {
      const workspaces: WorkspacePortfolioItem[] = [
        {
          id: "ws-1",
          name: "Acme Brand",
          slug: "acme-brand",
          role: "owner",
          plan: "growth",
          status: "active",
          createdAt: "2026-01-01",
          enabledProviders: ["meta_ads", "google_ads"],
          counts: { members: 2, clients: 1, connections: 2, sourceConnections: 2, pipelines: 2, apiKeys: 1 },
          health: { status: "healthy", latestSyncAt: "2026-08-31", latestJobStatus: "success", latestJobFinishedAt: null, failingConnections: 0 },
        },
        {
          id: "ws-2",
          name: "Beta Brand",
          slug: "beta-brand",
          role: "owner",
          plan: "starter",
          status: "active",
          createdAt: "2026-01-02",
          enabledProviders: ["google_ads"],
          counts: { members: 1, clients: 1, connections: 1, sourceConnections: 1, pipelines: 1, apiKeys: 0 },
          health: { status: "error", latestSyncAt: null, latestJobStatus: "failed", latestJobFinishedAt: null, failingConnections: 1 },
        },
      ];

      const summary = summarizeWorkspacesPortfolio(workspaces);
      assert.equal(summary.totalWorkspaces, 2);
      assert.equal(summary.totalClients, 2);
      assert.equal(summary.totalSources, 3);
      assert.equal(summary.healthyCount, 1);
      assert.equal(summary.attentionCount, 1);
      assert.equal(summary.pendingCount, 0);
    });
  });

  describe("summarizeClientsPortfolio", () => {
    it("counts healthy vs attention clients correctly", () => {
      const clients: ClientWithConnections[] = [
        {
          id: "cl-1",
          name: "Client 1",
          workspaceId: "ws-1",
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01",
          connections: [{ id: "c1", name: "Meta", provider: "meta_ads", status: "connected", lastSyncAt: "2026-08-31T00:00:00Z" }],
        },
        {
          id: "cl-2",
          name: "Client 2",
          workspaceId: "ws-1",
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01",
          connections: [{ id: "c2", name: "Google", provider: "google_ads", status: "error", lastError: "dead" }],
        },
      ];

      const summary = summarizeClientsPortfolio(clients);
      assert.equal(summary.totalClients, 2);
      assert.equal(summary.healthyCount, 1);
      assert.equal(summary.attentionCount, 1);
    });
  });
});
