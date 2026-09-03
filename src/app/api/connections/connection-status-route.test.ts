import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { GET } from "./[id]/status/route";
import prisma from "@/lib/prisma";
import { setAuthSessionOverride } from "@/lib/auth-session";

describe("GET /api/connections/[id]/status", () => {
  beforeEach(() => {
    setAuthSessionOverride(async () => ({
      user: { id: "user-123" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));

    (prisma as any).connection = {
      findFirst: async ({ where }: any) => {
        if (where.id === "conn-1") {
          return {
            id: "conn-1",
            status: "connected",
            lastError: null,
            updatedAt: new Date("2026-09-03T10:00:00Z"),
          };
        }
        return null;
      },
    };

    (prisma as any).providerAccountHealth = {
      findMany: async ({ where }: any) => {
        if (where.connectionId === "conn-1") {
          return [
            {
              accountId: "act-healthy",
              accountName: "Account 1",
              status: "healthy",
              errorCategory: null,
              consecutiveFailures: 0,
              lastError: null,
              lastErrorAt: null,
              lastSuccessAt: new Date("2026-09-03T09:00:00Z"),
            },
            {
              accountId: "act-poison",
              accountName: "Account 2",
              status: "quarantined",
              errorCategory: "PERMISSION_DENIED",
              consecutiveFailures: 3,
              lastError: "Permission denied",
              lastErrorAt: new Date("2026-09-03T09:30:00Z"),
              lastSuccessAt: null,
            },
          ];
        }
        return [];
      },
    };
  });

  it("returns 401 if unauthenticated", async () => {
    setAuthSessionOverride(async () => null);

    const res = await GET(new Request("http://localhost/api/connections/conn-1/status"), {
      params: Promise.resolve({ id: "conn-1" }),
    });

    assert.equal(res.status, 401);
  });

  it("returns 404 if connection not found", async () => {
    const res = await GET(new Request("http://localhost/api/connections/unknown/status"), {
      params: Promise.resolve({ id: "unknown" }),
    });

    assert.equal(res.status, 404);
  });

  it("returns connection status and account health array", async () => {
    const res = await GET(new Request("http://localhost/api/connections/conn-1/status"), {
      params: Promise.resolve({ id: "conn-1" }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, "conn-1");
    assert.equal(body.status, "connected");
    assert.equal(body.hasError, false);
    assert.equal(body.accounts.length, 2);
    assert.equal(body.accounts[0].accountId, "act-healthy");
    assert.equal(body.accounts[0].status, "healthy");
    assert.equal(body.accounts[1].accountId, "act-poison");
    assert.equal(body.accounts[1].status, "quarantined");
    assert.equal(body.accounts[1].errorCategory, "PERMISSION_DENIED");
  });
});
