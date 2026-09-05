import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { GET as config, PATCH } from "@/app/api/reports/readiness/configuration/route";
import { GET as looker } from "@/app/api/looker-studio/route";
import { POST as sheets } from "@/app/api/v1/sheets/query/route";
import { loadReportReadiness } from "./report-readiness-server";
import { recordProviderReportingContext } from "./reporting-context-server";
import { defaultReportingWindow, reportingDates } from "./report-readiness";
import { setAuthSessionOverride } from "./auth-session";
import { hashApiKey } from "./api-key-security";
import { assertCiDatabaseReachableWhenMissing } from "./pg-test-discipline";

assertCiDatabaseReachableWhenMissing();
describe("Report readiness persisted evidence and authenticated receipts", { skip: !process.env.DATABASE_URL }, () => {
  const db = new PrismaClient(); const uid = randomUUID();
  const wa = `evidence-a-${uid}`, wb = `evidence-b-${uid}`, ca = `client-a-${uid}`, cb = `client-b-${uid}`;
  const sa = `source-a-${uid}`, sb = `source-b-${uid}`, owner = `owner-${uid}`, admin = `admin-${uid}`, member = `member-${uid}`, viewer = `viewer-${uid}`;
  const key = `mc_test_${uid}`, window = defaultReportingWindow();
  const originalFetch = globalThis.fetch; let safe = false; let validGoogle = true;
  const originalAddon = process.env.GOOGLE_ADDON_CLIENT_ID; const originalLooker = process.env.LOOKER_OAUTH_CLIENT_ID;
  function asUser(id: string | null) { setAuthSessionOverride(async () => id ? { user: { id }, expires: new Date(Date.now()+86400000).toISOString() } : null); }
  const req = (body?: object, overrides: Record<string,string> = {}) => new Request(`http://localhost/api/reports/readiness/configuration?${new URLSearchParams({ workspaceId: wa, clientId: ca, ...overrides })}`, body ? { method:"PATCH", headers:{"content-type":"application/json"}, body:JSON.stringify({workspaceId:wa,clientId:ca,...body}) } : undefined);
  const requirements = { providers:["meta_ads"],destinations:["google_sheets","looker_studio"] };
  const override = { connectionId:sa,accountId:"a",timezone:"Asia/Ho_Chi_Minh",currency:"VND",reason:"Verified in the provider account settings" };
  const provider = () => recordProviderReportingContext({ workspaceId:wa,connectionId:sa,accountId:"a",provider:"meta_ads",timezone:"Asia/Ho_Chi_Minh",currency:"VND" });
  const evaluate = async () => (await loadReportReadiness(wa,window,{clientId:ca})).evaluations[0];
  const pullSheets = (extra: object = {}) => sheets(new Request("http://localhost/api/v1/sheets/query", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({googleToken:"synthetic-token",workspaceId:wa,clientId:ca,start_date:window.start,end_date:window.end,...extra})}));
  const pullLooker = (extra: Record<string,string> = {}, token = key) => looker(new NextRequest(`http://localhost/api/looker-studio?${new URLSearchParams({clientId:ca,workspaceId:wa,startDate:window.start,endDate:window.end,...extra})}`,{headers:{authorization:`Bearer ${token}`}}));
  async function ready() { await provider(); assert.equal((await PATCH(req({requirements}))).status,200); assert.equal((await pullSheets()).status,200); assert.equal((await pullLooker()).status,200); assert.equal((await evaluate()).status,"READY"); }
  before(async () => {
    const url = new URL(process.env.DATABASE_URL!); assert.ok(["localhost","127.0.0.1"].includes(url.hostname)); assert.ok(["/monstera_security_test","/monstera_ci"].includes(url.pathname)); safe=true;
    globalThis.fetch = async input => {
      assert.ok(String(input).startsWith("https://oauth2.googleapis.com/tokeninfo?"), "No live provider requests allowed");
      return Response.json(validGoogle ? {email:`${owner}@example.test`,email_verified:true,exp:Math.floor(Date.now()/1000)+3600,iss:"https://accounts.google.com",aud:"ci-google-client-id.apps.googleusercontent.com"} : {}, {status:validGoogle?200:401});
    };
    await db.user.createMany({data:[owner,admin,member,viewer].map(id=>({id,email:`${id}@example.test`}))});
    await db.workspace.createMany({data:[wa,wb].map(id=>({id,slug:id,name:id,ownerId:owner,plan:"professional"}))});
    await db.workspaceMember.createMany({data:[{userId:owner,role:"owner" as const},{userId:admin,role:"admin" as const},{userId:member,role:"member" as const},{userId:viewer,role:"viewer" as const}].map(m=>({...m,workspaceId:wa}))});
    await db.client.createMany({data:[{id:ca,workspaceId:wa,name:"A"},{id:cb,workspaceId:wb,name:"B"}]});
    await db.connection.createMany({data:[{id:sa,workspaceId:wa,clientId:ca},{id:sb,workspaceId:wb,clientId:cb}].map(s=>({...s,name:"Source",type:"source",provider:"meta_ads",credentials:"SECRET",status:"connected",lastSyncAt:new Date()}))});
    await db.campaignMetric.createMany({data:[{connectionId:sa,workspaceId:wa},{connectionId:sb,workspaceId:wb}].flatMap(s=>reportingDates(window).map(date=>({...s,accountId:"a",platform:"meta_ads",entityId:"campaign",currency:"VND",spend:10,date:new Date(date)})))});
    await db.apiKey.create({data:{workspaceId:wa,keyHash:hashApiKey(key),name:"test"}});
  });
  beforeEach(async () => {
    asUser(owner); validGoogle=true;
    process.env.GOOGLE_ADDON_CLIENT_ID="ci-google-client-id.apps.googleusercontent.com";
    process.env.LOOKER_OAUTH_CLIENT_ID="different-looker-client.apps.googleusercontent.com";
    await db.destinationDeliveryReceipt.deleteMany({where:{workspaceId:wa}});
    await db.accountReportingContext.deleteMany({where:{workspaceId:wa}});
    await db.auditEvent.deleteMany({where:{workspaceId:wa}});
    await db.client.updateMany({where:{workspaceId:wa},data:{requiredProviders:[],requiredDestinations:[],requirementsConfiguredAt:null}});
    await db.connection.updateMany({where:{workspaceId:wa},data:{status:"connected",lastSyncAt:new Date()}});
    await db.campaignMetric.updateMany({where:{workspaceId:wa},data:{spend:10,currency:"VND",pulledAt:new Date()}});
  });
  after(async () => {
    setAuthSessionOverride(null); globalThis.fetch=originalFetch;
    if(originalAddon===undefined) delete process.env.GOOGLE_ADDON_CLIENT_ID; else process.env.GOOGLE_ADDON_CLIENT_ID=originalAddon;
    if(originalLooker===undefined) delete process.env.LOOKER_OAUTH_CLIENT_ID; else process.env.LOOKER_OAUTH_CLIENT_ID=originalLooker;
    if(safe) { await db.campaignMetric.deleteMany({where:{workspaceId:{in:[wa,wb]}}}); await db.connection.deleteMany({where:{workspaceId:{in:[wa,wb]}}}); await db.workspace.deleteMany({where:{id:{in:[wa,wb]}}}); await db.user.deleteMany({where:{id:{in:[owner,admin,member,viewer]}}}); }
    await db.$disconnect();
  });
  it("configuration is membership scoped and owner/admin writable only",async()=>{
    asUser(null); assert.equal((await config(req())).status,401);
    for(const id of [member,viewer]) { asUser(id); const result=await config(req()); assert.equal(result.status,200); assert.equal((await result.json()).canEdit,false); assert.equal((await PATCH(req({requirements}))).status,403); assert.equal((await PATCH(req({override}))).status,403); }
    asUser(admin); assert.equal((await PATCH(req({requirements}))).status,200);
    assert.equal((await config(req(undefined,{workspaceId:wb,clientId:cb}))).status,403);
    assert.equal((await config(req(undefined,{clientId:cb}))).status,404);
    assert.equal((await PATCH(req({clientId:cb,requirements}))).status,404);
    assert.equal((await PATCH(req({override:{...override,connectionId:sb}}))).status,404);
    assert.equal((await PATCH(req({override:{...override,accountId:"foreign"}}))).status,404);
    assert.equal(await db.accountReportingContext.count({where:{workspaceId:wa}}),0);
  });
  it("rejects empty requirements, invented provider assertions and invalid context",async()=>{
    for(const body of [{requirements:{...requirements,providers:[]}},{requirements:{...requirements,destinations:[]}},{requirements:{...requirements,providers:["imaginary"]}},{override:{...override,timezone:"browser"}},{override:{...override,currency:"ZZZ"}},{override:{...override,reason:"short"}},{override:{...override,providerObservedAt:new Date().toISOString()}},{receipt:{destination:"looker_studio"}}]) assert.equal((await PATCH(req(body))).status,400);
  });
  it("provider facts are account scoped, audited, and never silently defaulted",async()=>{
    await assert.rejects(recordProviderReportingContext({workspaceId:wa,connectionId:sb,provider:"meta_ads",accountId:"a",timezone:"UTC",currency:"USD"}));
    await provider(); await provider();
    assert.equal(await db.auditEvent.count({where:{workspaceId:wa,action:"reporting_context.provider_observed"}}),1);
    await recordProviderReportingContext({workspaceId:wa,connectionId:sa,provider:"meta_ads",accountId:"a",timezone:undefined,currency:undefined});
    const value=await db.accountReportingContext.findFirst({where:{workspaceId:wa}}); assert.equal(value?.providerTimezone,null); assert.equal(value?.providerCurrency,null);
    assert.equal((await evaluate()).status,"UNKNOWN");
  });
  it("manual context remains separate and provider/override disagreement blocks deterministically",async()=>{
    assert.equal((await PATCH(req({override}))).status,200); await provider();
    let context=await db.accountReportingContext.findFirst({where:{workspaceId:wa}}); assert.ok(context?.overrideAt); assert.ok(context?.providerObservedAt);
    await PATCH(req({override:{...override,currency:"USD",timezone:"America/New_York"}}));
    const evaluation=await evaluate(); assert.ok(evaluation.blockers.some(i=>i.code==="CURRENCY_CONFLICT")); assert.ok(evaluation.blockers.some(i=>i.code==="TIMEZONE_CONFLICT"));
    await PATCH(req({override:{...override,currency:null,timezone:null}}));
    context=await db.accountReportingContext.findFirst({where:{workspaceId:wa}}); assert.equal(context?.overrideCurrency,null); assert.equal(context?.providerCurrency,"VND");
    assert.equal(await db.auditEvent.count({where:{workspaceId:wa,action:"reporting_context.overridden"}}),3);
  });
  it("real database reaches READY only after explicit requirements, context and BOTH authenticated destinations",async()=>{
    assert.equal((await evaluate()).status,"UNKNOWN"); await provider();
    assert.equal((await evaluate()).requiredProvidersBasis,"assigned_sources");
    await PATCH(req({requirements})); assert.notEqual((await evaluate()).status,"READY");
    const response=await pullSheets(); assert.equal(response.status,200); const body=await response.json(); assert.equal(body.rows.length,7); assert.ok(body.receiptId);
    assert.notEqual((await evaluate()).status,"READY"); await pullLooker();
    const evaluation=await evaluate(); assert.equal(evaluation.status,"READY"); assert.equal(evaluation.destination.receipts?.length,2);
    const receipt=await db.destinationDeliveryReceipt.findFirst({where:{workspaceId:wa,destination:"google_sheets"}});
    assert.equal(receipt?.clientId,ca); assert.equal(receipt?.windowStart,window.start); assert.equal(receipt?.windowEnd,window.end); assert.equal(receipt?.dataThroughDate,window.end); assert.ok(receipt?.retrievedAt); assert.equal(receipt?.rowCount,7);
  });
  it("late corrections invalidate receipts even when row count/date/pulledAt are unchanged",async()=>{
    await ready(); await db.campaignMetric.updateMany({where:{workspaceId:wa,date:new Date(window.start)},data:{spend:99}});
    assert.ok((await evaluate()).blockers.some(i=>i.code==="DESTINATION_STALE"));
    await pullSheets(); assert.notEqual((await evaluate()).status,"READY"); await pullLooker(); assert.equal((await evaluate()).status,"READY");
  });
  it("configuration edits invalidate delivery; unrelated tenant data does not",async()=>{
    await ready(); await db.campaignMetric.updateMany({where:{workspaceId:wb},data:{spend:123}}); assert.equal((await evaluate()).status,"READY");
    await PATCH(req({requirements})); assert.equal((await evaluate()).destination.state,"stale");
    await pullSheets(); await pullLooker(); await PATCH(req({override})); assert.equal((await evaluate()).destination.state,"stale");
  });
  it("auth failures and cross-tenant queries never mint receipts",async()=>{
    validGoogle=false; assert.equal((await pullSheets()).status,401); validGoogle=true;
    assert.equal((await pullSheets({clientId:cb})).status,404); assert.equal((await pullSheets({workspaceId:wb,clientId:cb})).status,404);
    assert.equal((await pullLooker({},"invalid")).status,401); assert.equal((await pullLooker({clientId:cb})).status,404);
    assert.equal(await db.destinationDeliveryReceipt.count({where:{workspaceId:wa}}),0);
  });
  it("filtered, paginated and invalid-window retrievals cannot verify full delivery",async()=>{
    for(const extra of [{source:"meta_ads"},{accountId:"a"},{connectionId:sa},{cursor:"invalid"}]) { assert.equal((await pullSheets(extra)).status,200); }
    assert.equal((await pullLooker({limit:"1"})).status,200);
    assert.equal((await pullSheets({start_date:"2026-02-31"})).status,400);
    assert.equal((await pullSheets({start_date:null})).status,400);
    assert.equal(await db.destinationDeliveryReceipt.count({where:{workspaceId:wa}}),0);
  });
  it("shared retrieval route binds Google receipts to verified audience, not caller destination",async()=>{
    const token="eyJfake.body.signature";
    const response=await pullLooker({destination:"looker_studio"},token); assert.equal(response.status,200);
    assert.equal((await db.destinationDeliveryReceipt.findFirst({where:{workspaceId:wa}}))?.destination,"google_sheets");
    await db.destinationDeliveryReceipt.deleteMany({where:{workspaceId:wa}});
    delete process.env.GOOGLE_ADDON_CLIENT_ID;
    assert.equal((await pullLooker({},token)).status,200); assert.equal(await db.destinationDeliveryReceipt.count({where:{workspaceId:wa}}),0);
  });
  it("disconnected source still blocks even with current successful delivery",async()=>{
    await ready(); await db.connection.update({where:{id:sa},data:{status:"disconnected"}});
    assert.equal((await evaluate()).status,"NOT_READY");
  });
  it("composite foreign keys reject cross-workspace evidence",async()=>{
    await assert.rejects(db.accountReportingContext.create({data:{workspaceId:wa,connectionId:sb,accountId:"bad"}}));
    await assert.rejects(db.destinationDeliveryReceipt.create({data:{workspaceId:wa,clientId:cb,destination:"google_sheets",windowStart:window.start,windowEnd:window.end,dataThroughDate:window.end,datasetFingerprint:"fake",rowCount:1,actorId:owner}}));
  });
  it("receipt timestamps must not predate dataset evidence",async()=>{
    await ready(); await db.destinationDeliveryReceipt.updateMany({where:{workspaceId:wa},data:{retrievedAt:new Date("2020-01-01")}});
    assert.equal((await evaluate()).destination.state,"stale");
  });
  it("empty retrieval and a different window do not verify this report",async()=>{
    await provider(); await PATCH(req({requirements}));
    const result=await pullSheets({start_date:"2020-01-01",end_date:"2020-01-01"}); assert.equal(result.status,200); assert.equal((await result.json()).receiptId,null);
    await pullSheets({start_date:window.end,end_date:window.end}); await pullLooker();
    assert.notEqual((await evaluate()).status,"READY");
  });
  it("a missing required provider remains missing after a source is removed",async()=>{
    await ready(); await PATCH(req({requirements:{...requirements,providers:["meta_ads","google_ads"]}}));
    assert.ok((await evaluate()).blockers.some(i=>i.code==="SOURCE_MISSING" && i.provider==="google_ads"));
  });
  it("receipt and audit failure rolls back together and returns no success",async()=>{
    const constraint=`receipt_audit_${uid.replaceAll("-","")}`;
    await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ADD CONSTRAINT "${constraint}" CHECK (NOT ("workspaceId" = '${wa}' AND "action" = 'reporting_delivery.retrieved'))`);
    try { assert.equal((await pullSheets()).status,500); assert.equal(await db.destinationDeliveryReceipt.count({where:{workspaceId:wa}}),0); }
    finally { await db.$executeRawUnsafe(`ALTER TABLE "AuditEvent" DROP CONSTRAINT "${constraint}"`); }
  });
});
