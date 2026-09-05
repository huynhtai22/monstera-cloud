import { expect, test } from "@playwright/test";

test("browser sessions cannot forge certification operator approval", async ({ page }) => {
  await page.route("**/*", route => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const payload = { workspaceId:"unapproved-fixture",evidencePackId:"missing-fixture",expectedEvidencePackHash:"0".repeat(64) };
  expect((await page.request.post("/api/ad-certification/sign-off",{data:payload})).status()).toBe(401);
  await page.goto("/login");
  await expect(page.locator("body")).toContainText(/sign in|log in|welcome/i);
  const csrf=await (await page.request.get("/api/auth/csrf")).json();
  await page.request.post("/api/auth/callback/credentials",{form:{csrfToken:csrf.csrfToken,email:"alice@alpha-agency.test",password:"Pilot_Alpha_2026!",redirect:"false",json:"true"}});
  const session=await (await page.request.get("/api/auth/session")).json();expect(session.user.email).toBe("alice@alpha-agency.test");
  const status=await page.evaluate(async body=>(await fetch("/api/ad-certification/sign-off",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})).status,payload);
  expect(status).toBe(403);
  expect((await page.request.post("/api/ad-certification/sign-off",{data:{...payload,reviewerRole:"OPERATOR",reviewerUserId:session.user.id}})).status()).toBe(400);
});
