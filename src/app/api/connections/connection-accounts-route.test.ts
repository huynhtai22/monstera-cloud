import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import prisma from "@/lib/prisma";
import { encrypt, safeDecrypt } from "@/lib/encryption";
import * as metaAdsModule from "@/lib/meta-ads";
import { setAuthSessionOverride } from "@/lib/auth-session";
import { GET } from "./[id]/accounts/route";

describe("GET /api/connections/[id]/accounts", () => {
  const originalEncryptionKey = process.env.ENCRYPTION_KEY;
  let originalFindUnique: any;
  let originalFindFirst: any;
  let originalUpdate: any;
  let originalWorkspaceMember: any;
  let originalWorkspace: any;
  let originalGetAdAccounts: any;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    setAuthSessionOverride(async () => ({
      user: { id: "user-1", email: "agency@example.com" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));
    originalFindUnique = prisma.connection.findUnique;
    originalFindFirst = prisma.connection.findFirst;
    originalUpdate = prisma.connection.update;
    originalWorkspaceMember = (prisma as any).workspaceMember;
    originalWorkspace = (prisma as any).workspace;
    originalGetAdAccounts = metaAdsModule.metaAdsClient.getAdAccounts;

    (prisma as any).workspace = {
      findUnique: async () => ({ id: "ws-1", name: "Test Workspace", plan: "agency_pro" }),
    };

    (prisma as any).workspaceMember = {
      findUnique: async () => ({
        userId: "user-1",
        workspaceId: "ws-1",
        role: "owner",
      }),
      findFirst: async () => ({
        userId: "user-1",
        workspaceId: "ws-1",
        role: "owner",
      }),
    };
  });

  afterEach(() => {
    process.env.ENCRYPTION_KEY = originalEncryptionKey;
    setAuthSessionOverride(null);
    prisma.connection.findUnique = originalFindUnique;
    prisma.connection.findFirst = originalFindFirst;
    prisma.connection.update = originalUpdate;
    (prisma as any).workspace = originalWorkspace;
    (prisma as any).workspaceMember = originalWorkspaceMember;
    (metaAdsModule.metaAdsClient as any).getAdAccounts = originalGetAdAccounts;
  });

  it("returns stored accounts on standard GET", async () => {
    const creds = {
      accessToken: "valid-meta-token",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      extraFields: {
        adAccounts: [
          { id: "act_111", name: "Client Alpha", currency: "VND" },
          { id: "act_222", name: "Client Beta", currency: "USD" },
        ],
        selectedAdAccountIds: ["act_111"],
      },
    };

    (prisma.connection.findFirst as any) = async () => ({
      id: "conn-meta-1",
      workspaceId: "ws-1",
      provider: "meta_ads",
      credentials: encrypt(JSON.stringify(creds)),
    });

    const req = new Request("http://localhost:3000/api/connections/conn-meta-1/accounts");
    const res = await GET(req, { params: Promise.resolve({ id: "conn-meta-1" }) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 2);
    assert.equal(body.selected, 1);
    assert.equal(body.accounts[0].id, "act_111");
    assert.equal(body.accounts[0].selected, true);
    assert.equal(body.accounts[1].id, "act_222");
    assert.equal(body.accounts[1].selected, false);
  });

  it("dynamically discovers and merges newly created accounts when ?refresh=true", async () => {
    let storedCreds = {
      accessToken: "valid-meta-token",
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      extraFields: {
        adAccounts: [{ id: "act_111", name: "Client Alpha", currency: "VND" }],
        selectedAdAccountIds: ["act_111"],
      },
    };

    (prisma.connection.findFirst as any) = async () => ({
      id: "conn-meta-1",
      workspaceId: "ws-1",
      provider: "meta_ads",
      credentials: encrypt(JSON.stringify(storedCreds)),
    });

    (prisma.connection.update as any) = async ({ data }: any) => {
      storedCreds = JSON.parse(safeDecrypt(data.credentials));
      return {};
    };

    (metaAdsModule.metaAdsClient as any).getAdAccounts = async () => [
      { id: "act_111", name: "Client Alpha", currency: "VND", account_status: 1 },
      { id: "act_333", name: "Newly Added Client Gamma", currency: "USD", account_status: 1 },
    ];

    const req = new Request("http://localhost:3000/api/connections/conn-meta-1/accounts?refresh=true");
    const res = await GET(req, { params: Promise.resolve({ id: "conn-meta-1" }) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 2);
    assert.ok(body.accounts.some((a: any) => a.id === "act_333"));
  });
});
