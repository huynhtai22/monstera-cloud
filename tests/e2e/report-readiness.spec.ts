import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { evaluateReportReadiness, defaultReportingWindow, reportingDates, type ReportReadinessEvaluation, type ReportReadinessStatus } from "../../src/lib/report-readiness";

// Reuse one authenticated identity per worker instead of exhausting the real login limiter.
let auth: { workspaceId: string; cookies: Awaited<ReturnType<BrowserContext["cookies"]>> } | undefined;
async function login(page: Page) {
  if (auth) {
    await page.context().addCookies(auth.cookies);
    return auth.workspaceId;
  }
  const csrf = await (await page.request.get("/api/auth/csrf")).json();
  const response = await page.request.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, email:"alice@alpha-agency.test", password:"Pilot_Alpha_2026!", redirect:"false", json:"true" } });
  expect(response.ok()).toBeTruthy();
  const workspaceResponse = await page.request.get("/api/workspaces");
  expect(workspaceResponse.ok()).toBeTruthy();
  const workspaces = await workspaceResponse.json() as Array<{id:string;slug:string}>;
  const workspaceId = workspaces.find(w=>w.slug==="alpha-agency")!.id;
  auth = {workspaceId,cookies:await page.context().cookies()};
  return workspaceId;
}
function fixture(workspaceId: string, status: ReportReadinessStatus): ReportReadinessEvaluation {
  const window = defaultReportingWindow();
  const now = new Date();
  return evaluateReportReadiness({ workspaceId, clientId:`fixture-${status}`, now, window,
    requiredProviders:["meta_ads"], requiredProvidersBasis:"explicit",
    destination:{ state: status === "WARNING" ? "unverified" : "verified", configuredCount:1, required:["google_sheets"] },
    sources:[{ connectionId:`fixture-source-${status}`, provider:"meta_ads", connectionStatus:status === "NOT_READY" ? "disconnected" : "connected",
      lastError:null, lastSyncAt:now.toISOString(), latestDataDate:window.end, timezone:status === "UNKNOWN" ? null : "Asia/Ho_Chi_Minh",
      accounts:[{accountId:"sample-account",status:"healthy",lastSuccessAt:now.toISOString()}],
      contexts: status === "UNKNOWN" ? [] : [{ accountId:"sample-account",providerTimezone:"Asia/Ho_Chi_Minh",providerCurrency:"VND",providerObservedAt:now.toISOString(),overrideTimezone:null,overrideCurrency:null,overrideAt:null }],
      days:reportingDates(window).map(date=>({accountId:"sample-account",date,currency:"VND",rows:1})),syncs:[] }],
  });
}
async function setupFixtures(page: Page) {
  const workspaceId = await login(page);
  // Block third-party browser requests; synthetic UI evidence must never call a provider.
  await page.route("**/*", route => {
    const host = new URL(route.request().url()).hostname;
    return ["localhost","127.0.0.1"].includes(host) ? route.fallback() : route.abort();
  });
  const evaluations = (["READY","NOT_READY","WARNING","UNKNOWN"] as const).map(s=>fixture(workspaceId,s));
  await page.route("**/api/clients?**", route=>route.fulfill({json:evaluations.map(e=>({id:e.clientId,name:`Demo ${e.status}`,workspaceId,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),connections:[]}))}));
  await page.route("**/api/report-schedules?**", route=>route.fulfill({json:[]}));
  await page.route("**/api/anomalies?**", route=>route.fulfill({json:{anomalies:[],byClient:{},summary:{total:0,critical:0,warning:0}}}));
  return { workspaceId, evaluations };
}

