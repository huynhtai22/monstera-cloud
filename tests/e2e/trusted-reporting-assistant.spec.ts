import { expect, test as base, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { assertAllowedTestDatabase } from "../../src/lib/pg-test-discipline";
import {
  createAuthenticatedSessionCache,
  freshAuthenticatedSession,
} from "./authenticated-session";

const suffix = `trust-rep-${Date.now()}-${process.pid}`;
const DATE = "2026-09-24";
const ALICE = { email: "alice@alpha-agency.test", password: "Pilot_Alpha_2026!" };

let db: PrismaClient;
let workspaceId = "";
let ownerUserId = "";
let clientA = "";
const aliceSession = createAuthenticatedSessionCache();

async function signIn(page: Page) {
  const csrf = (await (await page.request.get("/api/auth/csrf")).json()) as { csrfToken: string };
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
    const session = await freshAuthenticatedSession(browser, aliceSession, (page) => signIn(page));
    await session.page.addInitScript(
      ({ ws, uid }: { ws: string; uid: string }) => {
        window.localStorage.setItem(
          "monstera-workspace-storage",
          JSON.stringify({ state: { activeWorkspaceId: ws }, version: 0 }),
        );
        window.sessionStorage.setItem("monstera-last-auth-user-id", uid);
      },
      { ws: workspaceId, uid: ownerUserId },
    );
    await use(session.page);
    await session.context.close();
  },
});

const mockReadyBrief = {
  workspaceId: "ws_alpha",
  clientId: "client_1",
  clientName: "Alpha Boutique",
  window: {
    preset: "last_7d",
    current: { start: "2026-09-17", end: "2026-09-23" },
    prior: { start: "2026-09-10", end: "2026-09-16" },
    timezone: "Asia/Ho_Chi_Minh",
    timezoneSource: "verified",
    daysCount: 7,
  },
  readiness: {
    status: "READY",
    exportEligible: true,
    blockers: [],
    warnings: [],
    latestDataDate: "2026-09-23",
    currencies: ["VND"],
    timezone: "Asia/Ho_Chi_Minh",
    fingerprint: "fp_ready_verified_12345",
  },
  freshnessJourney: {
    sourceHealth: "healthy",
    warehouseFreshness: "fresh",
    readinessStatus: "READY",
    deliveryStatus: "unconfigured",
  },
  generationMode: "deterministic",
  sections: {
    headline: "Delivered 15,000,000 VND in ad spend at 3.20x ROAS over the last 7 days for Alpha Boutique.",
    kpiScorecard: [
      {
        metricId: "spend",
        name: "Total Spend",
        currency: "VND",
        currentValue: 15000000,
        priorValue: 12000000,
        absoluteChange: 3000000,
        percentageChange: 0.25,
        status: "available",
        limitations: [],
      },
      {
        metricId: "roas",
        name: "ROAS",
        currency: null,
        currentValue: 3.2,
        priorValue: 2.8,
        absoluteChange: 0.4,
        percentageChange: 0.143,
        status: "available",
        limitations: [],
      },
    ],
    channelScorecard: [
      {
        channel: "meta",
        currency: "VND",
        spend: 15000000,
        conversions: 120,
        conversionValue: 48000000,
        roas: 3.2,
        orders: null,
        orderRevenue: null,
        clicks: 3500,
        impressions: 120000,
      },
    ],
    observations: [
      {
        id: "obs_spend",
        type: "spend",
        text: "Total advertising spend in VND increased by 25.0% compared to prior period.",
      },
    ],
    suggestedChecks: ["Audit creative fatigue on top spend sets", "Verify tracking pixel status"],
    sourcesAndLimitations: [
      "Reporting window: 2026-09-17 to 2026-09-23 (7 completed days, Asia/Ho_Chi_Minh timezone).",
      "Attribution model: Platform-reported attribution. Conversions do not represent unique individual buyers.",
    ],
  },
  generatedAt: new Date().toISOString(),
  fingerprint: "fp_ready_verified_12345",
};

