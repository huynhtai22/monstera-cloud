import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { expect, test } from "@playwright/test";
import { assertIsolatedE2eRuntimeEnvironment } from "../../src/lib/e2e-env-guard";

test.describe("persisted agent onboarding (M2)", () => {
  test.skip(process.env.ENABLE_AGENT_ONBOARDING !== "1", "Opt-in onboarding feature flag required");
  let db: PrismaClient;
  let userId: string;
  let workspaceId: string;
  let slug: string;

  test.beforeEach(async ({ context, baseURL }) => {
    assertIsolatedE2eRuntimeEnvironment(process.env);
    db = new PrismaClient();
    const suffix = randomUUID();
    userId = `agent-ui-${suffix}`; workspaceId = test.info().title.includes("outside the invited cohort") ? `agent-ui-outside-${suffix}` : `agent-ui-workspace-${test.info().project.name}-${test.info().parallelIndex}`; slug = `agent-ui-${suffix}`;
    await db.user.create({ data: { id: userId, email: `${userId}@example.test`, name: "Onboarding tester" } });
    await db.workspace.create({ data: { id: workspaceId, ownerId: userId, slug, name: "Creative studio", plan: "professional" } });
    await db.workspaceMember.create({ data: { workspaceId, userId, role: "owner" } });
    for (const provider of ["tiktok_business", "meta_ads", "google_ads", "shopee"]) await db.workspaceProviderAccess.create({ data: { workspaceId, provider, enabled: true } });
    // Exercise the app's real session decoding with a synthetic local-only JWT.
    const token = await encode({ secret: process.env.NEXTAUTH_SECRET!, token: { id: userId, sub: userId, email: `${userId}@example.test`, name: "Onboarding tester" } });
    await context.addCookies([{ name: "next-auth.session-token", value: token, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
  });
  test.afterEach(async () => {
    if (!db) return;
    if (workspaceId) await db.campaignMetric.deleteMany({ where: { workspaceId } });
    if (workspaceId) await db.workspace.deleteMany({ where: { id: workspaceId } });
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  test("dashboard delegation preserves intent and client scope through setup and reload", async ({ page }) => {
    await db.user.update({ where: { id: userId }, data: { workProfileAnsweredAt: new Date(), workCategory: "AGENCY_CONSULTANT" } });
    const client = await db.client.create({ data: { workspaceId, name: "North client" } });
    await page.goto("/console");
    const delegation = page.locator("[data-dashboard-delegation]");
    await expect(delegation.getByRole("heading", { name: "What would you like Monstera to do?" })).toBeVisible();
    await delegation.getByLabel("Task reporting client").selectOption(client.id);
    await delegation.getByLabel("Additional reporting context (optional)").fill("Prepare the weekly North report");
    await delegation.getByLabel("Additional reporting context (optional)").press("Enter");
    await expect(delegation.getByRole("link", { name: "Continue task" })).toBeVisible();
    await expect(delegation.getByRole("link", { name: "Continue task" })).toBeFocused();
    const run = await db.agentRun.findFirstOrThrow({ where: { workspaceId } });
    expect(run.clientId).toBe(client.id);
    expect(await db.agentTask.count({ where: { workspaceId } })).toBe(0);
    await delegation.getByRole("button", { name: /Confirm the reporting scope/ }).press("Enter");
    await expect(delegation.getByText("Prepare the weekly North report", { exact: true })).toBeVisible();
    await page.reload();
    await expect(delegation.getByText("Prepare client reporting · North client")).toBeVisible();
    expect(await db.agentRun.count({ where: { workspaceId } })).toBe(1);
    await delegation.getByRole("link", { name: "Continue task" }).click();
    await expect(page).toHaveURL(new RegExp(`/onboarding\\?workspaceId=${workspaceId}`));
    await expect(page.getByRole("heading", { name: "Let’s prepare client reporting." })).toBeVisible();
    await expect(page.getByLabel("Reporting client")).toHaveValue(client.id);
    await expect(page.getByLabel("Reporting client")).toBeDisabled();
    await page.getByRole("textbox", { name: "Tell Monstera which sources to connect" }).fill("Connect Meta Ads");
    await page.getByRole("button", { name: "Send message" }).click();
    await page.getByRole("button", { name: /Add Meta Ads agent/ }).click();
    await expect(page.getByText("Meta Ads agent", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Continue later" }).click();
    await expect(delegation.getByRole("link", { name: "Open paused task" })).toBeVisible();
    await expect(delegation.getByRole("button", { name: /Meta Ads · reporting data Task paused/ })).toBeVisible();
    expect((await db.agentRun.findFirstOrThrow({ where: { workspaceId } })).id).toBe(run.id);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("role, conversation, explicit agents, reload and recovery use durable records", async ({ page }) => {
    await page.goto("/console");
    await expect(page).toHaveURL(new RegExp(`/onboarding\\?workspaceId=${workspaceId}`));
    await expect(page.getByRole("heading", { name: "Your business. One clear view." })).toBeVisible();
    await page.getByRole("button", { name: "Make it yours" }).click();
    await expect(page.getByRole("heading", { name: "Which best describes your work?" })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("roles-desktop.png"), fullPage: true });
    await page.getByRole("button", { name: /Growth marketer/ }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: /Review spend See advertising/ }).click();
    await expect(page.getByRole("button", { name: /Review spend See advertising/ })).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page.getByRole("button", { name: /Review spend See advertising/ })).toHaveAttribute("aria-pressed", "true");
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).workContext).toBe("Review advertising spend");
    await page.getByRole("button", { name: "Start setup" }).click();
    await expect(page.getByRole("heading", { name: "Let’s review advertising spend." })).toBeVisible();
    await page.getByRole("textbox", { name: "Tell Monstera which sources to connect" }).fill("Connect TikTok Ads and Meta Ads");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("button", { name: /Add TikTok Ads \+ Meta Ads agents/ })).toBeVisible();
    expect(await db.agentTask.count({ where: { workspaceId } })).toBe(0);
    await page.getByRole("button", { name: /Add TikTok Ads \+ Meta Ads agents/ }).click();
    await expect(page.getByText("TikTok Ads agent", { exact: true })).toBeVisible();
    await expect(page.getByText("Meta Ads agent", { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("sources-desktop.png"), fullPage: true });
    const taskIds = (await db.agentTask.findMany({ where: { workspaceId }, orderBy: { id: "asc" } })).map(t => t.id);
    const tiktok = page.locator("[data-specialist-id]").filter({ hasText: "TikTok Ads agent" });
    if (await tiktok.locator("button[aria-expanded]").getAttribute("aria-expanded") !== "true") await tiktok.locator("button[aria-expanded]").click();
    await expect(tiktok.getByRole("button", { name: "Connect TikTok Ads", exact: true })).toBeDisabled();
    await page.getByRole("textbox").fill("How does Google Ads work?");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText(/Which advertising or shop source/)).toBeVisible();
    await expect(tiktok).toHaveAttribute("data-open", "true");
    await page.reload();
    await expect(page.getByText("TikTok Ads agent", { exact: true })).toBeVisible();
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).workCategory).toBe("GROWTH_MARKETER");
    expect((await db.agentTask.findMany({ where: { workspaceId }, orderBy: { id: "asc" } })).map(t => t.id)).toEqual(taskIds);
    await page.getByRole("button", { name: "Continue later" }).click();
    await expect(page).toHaveURL(/\/console/);
    expect((await db.agentRun.findFirstOrThrow({ where: { workspaceId } })).status).toBe("paused");
    await page.goto(`/onboarding?workspaceId=${workspaceId}`);
    await page.getByRole("button", { name: "Resume setup" }).click();
    await expect(page.getByText("Your setup is paused.", { exact: false })).not.toBeVisible();
    await page.locator("[data-specialist-id]").filter({ hasText: "TikTok Ads agent" }).locator("button[aria-expanded]").click();
    await page.locator("[data-specialist-id]").filter({ hasText: "TikTok Ads agent" }).getByRole("button", { name: "Save this source for later" }).click();
    await expect(page.locator("[data-specialist-id]").filter({ hasText: "TikTok Ads agent" }).getByText("Not connected · saved for later", { exact: true })).toBeVisible();
    expect((await db.agentTask.findFirstOrThrow({ where: { workspaceId, provider: "tiktok_business" } })).state).toBe("deferred");
    await page.getByRole("textbox", { name: "Tell Monstera which sources to connect" }).fill("TikTok Ads");
    await page.getByRole("button", { name: "Send message" }).click();
    const openAgent = page.getByRole("button", { name: /Open TikTok Ads agent/ }).last();
    await expect(openAgent).toBeEnabled();
    await openAgent.click();
    await expect(page.locator("[data-specialist-id]").filter({ hasText: "TikTok Ads agent" })).toHaveAttribute("data-open", "true");
    await expect(page.getByRole("button", { name: "TikTok Ads", exact: true })).toBeEnabled();
    expect(await db.agentTask.count({ where: { workspaceId } })).toBe(2);
    expect(await db.warehouseImportJob.count({ where: { workspaceId } })).toBe(0);
  });

  test("first overview requires explicit review and never blends source currencies", async ({ page }) => {
    await db.user.update({ where: { id: userId }, data: { workProfileAnsweredAt: new Date(), workContext: "Prepare client reporting" } });
    const connection = await db.connection.create({ data: { workspaceId, name: "Local Meta fixture", provider: "meta_ads", type: "source", credentials: "local-fixture-only", remoteAccountId: userId } });
    const run = await db.agentRun.create({ data: { workspaceId, initiatorUserId: userId, resumeKey: `onboarding:${userId}`, lastEventSequence: 1, version: 1, events: { create: { sequence: 1, type: "run_created", payload: { kind: "onboarding", goalId: "reporting" } } } } });
    const today = new Date(); today.setUTCDate(today.getUTCDate() - 1); const until = today.toISOString().slice(0, 10);
    for (const [accountId, currency, spend] of [["act_usd", "USD", 125], ["act_eur", "EUR", 80]] as const) await db.campaignMetric.create({ data: { workspaceId, connectionId: connection.id, platform: "meta_ads", accountId, currency, spend, date: new Date(`${until}T00:00:00Z`), level: "ad", entityId: accountId } });
    await db.agentTask.create({ data: { workspaceId, runId: run.id, provider: "meta_ads", taskKey: "connect:meta_ads", state: "ready", scopeRevision: 1, confirmedScope: { provider: "meta_ads", connectionId: connection.id, selectedAccountIds: ["act_empty_1", "act_empty_2", "act_empty_3", "act_usd", "act_eur"], since: until, until }, connections: { create: { connectionId: connection.id } } } });
    await page.goto(`/onboarding?workspaceId=${workspaceId}`);
    await expect(page.getByText(/USD 125 spend/)).toBeVisible();
    await expect(page.getByText(/EUR 80 spend/)).toBeVisible();
    const rows = page.getByRole("region", { name: "Imported rows" });
    await expect(rows.getByRole("cell", { name: "USD 125", exact: true })).toBeVisible();
    await expect(rows.getByRole("cell", { name: "EUR 80", exact: true })).toBeVisible();
    await expect(page.getByText(/Provider totals and destination delivery still need a separate check/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Check client report readiness" })).toHaveAttribute("href", `/reports?view=readiness&since=${until}&until=${until}`);
    await page.screenshot({ path: test.info().outputPath("imported-row-review.png"), fullPage: true });
    await expect(page.getByRole("button", { name: "Open my workspace" })).toBeDisabled();
    await page.getByRole("button", { name: "I’ve reviewed this overview" }).click();
    await expect(page.getByRole("button", { name: "Open my workspace" })).toBeEnabled();
    await page.reload();
    await expect(page.getByRole("button", { name: "Open my workspace" })).toBeDisabled();
  });

  test("members outside the invited cohort get sources guidance without agent access", async ({ page }) => {
    await page.goto(`/onboarding?workspaceId=${workspaceId}`);
    await expect(page.getByRole("heading", { name: "Connect your first source" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open sources" })).toHaveAttribute("href", "/sources");
    const response = await page.request.post("/api/agent/runs", { data: { workspaceId, kind: "onboarding" } });
    expect(response.status()).toBe(404);
    expect(await db.agentRun.count({ where: { workspaceId } })).toBe(0);
  });

  test("mixed-cohort membership preserves the explicitly requested workspace", async ({ page }) => {
    const otherId = `agent-ui-other-${randomUUID()}`;
    await db.workspace.create({ data: { id: otherId, slug: otherId, ownerId: userId, name: "Requested client workspace", members: { create: { userId, role: "owner" } } } });
    try {
      await page.goto(`/onboarding?workspaceId=${otherId}`);
      await expect(page.getByRole("heading", { name: "Connect your first source" })).toBeVisible();
      await expect(page.getByText(/manage sources in Requested client workspace/)).toBeVisible();
      await page.getByRole("link", { name: "Open sources" }).click();
      await expect(page).toHaveURL(/\/sources$/);
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("monstera-workspace-storage") ?? "{}").state?.activeWorkspaceId)).toBe(otherId);
      expect(await db.agentRun.count({ where: { workspaceId: { in: [workspaceId, otherId] } } })).toBe(0);
    } finally { await db.workspace.delete({ where: { id: otherId } }); }
  });

  test("320px layout and reduced motion preserve keyboard-accessible direct selection", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/onboarding?workspaceId=${workspaceId}`);
    await page.getByRole("button", { name: "Skip intro" }).click();
    await page.getByRole("button", { name: /Other Start with/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /Other Start with/ })).toHaveAttribute("aria-pressed", "true");
    expect(await page.getByRole("button", { name: /Other Start with/ }).evaluate(el => getComputedStyle(el).transitionDuration)).toBe("0s");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("roles-320.png"), fullPage: true });
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Start setup" }).click();
    await page.getByRole("button", { name: "Shopee", exact: true }).click();
    await expect(page.getByText("Shopee agent", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("sources-320.png"), fullPage: true });
  });

  test("agency onboarding validates slug, membership and scope outside the console shell", async ({ page }) => {
    const client = await db.client.create({ data: { workspaceId, name: "Juniper" } });
    await page.goto(`/agencies/${slug}/onboarding`);
    await page.getByRole("button", { name: "Skip intro" }).click();
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Workspace", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Start setup" })).toBeDisabled();
    await page.getByRole("combobox", { name: "Reporting client" }).selectOption(client.id);
    await page.getByRole("button", { name: "Start setup" }).click();
    await expect(page.getByRole("heading", { name: "Which tools do you work with?" })).toBeVisible();
    expect((await db.agentRun.findFirstOrThrow({ where: { workspaceId } })).clientId).toBe(client.id);
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Reporting client" })).toHaveValue(client.id);
    await expect(page.getByRole("combobox", { name: "Reporting client" })).toBeDisabled();
    await expect(page.locator("aside nav")).toHaveCount(0);
    const missing = await page.goto("/agencies/nonexistent-agent-workspace/onboarding");
    expect(missing?.status()).toBe(404);
  });
});