test("owner configures explicit sources, delivery and audited account context", async({page},testInfo)=>{
  const {workspaceId,evaluations}=await setupFixtures(page);
  await page.route("**/api/reports/readiness?**",route=>route.fulfill({json:{evaluations,nextCursor:null}}));
  const writes: Array<Record<string,unknown>>=[];
  await page.route("**/api/reports/readiness/configuration**",route=>{
    if(route.request().method()==="PATCH") { writes.push(route.request().postDataJSON()); return route.fulfill({json:{ok:true}}); }
    return route.fulfill({json:{canEdit:true,requiredProviders:[],requiredDestinations:[],requirementsConfiguredAt:null,accounts:[{connectionId:"fixture-source-READY",accountId:"sample-account",context:null}]}});
  });
  await page.goto("/clients");
  let panel=page.locator('[data-readiness="READY"]');
  await panel.getByRole("button",{name:"Configure reporting evidence"}).click();
  await expect(panel.getByText("Unconfigured — assigned-source inference is only a fallback.")).toBeVisible();
  await panel.getByRole("checkbox",{name:"meta ads",exact:true}).check();
  await panel.getByRole("checkbox",{name:"Google Sheets",exact:true}).check();
  await panel.getByRole("button",{name:"Save requirements"}).click();
  await expect.poll(()=>writes.length).toBe(1);
  expect(writes[0]).toEqual({workspaceId,clientId:"fixture-READY",requirements:{providers:["meta_ads"],destinations:["google_sheets"]}});
  panel=page.locator('[data-readiness="READY"]');
  await expect(panel).toBeVisible();
  const open=panel.getByRole("button",{name:"Configure reporting evidence",exact:true});
  if(await open.isVisible()) await open.click();
  await panel.getByLabel("Timezone override").fill("Asia/Ho_Chi_Minh");
  await panel.getByLabel("Currency override").fill("VND");
  await panel.getByLabel("Verification reason").fill("Checked provider account settings today");
  await panel.screenshot({path:testInfo.outputPath("reporting-configuration.png")});
  const otherCard=await page.locator('[data-readiness="NOT_READY"]').locator("..").boundingBox();
  expect(otherCard!.height).toBeLessThan(700);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  await panel.getByRole("button",{name:"Save account context"}).click();
  await expect.poll(()=>writes.length).toBe(2);
  expect(writes[1].override).toMatchObject({connectionId:"fixture-source-READY",accountId:"sample-account",timezone:"Asia/Ho_Chi_Minh",currency:"VND"});
});

test("read-only configuration and stale delivery explain why readiness is blocked",async({page},testInfo)=>{
  const {evaluations}=await setupFixtures(page);
  const stale={...evaluations[0],status:"NOT_READY",blockers:[{code:"DESTINATION_STALE"}],destination:{state:"stale",configuredCount:0,required:["google_sheets"],receipts:[{id:"receipt",destination:"google_sheets",retrievedAt:new Date().toISOString(),dataThroughDate:evaluations[0].window.end,current:false}]}};
  await page.route("**/api/reports/readiness?**",route=>route.fulfill({json:{evaluations:[stale],nextCursor:null}}));
  await page.route("**/api/reports/readiness/configuration**",route=>route.fulfill({json:{canEdit:false,requiredProviders:["meta_ads"],requiredDestinations:["google_sheets"],requirementsConfiguredAt:new Date().toISOString(),accounts:[]}}));
  await page.goto("/clients");
  const panel=page.locator('[data-readiness="NOT_READY"]');
  await panel.getByText("Inspect evidence",{exact:false}).click();
  await expect(panel.getByText("google_sheets: Stale retrieval",{exact:false})).toBeVisible();
  await panel.getByRole("button",{name:"Configure reporting evidence"}).click();
  await expect(panel.getByText("Read-only.",{exact:false})).toBeVisible();
  await expect(panel.getByRole("checkbox",{name:"Google Sheets",exact:true})).toBeDisabled();
  await expect(panel.getByRole("button",{name:"Save requirements"})).toHaveCount(0);
  await panel.screenshot({path:testInfo.outputPath("reporting-stale-readonly.png")});
});

