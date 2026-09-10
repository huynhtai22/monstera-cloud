import { expect, test as base, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { assertAllowedTestDatabase } from "../../src/lib/pg-test-discipline";
import { FLAGSHIP_REFUSAL_QUESTION } from "../../src/lib/ai/classify";
import {
  createAuthenticatedSessionCache,
  freshAuthenticatedSession,
} from "./authenticated-session";

const suffix = `anly-e2e-${Date.now()}-${process.pid}`;
const DATE = "2026-09-04";
const ALICE = { email: "alice@alpha-agency.test", password: "Pilot_Alpha_2026!" };

let db: PrismaClient;
let workspaceId = "";
let ownerUserId = "";
let clientA = "";
const aliceSession = createAuthenticatedSessionCache();

async function signIn(page: Page) {
  const csrf = await (await page.request.get("/api/auth/csrf")).json() as { csrfToken: string };
  const response = await page.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email: ALICE.email,
      password: ALICE.password,
      redirect: "false",
      json: "true",
    },
  });
  expect(response.ok()).toBeTruthy();
}

const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ browser }, use) => {
    const session = await freshAuthenticatedSession(browser, aliceSession, (page) => signIn(page, ALICE));
    await session.page.addInitScript(({ ws, uid }: { ws: string; uid: string }) => {
      window.localStorage.setItem(
        "monstera-workspace-storage",
        JSON.stringify({ state: { activeWorkspaceId: ws }, version: 0 }),
      );
      window.sessionStorage.setItem("monstera-last-auth-user-id", uid);
    }, { ws: workspaceId, uid: ownerUserId });
    await use(session.page);
    await session.context.close();
  },
});

test.describe("analyst all-clients scope", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const url = assertAllowedTestDatabase(process.env.DATABASE_URL);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    const alice = await db.user.findUniqueOrThrow({ where: { email: ALICE.email }, select: { id: true } });
    ownerUserId = alice.id;
    workspaceId = `ws-anly-${suffix}`;
    clientA = `client-anly-${suffix}`;
    await db.workspace.create({
      data: {
        id: workspaceId,
        slug: `analyst-e2e-${suffix}`,
        name: "Analyst E2E Workspace",
        ownerId: alice.id,
        plan: "pilot",
        status: "PILOT",
        members: { create: [{ userId: alice.id, role: "owner" }] },
      },
    });
    await db.client.create({
      data: { id: clientA, workspaceId, name: "Analyst Client A" },
    });
  });

  test.afterAll(async () => {
    try {
      await db?.$transaction(async (tx) => {
        await tx.agentJob.deleteMany({ where: { workspaceId } });
        await tx.workspaceAiPolicy.deleteMany({ where: { workspaceId } });
        await tx.client.deleteMany({ where: { workspaceId } });
        await tx.workspaceMember.deleteMany({ where: { workspaceId } });
        await tx.workspace.delete({ where: { id: workspaceId } });
      });
    } finally {
      await db?.$disconnect();
    }
  });

  async function askAnalyst(page: Page) {
    // Passive listener: records the request without intercepting it, so the
    // real round-trip (and therefore the real response handling) is untouched.
    const seen: Array<Record<string, unknown>> = [];
    page.on("request", (request) => {
      if (request.method() !== "POST" || !request.url().includes("/api/ai/analyst/turns")) return;
      try {
        const body = request.postDataJSON() as unknown;
        if (body && typeof (body as Promise<unknown>).then === "function") {
          void (body as Promise<unknown>)
            .then((resolved) => { seen.push((resolved ?? {}) as Record<string, unknown>); })
            .catch(() => undefined);
        } else {
          seen.push(((body ?? {}) as Record<string, unknown>));
        }
      } catch {
        /* ignore unparsable bodies */
      }
    });
    await page.getByPlaceholder("Why did Meta ROAS drop last week?").fill(FLAGSHIP_REFUSAL_QUESTION);
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText("Blockers:")).toBeVisible();
    return seen.length > 0 ? seen[seen.length - 1]! : null;
  }

  test("All Clients analyst request omits clientId and is not reported disabled", async ({ authenticatedPage: page }) => {
    await page.goto(`/explorer?startDate=${DATE}&endDate=${DATE}`);
    await page.getByLabel("Switch client").selectOption({ label: "All clients" });
    await expect(page).toHaveURL(/clientId=all/);
    const sentBody = await askAnalyst(page);
    expect(sentBody, "analyst request body was captured").not.toBeNull();
    expect("clientId" in (sentBody ?? {}), "All Clients must omit clientId").toBe(false);
    await expect(page.getByText("Governed analyst is not enabled.")).toHaveCount(0);
  });

  test("concrete client analyst request stays scoped and unknown clients stay 404", async ({ authenticatedPage: page }) => {
    await page.goto(`/explorer?clientId=${clientA}&startDate=${DATE}&endDate=${DATE}`);
    const sentBody = await askAnalyst(page);
    expect(sentBody?.clientId, "concrete client id is sent").toBe(clientA);
    await expect(page.getByText("Governed analyst is not enabled.")).toHaveCount(0);

    const unknown = await page.request.post("/api/ai/analyst/turns", {
      data: { workspaceId, clientId: "client-does-not-exist", question: FLAGSHIP_REFUSAL_QUESTION },
    });
    expect(unknown.status()).toBe(404);
  });
});
