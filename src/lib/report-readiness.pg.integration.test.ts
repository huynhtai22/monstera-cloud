import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { GET, POST } from "@/app/api/reports/readiness/route";
import { GET as legacy } from "@/app/api/workspaces/[id]/readiness/route";
import { setAuthSessionOverride } from "./auth-session";
import { assertCiDatabaseReachableWhenMissing } from "./pg-test-discipline";
import { defaultReportingWindow, reportingDates, type ReportReadinessEvaluation } from "./report-readiness";
import { loadReportReadiness } from "./report-readiness-server";

assertCiDatabaseReachableWhenMissing();
describe("Report readiness: real PostgreSQL and route boundaries", { skip: !process.env.DATABASE_URL }, () => {
  const db = new PrismaClient();
  const uid = randomUUID();
  const wa = `readiness-a-${uid}`, wb = `readiness-b-${uid}`, owner = `readiness-owner-${uid}`, viewer = `readiness-viewer-${uid}`;
  const ca = `readiness-client-a-${uid}`, empty = `readiness-empty-${uid}`, cb = `readiness-client-b-${uid}`;
  const sa = `readiness-source-a-${uid}`, sb = `readiness-source-b-${uid}`, corrupt = `readiness-corrupt-${uid}`;
  const destination = `readiness-destination-${uid}`;
  const window = defaultReportingWindow();
  const originalFetch = globalThis.fetch;
  let safeDatabase = false;
  const context = { params: Promise.resolve({ id: wa }) };
  function asUser(id: string | null) {
    setAuthSessionOverride(async () => id ? { user: { id, email: `${id}@example.test` }, expires: new Date(Date.now()+86400000).toISOString() } : null);
  }
  function request(params: Record<string,string> = {}, method = "GET", extra?: unknown) {
    const input = { workspaceId: wa, clientId: ca, start: window.start, end: window.end, ...params };
    return new Request(`http://localhost/api/reports/readiness?${new URLSearchParams(input)}`, { method,
      ...(method === "POST" ? { body: JSON.stringify(extra ?? input), headers: { "content-type": "application/json" } } : {}) });
  }
  async function evaluation() {
    const response = await GET(request()); assert.equal(response.status, 200);
    return (await response.json()).evaluation as ReportReadinessEvaluation;
  }
  before(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    assert.ok(["localhost","127.0.0.1"].includes(url.hostname));
    assert.ok(["/monstera_security_test","/monstera_ci"].includes(url.pathname));
    safeDatabase = true;
    await db.$connect();
    globalThis.fetch = async () => { throw new Error("External providers forbidden in readiness tests"); };
    await db.user.createMany({ data: [owner,viewer].map(id => ({ id, email: `${id}@example.test` })) });
    await db.workspace.createMany({ data: [wa,wb].map(id => ({ id, slug:id, name:id, ownerId:owner, plan:"professional" })) });
    await db.workspaceMember.createMany({ data: [{workspaceId:wa,userId:owner,role:"owner"},{workspaceId:wa,userId:viewer,role:"viewer"}] });
    await db.client.createMany({ data: [{id:ca,workspaceId:wa,name:"A"},{id:empty,workspaceId:wa,name:"Empty"},{id:cb,workspaceId:wb,name:"SECRET B"}] });
    await db.connection.createMany({ data: [
      { id:sa, workspaceId:wa, clientId:ca }, { id:sb, workspaceId:wb, clientId:cb },
      // DB permits an inconsistent FK; the evidence loader must not.
      { id:corrupt, workspaceId:wb, clientId:ca },
    ].map(c => ({ ...c, name:c.id, provider:"meta_ads", type:"source", remoteAccountId:c.id, credentials:"SECRET_OAUTH", lastSyncAt:new Date() })) });
    await db.connection.create({ data: { id:destination, workspaceId:wa, clientId:ca, name:"Sheets", provider:"google_sheets", type:"destination", credentials:"SECRET_DESTINATION", remoteAccountId:destination } });
    await db.campaignMetric.createMany({ data: [sa,sb,corrupt].flatMap(connectionId => reportingDates(window).map(date => ({
      workspaceId:connectionId === sa ? wa : wb, connectionId, platform:"meta_ads", accountId:"a", date:new Date(`${date}T00:00:00Z`), currency:"VND", rawData:"SECRET_RAW", entityId:"campaign",
    }))) });
    await db.providerAccountHealth.create({ data: { workspaceId:wa, connectionId:sa, provider:"meta_ads", accountId:"a", status:"healthy", lastSuccessAt:new Date() } });
    asUser(owner);
  });
  afterEach(async () => {
    if (!safeDatabase) return;
    await db.warehouseImportJob.deleteMany({ where:{workspaceId:wa} });
    await db.providerSyncRun.deleteMany({ where:{workspaceId:wa} });
    await db.providerAccountHealth.updateMany({ where:{workspaceId:wa}, data:{status:"healthy",lastError:null} });
    await db.connection.updateMany({ where:{id:{in:[sa,destination]}, workspaceId:wa}, data:{status:"connected",lastError:null,lastSyncAt:new Date()} });
    asUser(owner);
  });
  after(async () => {
    setAuthSessionOverride(null); globalThis.fetch = originalFetch;
    if (safeDatabase) {
      await db.campaignMetric.deleteMany({ where:{workspaceId:{in:[wa,wb]}} });
      await db.connection.deleteMany({ where:{workspaceId:{in:[wa,wb]}} });
      await db.workspace.deleteMany({ where:{id:{in:[wa,wb]}} });
      await db.user.deleteMany({ where:{id:{in:[owner,viewer]}} });
    }
    await db.$disconnect();
  });
  it("401 signed out; 403 outside workspace; 404 for a rival client including legacy API", async () => {
    asUser(null); assert.equal((await GET(request())).status,401); assert.equal((await POST(request({},"POST"))).status,401);
    asUser(owner); assert.equal((await GET(request({workspaceId:wb,clientId:cb}))).status,403);
    assert.equal((await GET(request({clientId:cb}))).status,404);
    assert.equal((await POST(request({clientId:cb},"POST"))).status,404);
    assert.equal((await legacy(new Request(`http://localhost/readiness?clientId=${cb}`),context)).status,404);
  });
  it("viewers read but cannot POST evaluation; members can evaluate with no writes", async () => {
    asUser(viewer); assert.equal((await GET(request())).status,200);
    assert.equal((await POST(request({},"POST"))).status,403);
    asUser(owner);
    const before = await db.auditEvent.count({where:{workspaceId:wa}});
    assert.equal((await POST(request({},"POST"))).status,200);
    assert.equal(await db.auditEvent.count({where:{workspaceId:wa}}),before);
  });
  it("uses actual grouped dates, no raw data/credentials, and truthful missing context", async () => {
    const result = await evaluation();
    assert.equal(result.status,"UNKNOWN");
    assert.equal(result.providers.length,1); assert.equal(result.providers[0].connectionId,sa);
    assert.equal(result.providers[0].evidence.rowCount,7);
    assert.equal(result.providers[0].evidence.accounts[0].presentDays,7);
    assert.equal(result.destination.state,"unverified");
    assert.equal(result.destination.configuredCount,1);
    assert.ok(result.warnings.some(i=>i.code==="TIMEZONE_UNKNOWN"));
    assert.ok(!JSON.stringify(result).includes("SECRET"));
    assert.ok(!JSON.stringify(result).includes(corrupt));
  });
  it("lists only authorized clients and supports stable pagination", async () => {
    const url = `http://localhost/api/reports/readiness?workspaceId=${wa}&limit=1`;
    const first = await (await GET(new Request(url))).json();
    assert.equal(first.evaluations.length,1); assert.ok(first.nextCursor);
    const second = await (await GET(new Request(`${url}&after=${first.nextCursor}`))).json();
    assert.equal(second.evaluations.length,1); assert.equal(second.nextCursor,null);
    const ids = [...first.evaluations,...second.evaluations].map((r:ReportReadinessEvaluation)=>r.clientId).sort();
    assert.deepEqual(ids,[ca,empty].sort());
  });
  it("single and portfolio use identical rules and empty assignments block", async () => {
    const single = await evaluation();
    const { evaluations } = await loadReportReadiness(wa,window);
    const list = evaluations.find(r=>r.clientId===ca)!;
    assert.deepEqual({...single,evaluatedAt:""},{...list,evaluatedAt:""});
    assert.ok(evaluations.find(r=>r.clientId===empty)!.blockers.some(i=>i.code==="SOURCE_MISSING"));
  });
  it("successful parent never hides a failed child, nor a narrower retry", async () => {
    await db.warehouseImportJob.create({ data:{workspaceId:wa,userId:owner,since:window.start,until:window.end,status:"completed",finishedAt:new Date(Date.now()-1000),
      items:[{connectionId:sa,accountId:"a"}],results:[{connectionId:sa,accountId:"a",ok:false,outcome:"partial",error:"SECRET_ERROR"}] } });
    assert.ok((await evaluation()).blockers.some(i=>i.code==="SYNC_PARTIAL"));
    await db.warehouseImportJob.create({ data:{workspaceId:wa,userId:owner,since:window.end,until:window.end,status:"completed",finishedAt:new Date(),
      items:[{connectionId:sa,accountId:"a"}],results:[{connectionId:sa,accountId:"a",ok:true,outcome:"success"}] } });
    assert.ok((await evaluation()).blockers.some(i=>i.code==="SYNC_PARTIAL"));
  });
  it("account quarantine and endpoint errors override connection-level success", async () => {
    await db.providerAccountHealth.updateMany({where:{workspaceId:wa},data:{status:"quarantined",lastError:"SECRET_ERROR"}});
    await db.providerSyncRun.create({data:{workspaceId:wa,connectionId:sa,provider:"meta_ads",environment:"test",endpoint:"/ads",status:"failed",errorMessage:"SECRET_ERROR",completedAt:new Date()}});
    const result = await evaluation();
    assert.equal(result.status,"NOT_READY");
    assert.ok(result.blockers.some(i=>i.code==="SOURCE_QUARANTINED"));
    assert.ok(result.blockers.some(i=>i.code==="SYNC_FAILED"));
    assert.ok(!JSON.stringify(result).includes("SECRET"));
  });
  it("disconnected destination is unavailable, not verified by existence", async () => {
    await db.connection.update({where:{id:destination},data:{status:"disconnected"}});
    assert.ok((await evaluation()).blockers.some(i=>i.code==="DESTINATION_UNAVAILABLE"));
  });
  it("rejects malformed, overlong, future and browser-injected evidence", async () => {
    const invalid: Record<string,string>[] = [{start:"2026-02-30"},{limit:"999"},{start:"2999-01-01",end:"2999-01-02"}];
    for (const input of invalid) assert.equal((await GET(request(input))).status,400);
    assert.equal((await POST(request({},"POST",{workspaceId:wa,clientId:ca,timezone:"UTC",status:"READY"}))).status,400);
    assert.equal((await POST(new Request("http://localhost/readiness",{method:"POST",body:"{"}))).status,400);
  });
});