test("client portfolio renders all four statuses and expandable evidence without overflow", async ({page},testInfo) => {
  const {evaluations} = await setupFixtures(page);
  const errors: string[] = []; page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/api/reports/readiness?**", route=>route.fulfill({json:{evaluations,nextCursor:null}}));
  await page.goto("/clients");
  for (const e of evaluations) {
    const panel = page.locator(`[data-readiness="${e.status}"]`);
    await expect(panel).toBeVisible();
    await panel.getByText("Inspect evidence",{exact:false}).click();
    await expect(panel.getByText("Required providers:",{exact:false})).toBeVisible();
  }
  const ready = page.locator('[data-readiness="READY"]');
  await ready.getByText("meta ads · Ready",{exact:true}).click();
  await expect(ready.getByText("Account sample-account:",{exact:false})).toBeVisible();
  await expect(ready.getByRole("link",{name:"Review source"})).toHaveAttribute("href","/sources/fixture-source-READY");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth+1)).toBeTruthy();
  expect(errors).toEqual([]);
  await page.screenshot({path:testInfo.outputPath("readiness-portfolio.png"),fullPage:true});
});

test("readiness loading and error replace prior badges; retry works", async ({page}) => {
  const {evaluations} = await setupFixtures(page);
  let fail = true;
  let release!: () => void;
  const wait = new Promise<void>(resolve=>{release=resolve;});
  await page.route("**/api/reports/readiness?**", async route=>{
    await wait;
    return fail ? route.fulfill({status:500,json:{error:"unavailable"}}) : route.fulfill({json:{evaluations,nextCursor:null}});
  });
  await page.goto("/clients");
  await expect(page.getByText("Checking report readiness…").first()).toBeVisible();
  release();
  await expect(page.getByText("Readiness unavailable. Do not rely on an earlier result.").first()).toBeVisible();
  await expect(page.locator('[data-readiness="READY"]')).toHaveCount(0);
  fail=false;
  await page.getByRole("button",{name:"Retry readiness"}).first().click();
  await expect(page.locator('[data-readiness="READY"]')).toBeVisible();
});

test("empty client portfolio has a useful empty state", async ({page}) => {
  await setupFixtures(page);
  await page.route("**/api/clients?**",route=>route.fulfill({json:[]}));
  await page.route("**/api/reports/readiness?**",route=>route.fulfill({json:{evaluations:[],nextCursor:null}}));
  await page.goto("/clients");
  await expect(page.getByText("No client brands yet")).toBeVisible();
});

test("selected client report uses its exact displayed window and real authorized API", async ({page},testInfo) => {
  const workspaceId = await login(page);
  const created = await page.request.post("/api/clients",{data:{workspaceId,name:`Readiness browser ${testInfo.project.name}`}});
  expect(created.status()).toBe(201);
  const client = await created.json() as {id:string};
  try {
    await page.goto(`/reports?clientId=${client.id}`);
    const panel = page.getByRole("region",{name:"Report readiness"});
    await expect(page.locator('[data-readiness="NOT_READY"]')).toBeVisible();
    await expect(panel).toContainText(new Date().toISOString().slice(0,10));
    const nextWindow = page.waitForResponse(response => response.url().includes("/api/reports/readiness?") && response.status() === 200);
    await page.getByRole("button",{name:"Last 14 Days",exact:true}).click();
    const refreshed = (await (await nextWindow).json()).evaluation as ReportReadinessEvaluation;
    expect(reportingDates(refreshed.window)).toHaveLength(14);
    expect(refreshed.clientId).toBe(client.id);
    await panel.getByText("Inspect evidence",{exact:false}).click();
    await expect(panel.getByText("SOURCE_MISSING",{exact:false})).toBeVisible();
    const evaluation = await (await page.request.get(`/api/reports/readiness?workspaceId=${workspaceId}&clientId=${client.id}`)).json();
    expect(evaluation.evaluation.status).toBe("NOT_READY");
    expect(evaluation.evaluation.clientId).toBe(client.id);
    await page.screenshot({path:testInfo.outputPath("readiness-client-report.png"),fullPage:true});
  } finally {
    await page.request.delete(`/api/clients?workspaceId=${workspaceId}&id=${client.id}`);
  }
});
