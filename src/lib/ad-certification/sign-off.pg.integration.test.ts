import assert from "node:assert/strict";
import { before, after, beforeEach, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { POST } from "@/app/api/ad-certification/sign-off/route";
import { setAuthSessionOverride } from "@/lib/auth-session";
import { assertCiDatabaseReachableWhenMissing } from "@/lib/pg-test-discipline";
import { CertificationHarness, CURRENT_SCHEMA_VERSION } from "./harness";
import { TestCertificationHarness } from "./test-simulation-adapter";
import type { CertificationEvidencePack } from "./types";

assertCiDatabaseReachableWhenMissing();
describe("Atomic certification approval — real PostgreSQL", { skip: !process.env.DATABASE_URL }, () => {
  const db = new PrismaClient(), id = randomUUID(), ws = `cert-${id}`, rival = `rival-${id}`, operator = `operator-${id}`, owner = `owner-${id}`;
  const sha = "a".repeat(40), previousSha = process.env.RUNTIME_COMMIT_SHA;
  const originalFetch = globalThis.fetch;
  let template: CertificationEvidencePack, pack: CertificationEvidencePack, recordId: string;
  const asUser = (userId: string | null) => setAuthSessionOverride(async () => userId ? { user: { id: userId }, expires: new Date(Date.now()+60000).toISOString() } : null);
  const request = (extra: Record<string,unknown> = {}) => new Request("http://localhost/api/ad-certification/sign-off", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ workspaceId:ws,evidencePackId:pack.runId,expectedEvidencePackHash:CertificationHarness.computeEvidencePackHash(pack),...extra }) });
  const save = () => db.evidencePackRecord.update({where:{id:recordId},data:{pack:JSON.parse(JSON.stringify(pack))}});
  before(async () => {
    const url=new URL(process.env.DATABASE_URL!); assert.ok(["localhost","127.0.0.1"].includes(url.hostname)); assert.ok(["/monstera_security_test","/monstera_ci"].includes(url.pathname));
    process.env.RUNTIME_COMMIT_SHA=sha;
    globalThis.fetch=async()=>{throw new Error("External APIs forbidden in certification tests")};
    await db.user.createMany({data:[{id:operator,email:`${operator}@example.test`,platformRole:"OPERATOR"},{id:owner,email:`${owner}@example.test`,platformRole:"USER"}]});
    await db.workspace.createMany({data:[ws,rival].map(id=>({id,slug:id,name:id,ownerId:owner}))});
    await db.workspaceMember.create({data:{workspaceId:ws,userId:owner,role:"owner"}});
    const generated=await new TestCertificationHarness().executeTestSimulation({workspaceId:ws,provider:"google_ads",accountId:"1234567890",startDate:"2026-08-01",endDate:"2026-08-07",buildId:"isolated-fixture",evidenceClass:"live_certification_evidence",trustedRuntimeMetadata:{commitSha:sha,schemaVersion:CURRENT_SCHEMA_VERSION,workingTreeDirty:false},nativeComparison:{spend:5,impressions:10,clicks:2,conversions:1,revenue:15},snapshotTiming:{accountTimezone:"Asia/Ho_Chi_Minh",currency:"VND",nativeRetrievalTime:"2026-08-08T01:00:00Z",monsteraDataThroughTime:"2026-08-08T01:00:00Z",warehouseQueryTime:"2026-08-08T01:01:00Z"},simulation:{simulatePersistedLiveState:true,simulatedConnection:true,simulatedWarehouseRows:7,simulatedWarehouseTotals:{spend:5,impressions:10,clicks:2,conversions:1,revenue:15},simulatedDestinationReceiptId:"fixture-receipt",simulatedRecoveryPassed:true,simulatedProviderAccessFacts:{observedApiVersion:"v23",appAccountMode:"live",grantedScopesOrPermissions:[],accessLevelStatus:"basic",authorizationModel:"oauth2_user_consent",tokenLifecycleModel:"refreshable_offline",verificationSource:"portal_owner_confirmed",verifiedAt:new Date().toISOString(),status:"VERIFIED"}}});
    template=generated.evidencePack;
  });
  beforeEach(async()=>{
    await db.evidencePackRecord.deleteMany({where:{workspaceId:ws}}); await db.auditEvent.deleteMany({where:{workspaceId:ws}});
    pack=structuredClone(template); pack.runId=`run-${randomUUID()}`;
    const record=await db.evidencePackRecord.create({data:{workspaceId:ws,jobId:pack.runId,pack:JSON.parse(JSON.stringify(pack))}});recordId=record.id;asUser(operator);
  });
  after(async()=>{
    setAuthSessionOverride(null);globalThis.fetch=originalFetch;
    if(previousSha===undefined)delete process.env.RUNTIME_COMMIT_SHA;else process.env.RUNTIME_COMMIT_SHA=previousSha;
    await db.workspace.deleteMany({where:{id:{in:[ws,rival]}}});await db.user.deleteMany({where:{id:{in:[operator,owner]}}});await db.$disconnect();
  });
  it("rejects signed-out, ordinary and owner final approvals",async()=>{
    asUser(null);assert.equal((await POST(request())).status,401);
    asUser(owner);assert.equal((await POST(request())).status,403);
  });
  it("rejects caller reviewer identity/role and rival-workspace evidence",async()=>{
    for(const field of ["reviewerUserId","reviewerRole","operatorSignOff","pilotEligible"])assert.equal((await POST(request({[field]:"OPERATOR"}))).status,400);
    assert.equal((await POST(request({workspaceId:rival}))).status,404);
  });
  for(const kind of ["synthetic_fixture","sandbox_evidence"] as const)it(`rejects ${kind}`,async()=>{pack.evidenceClass=kind;await save();assert.equal((await POST(request())).status,400)});
  it("rejects dirty or missing clean-build evidence",async()=>{pack.workingTreeDirty=true;await save();assert.equal((await POST(request())).status,400)});
  it("rejects nested hash tampering",async()=>{const req=request();pack.gateOutcomes[0].details="tampered nested content";await save();assert.equal((await POST(req)).status,400)});
  it("rejects commit and schema mismatch",async()=>{
    pack.metadata.commitSha="b".repeat(40);await save();assert.equal((await POST(request())).status,400);
    pack.metadata.commitSha=sha;pack.metadata.schemaVersion="wrong";await save();assert.equal((await POST(request())).status,400);
  });
  for(const gate of ["CODE_VERIFIED","SANDBOX_VERIFIED","LIVE_CONNECTED","LIVE_IMPORTED","LIVE_RECONCILED","DESTINATION_VERIFIED","RECOVERY_VERIFIED"] as const)it(`missing ${gate} blocks approval`,async()=>{pack.gateOutcomes=pack.gateOutcomes.filter(g=>g.gate!==gate);await save();assert.equal((await POST(request())).status,400)});
  it("rejects unjustified and wrong-provider sandbox exemptions",async()=>{
    const sandbox=pack.gateOutcomes.find(g=>g.gate==="SANDBOX_VERIFIED")!;sandbox.status="NOT_APPLICABLE";sandbox.notApplicableReason="";await save();assert.equal((await POST(request())).status,400);
    sandbox.notApplicableReason="Google non-serving test accounts";sandbox.alternativeVerificationPath="Controlled live reconciliation";pack.provider="meta_ads";await save();assert.equal((await POST(request())).status,400);
  });
  it("accepts the structural Google exemption and rejects sequential replay",async()=>{
    const sandbox=pack.gateOutcomes.find(g=>g.gate==="SANDBOX_VERIFIED")!;sandbox.status="NOT_APPLICABLE";sandbox.notApplicableReason="Google test accounts do not serve";sandbox.alternativeVerificationPath="Controlled live reconciliation";await save();
    const result=await POST(request());assert.equal(result.status,200,JSON.stringify(await result.clone().json()));assert.equal((await POST(request())).status,409);
  });
  it("eight independent concurrent requests commit exactly one approval and audit",async()=>{
    const results=await Promise.all(Array.from({length:8},()=>POST(request())));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409,409,409,409,409,409,409]);
    const records=await db.evidencePackRecord.findMany({where:{workspaceId:ws}});assert.equal(records.length,1);
    assert.equal((records[0].certifiedPack as unknown as CertificationEvidencePack).highestProvenLevel,"PILOT_CERTIFIED");
    assert.deepEqual(records[0].pack,JSON.parse(JSON.stringify(pack)),"base evidence remains immutable");
    assert.equal(await db.auditEvent.count({where:{workspaceId:ws,action:"ad_connector_certification.signed_off"}}),1);
  });
  it("audit failure rolls back approval; retry after rollback succeeds",async()=>{
    const fn=`cert_fail_${id.replaceAll("-","")}`;
    // Test-only trigger scoped to this fixture's workspace in this isolated database.
    await db.$executeRawUnsafe(`CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."workspaceId" = '${ws}' AND NEW.action = 'ad_connector_certification.signed_off' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "${fn}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`);
    try {assert.equal((await POST(request())).status,400);assert.equal((await db.evidencePackRecord.findUniqueOrThrow({where:{id:recordId}})).certifiedPack,null);assert.equal(await db.auditEvent.count({where:{workspaceId:ws}}),0)}
    finally {await db.$executeRawUnsafe(`DROP TRIGGER "${fn}" ON "AuditEvent"`);await db.$executeRawUnsafe(`DROP FUNCTION "${fn}"()`)}
    assert.equal((await POST(request())).status,200);
  });
  it("owner attestation preserves base hash and eligibility, then operator can approve",async()=>{
    asUser(owner);const response=await POST(request({action:"owner_attest"}));assert.equal(response.status,200);
    const record=await db.evidencePackRecord.findUniqueOrThrow({where:{id:recordId}});assert.deepEqual(record.pack,JSON.parse(JSON.stringify(pack)));assert.equal(record.certifiedPack,null);
    assert.equal((await POST(request({action:"owner_attest"}))).status,409);asUser(operator);assert.equal((await POST(request())).status,200);
  });
  it("rejects an in-memory-only pack and ambiguous persisted copies",async()=>{
    await db.evidencePackRecord.delete({where:{id:recordId}});CertificationHarness.registerActiveEvidencePack(pack);assert.equal((await POST(request())).status,404);
    await db.evidencePackRecord.createMany({data:[1,2].map(()=>({workspaceId:ws,jobId:pack.runId,pack:JSON.parse(JSON.stringify(pack))}))});assert.equal((await POST(request())).status,400);
  });
});
