import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { POST } from "./[id]/test-telegram/route";
import prisma from "@/lib/prisma";
import { setAuthSessionOverride } from "@/lib/auth-session";

describe("POST /api/workspaces/[id]/test-telegram", () => {
  const originalBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalChatId = process.env.TELEGRAM_CHAT_ID;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setAuthSessionOverride(async () => ({
      user: { id: "user-admin" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }));

    (prisma as any).workspaceMember = {
      findFirst: async ({ where }: any) => {
        if (where.userId === "user-admin" && where.workspaceId === "ws-1") {
          return { userId: "user-admin", workspaceId: "ws-1", role: "owner" };
        }
        return null;
      },
    };

    (prisma as any).workspace = {
      findUnique: async ({ where }: any) => {
        if (where.id === "ws-1") {
          return { name: "Pilot Agency", telegramChatId: "-100123456789" };
        }
        return null;
      },
    };
  });

  afterEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = originalBotToken;
    process.env.TELEGRAM_CHAT_ID = originalChatId;
    globalThis.fetch = originalFetch;
  });

  it("returns 401 if unauthenticated", async () => {
    setAuthSessionOverride(async () => null);
    const res = await POST(new Request("http://localhost/api/workspaces/ws-1/test-telegram", { method: "POST" }), {
      params: Promise.resolve({ id: "ws-1" }),
    });
    assert.equal(res.status, 401);
  });

  it("returns 400 if bot token or chat ID is missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    (prisma as any).workspace.findUnique = async () => ({ name: "No Chat", telegramChatId: null });

    const res = await POST(new Request("http://localhost/api/workspaces/ws-1/test-telegram", { method: "POST" }), {
      params: Promise.resolve({ id: "ws-1" }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /TELEGRAM_BOT_TOKEN/);
  });

  it("sends test alert and returns ok when Telegram API succeeds", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
    let sentBody: any = null;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("api.telegram.org")) {
        sentBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const res = await POST(new Request("http://localhost/api/workspaces/ws-1/test-telegram", { method: "POST" }), {
      params: Promise.resolve({ id: "ws-1" }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(sentBody.chat_id, "-100123456789");
    assert.match(sentBody.text, /Monstera test alert/);
  });
});
