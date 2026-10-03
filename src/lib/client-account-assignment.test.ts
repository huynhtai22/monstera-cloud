import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignClientProviderAccount,
  bulkAssignClientProviderAccounts,
  unassignClientProviderAccount,
  switchAuthoritativeConnection,
  getWorkspaceDiscoveredAccounts,
} from "./client-account-assignment";
import { RbacError } from "./rbac";

describe("client-account-assignment unit tests", () => {
  describe("input validation", () => {
    it("rejects missing workspaceId, clientId, provider, accountId, or connectionId", async () => {
      const mockDb: any = {};

      await assert.rejects(
        () =>
          assignClientProviderAccount(
            {
              workspaceId: "",
              clientId: "cl-1",
              provider: "google_ads",
              accountId: "123",
              connectionId: "conn-1",
            },
            mockDb
          ),
        (err: any) => err instanceof RbacError && err.statusCode === 400
      );

      await assert.rejects(
        () =>
          assignClientProviderAccount(
            {
              workspaceId: "ws-1",
              clientId: "",
              provider: "google_ads",
              accountId: "123",
              connectionId: "conn-1",
            },
            mockDb
          ),
        (err: any) => err instanceof RbacError && err.statusCode === 400
      );

      await assert.rejects(
        () =>
          assignClientProviderAccount(
            {
              workspaceId: "ws-1",
              clientId: "cl-1",
              provider: "",
              accountId: "123",
              connectionId: "conn-1",
            },
            mockDb
          ),
        (err: any) => err instanceof RbacError && err.statusCode === 400
      );

      await assert.rejects(
        () =>
          assignClientProviderAccount(
            {
              workspaceId: "ws-1",
              clientId: "cl-1",
              provider: "google_ads",
              accountId: "   ",
              connectionId: "conn-1",
            },
            mockDb
          ),
        (err: any) => err instanceof RbacError && err.statusCode === 400
      );
    });

    it("rejects when client is not found in the workspace", async () => {
      const mockDb: any = {
        client: {
          findFirst: async () => null,
        },
      };

      await assert.rejects(
        () =>
          assignClientProviderAccount(
            {
              workspaceId: "ws-1",
              clientId: "cl-not-found",
              provider: "meta_ads",
              accountId: "act_123",
              connectionId: "conn-1",
            },
            mockDb
          ),
        (err: any) => err instanceof RbacError && err.statusCode === 404
      );
    });

    it("rejects when connection is not found in the workspace", async () => {
      const mockDb: any = {
        client: {
          findFirst: async () => ({ id: "cl-1", name: "Client 1" }),
        },
        connection: {
          findFirst: async () => null,
        },
      };

      await assert.rejects(
        () =>
          assignClientProviderAccount(
            {
              workspaceId: "ws-1",
              clientId: "cl-1",
              provider: "meta_ads",
              accountId: "act_123",
              connectionId: "conn-not-found",
            },
            mockDb
          ),
        (err: any) => err instanceof RbacError && err.statusCode === 404
      );
    });

    it("rejects when connection provider does not match assignment provider", async () => {
      const mockDb: any = {
        client: {
          findFirst: async () => ({ id: "cl-1", name: "Client 1" }),
        },
        connection: {
          findFirst: async () => ({ id: "conn-1", name: "Google Conn", provider: "google_ads" }),
        },
      };

      await assert.rejects(
        () =>
          assignClientProviderAccount(
            {
              workspaceId: "ws-1",
              clientId: "cl-1",
              provider: "meta_ads",
              accountId: "act_123",
              connectionId: "conn-1",
            },
            mockDb
          ),
        (err: any) => err instanceof RbacError && err.statusCode === 400 && err.message.includes("does not match")
      );
    });
  });

  describe("bulkAssignClientProviderAccounts", () => {
    it("returns empty array when items list is empty", async () => {
      const mockDb: any = {};
      const res = await bulkAssignClientProviderAccounts(
        {
          workspaceId: "ws-1",
          clientId: "cl-1",
          items: [],
        },
        mockDb
      );
      assert.deepEqual(res, []);
    });
  });

  describe("unassignClientProviderAccount", () => {
    it("returns unassigned: false if assignment did not exist", async () => {
      const mockDb: any = {
        clientProviderAccountAssignment: {
          findUnique: async () => null,
        },
      };

      const res = await unassignClientProviderAccount(
        {
          workspaceId: "ws-1",
          provider: "google_ads",
          accountId: "123",
        },
        mockDb
      );

      assert.equal(res.unassigned, false);
      assert.equal(res.previousAssignment, null);
    });
  });

  describe("switchAuthoritativeConnection", () => {
    it("rejects if assignment is not found", async () => {
      const mockDb: any = {
        clientProviderAccountAssignment: {
          findUnique: async () => null,
        },
      };

      await assert.rejects(
        () =>
          switchAuthoritativeConnection(
            {
              workspaceId: "ws-1",
              provider: "google_ads",
              accountId: "123",
              newConnectionId: "conn-2",
            },
            mockDb
          ),
        (err: any) => err instanceof RbacError && err.statusCode === 404
      );
    });

    it("rejects if target connection is not in workspace", async () => {
      const mockDb: any = {
        clientProviderAccountAssignment: {
          findUnique: async () => ({
            id: "a1",
            workspaceId: "ws-1",
            clientId: "cl-1",
            provider: "google_ads",
            accountId: "123",
            connectionId: "conn-1",
          }),
        },
        connection: {
          findFirst: async () => null,
        },
      };

      await assert.rejects(
        () =>
          switchAuthoritativeConnection(
            {
              workspaceId: "ws-1",
              provider: "google_ads",
              accountId: "123",
              newConnectionId: "conn-other",
            },
            mockDb
          ),
        (err: any) => err instanceof RbacError && err.statusCode === 404
      );
    });

    it("returns changed: false if target connection is already authoritative", async () => {
      const mockDb: any = {
        clientProviderAccountAssignment: {
          findUnique: async () => ({
            id: "a1",
            workspaceId: "ws-1",
            clientId: "cl-1",
            provider: "google_ads",
            accountId: "123",
            connectionId: "conn-1",
          }),
        },
        connection: {
          findFirst: async () => ({ id: "conn-1", provider: "google_ads" }),
        },
      };

      const res = await switchAuthoritativeConnection(
        {
          workspaceId: "ws-1",
          provider: "google_ads",
          accountId: "123",
          newConnectionId: "conn-1",
        },
        mockDb
      );

      assert.equal(res.changed, false);
      assert.equal(res.assignment.id, "a1");
    });
  });

  describe("getWorkspaceDiscoveredAccounts", () => {
    it("flags duplicate root connections when account is present across multiple roots", async () => {
      const mockDb: any = {
        connection: {
          findMany: async () => [
            {
              id: "conn-mcc-1",
              name: "MCC Agency A",
              provider: "google_ads",
              credentials: JSON.stringify({ customerIds: ["111-222-3333"] }),
              remoteAccountId: null,
              status: "connected",
            },
            {
              id: "conn-mcc-2",
              name: "MCC Agency B",
              provider: "google_ads",
              credentials: JSON.stringify({ customerIds: ["111-222-3333"] }),
              remoteAccountId: null,
              status: "connected",
            },
          ],
        },
        providerAccountHealth: {
          findMany: async () => [],
        },
        campaignMetric: {
          findMany: async () => [],
        },
        clientProviderAccountAssignment: {
          findMany: async () => [
            {
              id: "assign-1",
              workspaceId: "ws-1",
              clientId: "cl-1",
              provider: "google_ads",
              accountId: "111-222-3333",
              connectionId: "conn-mcc-1",
              status: "active",
              assignedAt: new Date(),
              assignedBy: null,
              client: {
                id: "cl-1",
                name: "Brand Alpha",
              },
            },
          ],
        },
      };

      const discovered = await getWorkspaceDiscoveredAccounts("ws-1", mockDb);

      assert.equal(discovered.length, 1);
      const acc = discovered[0];
      assert.equal(acc.accountId, "1112223333");
      assert.equal(acc.hasMultipleRootConnections, true);
      assert.equal(acc.availableConnections.length, 2);
      assert.equal(acc.isAssigned, true);
      assert.equal(acc.assignedClient?.name, "Brand Alpha");
      assert.equal(acc.authoritativeConnectionId, "conn-mcc-1");
      const auth = acc.availableConnections.find((c) => c.isAuthoritative);
      assert.equal(auth?.id, "conn-mcc-1");
    });
  });
});