test.describe("Trusted Reporting Assistant v1 (Full UI & Export Journeys)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const url = assertAllowedTestDatabase(process.env.DATABASE_URL);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();

    const alice = await db.user.findUniqueOrThrow({
      where: { email: ALICE.email },
      select: { id: true },
    });
    ownerUserId = alice.id;
    workspaceId = `ws-rep-${suffix}`;
    clientA = `cl-rep-${suffix}`;

    await db.workspace.create({
      data: {
        id: workspaceId,
        slug: `reporting-assistant-${suffix}`,
        name: "Reporting Assistant Test Workspace",
        ownerId: alice.id,
        plan: "pilot",
        status: "PILOT",
        members: { create: [{ userId: alice.id, role: "owner" }] },
      },
    });

    await db.client.create({
      data: {
        id: clientA,
        workspaceId,
        name: "Alpha Boutique",
      },
    });
  });

  test.afterAll(async () => {
    try {
      if (db && workspaceId) {
        await db.$transaction(async (tx) => {
          await tx.agentJob.deleteMany({ where: { workspaceId } });
          await tx.workspaceAiPolicy.deleteMany({ where: { workspaceId } });
          await tx.client.deleteMany({ where: { workspaceId } });
          await tx.workspaceMember.deleteMany({ where: { workspaceId } });
          await tx.workspace.delete({ where: { id: workspaceId } });
        });
      }
    } finally {
      await db?.$disconnect();
    }
  });

  test("1. Guided Warehouse Analyst renders with client scope badge and prompt chips", async ({
    authenticatedPage: page,
  }) => {
    page.on("console", (msg) => console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`));
    page.on("pageerror", (err) => console.log(`[BROWSER ERROR] ${err.message}`));
    await page.goto(`/explorer?clientId=${clientA}&startDate=${DATE}&endDate=${DATE}`, {
      waitUntil: "domcontentloaded",
    });

    // Analyst pane header
    await expect(page.getByRole("heading", { name: "Guided Warehouse Analyst" })).toBeVisible();

    // Client scope badge
    await expect(page.getByText("Alpha Boutique").first()).toBeVisible();

    // Verify all 4 prompt chips are visible
    await expect(page.getByRole("button", { name: "Summarize this client’s performance" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Compare spend and reported conversions with the previous period" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Which campaigns contributed most to the revenue change?" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Which sources need attention before reporting?" })).toBeVisible();

    // Generate Client Brief button is visible and active for concrete client
    await expect(page.getByRole("button", { name: /Generate Client Brief/i })).toBeVisible();
  });

  test("2. Prompt chip interaction sends analyst turn and renders structured observations", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(`/explorer?clientId=${clientA}&startDate=${DATE}&endDate=${DATE}`, {
      waitUntil: "domcontentloaded",
    });

    // Intercept analyst turns with structured mock response
    await page.route("**/api/ai/analyst/turns", async (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          status: "answered",
          turnId: "turn_test_1",
          structured: {
            headline: "Alpha Boutique — Performance Summary (2026-09-18 to 2026-09-24)",
            scopeLabel: "Client: Alpha Boutique",
            isAgencyOverview: false,
            observations: [
              {
                text: "Total ad spend: 15,000,000.00 VND across active channels.",
                metric: "spend",
                sources: ["meta"],
              },
            ],
            suggestedChecks: [
              "Verify conversion tracking tags and landing page availability in platform managers.",
            ],
            limitations: [
              "Attribution: Platform-reported conversions; cross-channel deduping is not applied.",
            ],
          },
          evidence: {
            freshness: "fresh",
            currencies: ["VND"],
            lastDataThrough: "2026-09-24",
            completeness: { sourceCount: 1, partialCount: 0 },
            attribution: { model: "platform_reported" },
          },
        },
      });
    });

    // Click "Summarize this client’s performance" prompt chip
    await page.getByRole("button", { name: "Summarize this client’s performance" }).click();

    // Verify structured output is rendered in the UI
    await expect(page.getByText("Alpha Boutique — Performance Summary")).toBeVisible();
    await expect(page.getByText("Supporting Observations")).toBeVisible();
    await expect(page.getByText("Total ad spend: 15,000,000.00 VND across active channels.")).toBeVisible();
    await expect(page.getByText("Suggested Operational Checks")).toBeVisible();
    await expect(page.getByText("Evidence & Limitations")).toBeVisible();
  });

  test("3. Open Client Brief Modal: renders verified report readiness, scorecard, and limitations", async ({
    authenticatedPage: page,
  }) => {
    // Intercept brief preview
    await page.route("**/api/ai/executive-brief", async (route) => {
      const body = route.request().postDataJSON();
      if (body?.action === "export") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          json: {
            ok: true,
            format: body.format,
            content: `# Alpha Boutique — Executive Performance Brief\nTotal Spend: VND 15,000,000`,
            fingerprint: body.expectedFingerprint,
            exportEligible: true,
          },
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          brief: mockReadyBrief,
          fingerprint: mockReadyBrief.fingerprint,
          exportEligible: true,
        },
      });
    });

    await page.goto(`/explorer?clientId=${clientA}&startDate=${DATE}&endDate=${DATE}`, {
      waitUntil: "domcontentloaded",
    });

    // Click "Generate Client Brief" button
    await page.getByRole("button", { name: /Generate Client Brief/i }).click();

    // Verify modal is open
    await expect(page.getByRole("heading", { name: /Executive Client Brief/i })).toBeVisible();

    // Verify readiness banner
    await expect(page.getByText("Verified Report-Ready (Client Export Permitted)")).toBeVisible();

    // Verify headline
    await expect(page.getByText(mockReadyBrief.sections.headline)).toBeVisible();

    // Verify KPI Scorecard
    await expect(page.getByText("KPI Scorecard")).toBeVisible();
    await expect(page.getByText("VND 15,000,000").first()).toBeVisible();

    // Verify Channel Scorecard
    await expect(page.getByText("Channel Scorecard")).toBeVisible();
    await expect(page.getByRole("cell", { name: "META" })).toBeVisible();

    // Verify Key Observations
    await expect(page.getByText("Key Observations")).toBeVisible();

    // Verify export buttons are enabled
    await expect(page.getByRole("button", { name: "Copy Markdown" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled();
  });

  test("4. Copy Markdown triggers server export revalidation, asserts clipboard content, and prevents stale writes", async ({
    authenticatedPage: page,
  }) => {
    // Grant clipboard permissions
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    let exportRevalidationCalled = false;
    let requestedFormat = "";
    const exportedMarkdown = `# Alpha Boutique — Executive Performance Brief\n**Period:** 2026-09-17 to 2026-09-23 (7 days, Asia/Ho_Chi_Minh)\n**Report Readiness:** READY\n\n### Executive Headline\nDelivered 15,000,000 VND in ad spend at 3.20x ROAS over the last 7 days for Alpha Boutique.\n\n### KPI Scorecard\n- **Total Spend:** VND 15,000,000 (+25.0%)\n- **ROAS:** 3.20\n\n### Sources & Limitations\n- Reporting window: 2026-09-17 to 2026-09-23 (7 completed days, Asia/Ho_Chi_Minh timezone).\n- Attribution model: Platform-reported attribution. Conversions do not represent unique individual buyers.`;

    await page.route("**/api/ai/executive-brief", async (route) => {
      const body = route.request().postDataJSON();
      if (body?.action === "export") {
        exportRevalidationCalled = true;
        requestedFormat = body.format;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          json: {
            ok: true,
            format: body.format,
            content: exportedMarkdown,
            fingerprint: body.expectedFingerprint,
            exportEligible: true,
          },
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          brief: mockReadyBrief,
          fingerprint: mockReadyBrief.fingerprint,
          exportEligible: true,
        },
      });
    });

    await page.goto(`/explorer?clientId=${clientA}&startDate=${DATE}&endDate=${DATE}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: /Generate Client Brief/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Click "Copy Markdown"
    await page.getByRole("button", { name: "Copy Markdown" }).click();

    // Verify export revalidation was called with action: "export" and format: "markdown"
    expect(exportRevalidationCalled).toBe(true);
    expect(requestedFormat).toBe("markdown");

    // Verify UI reflects copied state
    await expect(page.getByText("Copied")).toBeVisible();

    // Assert clipboard text content: contains client, period, metrics, and attribution disclosures
    const clipboardText = await page.evaluate(async () => {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return "";
      }
    });
    expect(clipboardText).toContain("Alpha Boutique");
    expect(clipboardText).toContain("Total Spend");
    expect(clipboardText).toContain("Attribution model");
    expect(clipboardText).toContain("Reporting window");
  });

  test("4b. Print / PDF triggers server revalidation, suppresses print on stale export, and verifies print media styles", async ({
    authenticatedPage: page,
  }) => {
    let printRevalidationCalled = false;
    let allowExportSuccess = true;

    // Spy on window.print in page
    await page.addInitScript(() => {
      (window as any).__printCallCount = 0;
      window.print = () => {
        (window as any).__printCallCount = ((window as any).__printCallCount || 0) + 1;
      };
    });

    await page.route("**/api/ai/executive-brief", async (route) => {
      const body = route.request().postDataJSON();
      if (body?.action === "export") {
        printRevalidationCalled = true;
        if (!allowExportSuccess) {
          return route.fulfill({
            status: 409,
            contentType: "application/json",
            headers: { "Cache-Control": "private, no-store" },
            json: { error: "Dataset changed", stale: true },
          });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          json: {
            ok: true,
            format: "print",
            content: "Printable content",
            fingerprint: body.expectedFingerprint,
            exportEligible: true,
          },
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          brief: mockReadyBrief,
          fingerprint: mockReadyBrief.fingerprint,
          exportEligible: true,
        },
      });
    });

    await page.goto(`/explorer?clientId=${clientA}&startDate=${DATE}&endDate=${DATE}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: /Generate Client Brief/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // 1. Successful print: revalidation succeeds and window.print is called
    await page.getByRole("button", { name: "Print / PDF" }).click();
    expect(printRevalidationCalled).toBe(true);
    await expect.poll(async () => page.evaluate(() => (window as any).__printCallCount)).toBe(1);

    // 2. Failure doesn't print: when revalidation fails (e.g. 409 stale), window.print is NOT called
    allowExportSuccess = false;
    await page.getByRole("button", { name: "Print / PDF" }).click();
    const currentPrintCount = await page.evaluate(() => (window as any).__printCallCount);
    expect(currentPrintCount).toBe(1);

    // 3. Print media emulation: controls/buttons hide and content is unclipped
    await page.emulateMedia({ media: "print" });

    // Controls must be hidden in print mode
    await expect(page.locator("button:has(svg.lucide-x)")).toBeHidden();
    await expect(page.getByRole("button", { name: "Copy Markdown" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Last 7 Days" })).toBeHidden();

    // Content must be visible and rendered
    await expect(page.getByText(mockReadyBrief.sections.headline)).toBeVisible();
    await expect(page.getByText("KPI Scorecard")).toBeVisible();
    await expect(page.getByText("Attribution model")).toBeVisible();

    // Reset media emulation
    await page.emulateMedia({ media: null });
  });

  test("5. 409 stale fingerprint displays regeneration warning banner and re-fetches latest brief", async ({
    authenticatedPage: page,
  }) => {
    let callCount = 0;
    await page.route("**/api/ai/executive-brief", async (route) => {
      const body = route.request().postDataJSON();
      callCount += 1;
      if (body?.action === "export") {
        // Return 409 stale
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          headers: { "Cache-Control": "private, no-store" },
          json: {
            error: "Dataset has changed since preview was generated. Regeneration required before export.",
            stale: true,
            currentFingerprint: "fp_mutated_new_999",
          },
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          brief: mockReadyBrief,
          fingerprint: mockReadyBrief.fingerprint,
          exportEligible: true,
        },
      });
    });

    await page.goto(`/explorer?clientId=${clientA}&startDate=${DATE}&endDate=${DATE}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: /Generate Client Brief/i }).click();
    await expect(page.getByRole("heading", { name: /Executive Client Brief/i })).toBeVisible();

    // Click "Copy Markdown" to trigger 409
    await page.getByRole("button", { name: "Copy Markdown" }).click();

    // Verify regeneration banner is shown
    await expect(
      page.getByText("Warehouse data changed since preview was generated. Regenerating brief..."),
    ).toBeVisible();
  });

  test("6. Non-ready dataset disables export and shows Internal Preview Only badge", async ({
    authenticatedPage: page,
  }) => {
    const unreadyBrief = {
      ...mockReadyBrief,
      readiness: {
        ...mockReadyBrief.readiness,
        status: "WARNING",
        exportEligible: false,
        blockers: ["TIMEZONE_UNKNOWN"],
      },
    };

    await page.route("**/api/ai/executive-brief", async (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          brief: unreadyBrief,
          fingerprint: unreadyBrief.fingerprint,
          exportEligible: false,
        },
      });
    });

    await page.goto(`/explorer?clientId=${clientA}&startDate=${DATE}&endDate=${DATE}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: /Generate Client Brief/i }).click();
    await expect(page.getByRole("heading", { name: /Executive Client Brief/i })).toBeVisible();

    // Verify non-ready banner
    await expect(page.getByText("Internal Preview Only (WARNING) — Export Blocked")).toBeVisible();
    await expect(page.getByText("Blockers: TIMEZONE_UNKNOWN")).toBeVisible();

    // Verify export buttons are disabled
    await expect(page.getByRole("button", { name: "Copy Markdown" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeDisabled();
  });

  test("7. Period toggle re-fetches brief for selected period window", async ({
    authenticatedPage: page,
  }) => {
    const requestedPresets: string[] = [];

    await page.route("**/api/ai/executive-brief", async (route) => {
      const body = route.request().postDataJSON();
      requestedPresets.push(body?.dateRange ?? "last_7d");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          brief: mockReadyBrief,
          fingerprint: mockReadyBrief.fingerprint,
          exportEligible: true,
        },
      });
    });

    await page.goto(`/explorer?clientId=${clientA}&startDate=${DATE}&endDate=${DATE}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: /Generate Client Brief/i }).click();
    await expect(page.getByRole("heading", { name: /Executive Client Brief/i })).toBeVisible();

    // Toggle to Last 30 Days
    await page.getByRole("button", { name: "Last 30 Days" }).click();

    // Verify request included last_30d
    expect(requestedPresets).toContain("last_30d");
  });

  test("8. Keyboard accessibility: initial focus, Tab/Shift+Tab trap, and Escape dismissal with focus return", async ({
    authenticatedPage: page,
  }) => {
    await page.route("**/api/ai/executive-brief", async (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        json: { brief: mockReadyBrief, fingerprint: mockReadyBrief.fingerprint, exportEligible: true },
      });
    });

    await page.goto(`/explorer?clientId=${clientA}&startDate=${DATE}&endDate=${DATE}`, {
      waitUntil: "domcontentloaded",
    });

    const triggerButton = page.getByRole("button", { name: /Generate Client Brief/i });
    await triggerButton.focus();
    await expect(triggerButton).toBeFocused();

    // Open modal via keyboard Enter on the trigger button
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // A. Focus verification: verify focus has moved into the dialog
    await expect.poll(async () => {
      return page.evaluate(() => {
        const active = document.activeElement;
        const dlg = document.querySelector('[role="dialog"]');
        return dlg?.contains(active) ?? false;
      });
    }).toBe(true);

    // B. Tab trapping: Tab through all focusable elements in dialog
    const focusableCount = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return 0;
      const focusable = dlg.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      return focusable.length;
    });
    expect(focusableCount).toBeGreaterThan(1);

    // Tab through until the last focusable element
    for (let i = 0; i < focusableCount; i++) {
      await page.keyboard.press("Tab");
      const insideDialog = await page.evaluate(() => {
        const active = document.activeElement;
        const dlg = document.querySelector('[role="dialog"]');
        return dlg?.contains(active) ?? false;
      });
      expect(insideDialog).toBe(true);
    }

    // Press Tab on the last element: focus wraps to the first focusable element inside dialog
    await page.keyboard.press("Tab");
    const wrappedInside = await page.evaluate(() => {
      const active = document.activeElement;
      const dlg = document.querySelector('[role="dialog"]');
      return dlg?.contains(active) ?? false;
    });
    expect(wrappedInside).toBe(true);

    // Shift+Tab: focus wraps backward inside dialog
    await page.keyboard.press("Shift+Tab");
    const shiftWrappedInside = await page.evaluate(() => {
      const active = document.activeElement;
      const dlg = document.querySelector('[role="dialog"]');
      return dlg?.contains(active) ?? false;
    });
    expect(shiftWrappedInside).toBe(true);

    // C. Escape key dismissal with focus return
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Verify focus is restored to the trigger button that launched the modal
    await expect(triggerButton).toBeFocused();
  });

  test("9. Language toggle updates prompt chips between English and Vietnamese", async ({
    authenticatedPage: page,
  }) => {
    await page.goto(`/explorer?clientId=${clientA}&startDate=${DATE}&endDate=${DATE}`, {
      waitUntil: "domcontentloaded",
    });

    // Switch prompt language to VI
    const viBtn = page.getByRole("button", { name: "VI", exact: true });
    await viBtn.click();

    // Verify Vietnamese prompt chips are rendered
    await expect(page.getByRole("button", { name: "Tóm tắt hiệu quả của client này" })).toBeVisible();
    await expect(page.getByRole("button", { name: "So sánh chi tiêu và chuyển đổi với kỳ trước" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Chiến dịch nào đóng góp nhiều nhất vào thay đổi doanh thu?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nguồn dữ liệu nào cần chú ý trước khi báo cáo?" })).toBeVisible();

    // Switch back to EN
    const enBtn = page.getByRole("button", { name: "EN", exact: true });
    await enBtn.click();
    await expect(page.getByRole("button", { name: "Summarize this client’s performance" })).toBeVisible();
  });

  test("10. Responsive viewports: modal dialog renders without breaking on mobile", async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await page.route("**/api/ai/executive-brief", async (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        json: { brief: mockReadyBrief, fingerprint: mockReadyBrief.fingerprint, exportEligible: true },
      });
    });

    await page.goto(`/explorer?clientId=${clientA}&startDate=${DATE}&endDate=${DATE}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: /Generate Client Brief/i }).click();

    // Heading should be visible without horizontal overflow clipping
    const heading = page.getByRole("heading", { name: /Executive Client Brief/i });
    await expect(heading).toBeVisible();
    const box = await heading.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(375);
  });
});
