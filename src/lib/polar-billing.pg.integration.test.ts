import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import type { Checkout } from "@polar-sh/sdk/models/components/checkout";
import { preparePolarCheckout } from "./polar-checkout";
import type { Subscription } from "@polar-sh/sdk/models/components/subscription";
import { createGuardedPrisma } from "./prisma";
import { assertAllowedTestDatabase } from "./pg-test-discipline";
import { reconcilePolarSubscriptionEvent } from "./polar-billing";

const suffix = `${process.pid}-${Date.now()}`;
const a = `polar-a-${suffix}`, b = `polar-b-${suffix}`, user = `polar-user-${suffix}`;
let db: PrismaClient;
let client: ReturnType<typeof createGuardedPrisma>;
const savedProduct = process.env.POLAR_PRODUCT_ID_PRO_MONTHLY;
const now = new Date("2026-10-03T00:00:00Z");
function subscription(id: string, workspace = a, overrides: Partial<Subscription> = {}): Subscription {
  return { id, productId: "test-pro", currency: "usd", status: "active", metadata: { workspace_id: workspace },
    customer: { externalId: workspace }, currentPeriodEnd: new Date("2026-11-03T00:00:00Z"),
    endedAt: null, endsAt: null, cancelAtPeriodEnd: false, ...overrides } as Subscription;
}
async function apply(data: Subscription, current = data, type = "subscription.active") {
  await reconcilePolarSubscriptionEvent({ type, data }, { client, now, getSubscription: async () => current });
}
async function reset() {
  await db.auditEvent.deleteMany({ where: { workspaceId: { in: [a, b] } } });
  await db.workspace.updateMany({ where: { id: { in: [a,b] } }, data: { plan: "free", status: "ACTIVE", subscriptionId: null, subscriptionProvider: null, subscriptionEndsAt: null } });
}
before(async () => {
  assertAllowedTestDatabase(process.env.DATABASE_URL);
  db = new PrismaClient(); client = createGuardedPrisma(db);
  process.env.POLAR_PRODUCT_ID_PRO_MONTHLY = "test-pro";
  await db.user.create({ data: { id: user, email: `${user}@example.test` } });
  for (const id of [a,b]) await db.workspace.create({ data: { id, name: id, slug: id, ownerId: user } });
});
after(async () => {
  if (savedProduct === undefined) delete process.env.POLAR_PRODUCT_ID_PRO_MONTHLY;
  else process.env.POLAR_PRODUCT_ID_PRO_MONTHLY = savedProduct;
  if (db) { await db.workspace.deleteMany({ where: { id: { in: [a,b] } } }); await db.user.deleteMany({ where: { id: user } }); await db.$disconnect(); }
});
it("concurrent duplicate activation grants exactly one tenant and one lifecycle record", async () => {
  await reset(); const s=subscription(`sub-${suffix}`);
  await Promise.all([apply(s),apply(s),apply(s)]);
  const active=await db.workspace.findUniqueOrThrow({where:{id:a}});
  assert.equal(active.plan,"professional"); assert.equal(active.subscriptionId,s.id);
  assert.equal((await db.workspace.findUniqueOrThrow({where:{id:b}})).plan,"free");
  assert.equal(await db.auditEvent.count({where:{workspaceId:a}}),1);
});
it("revocation survives stale API state and old activation retries; a new subscription can start", async () => {
  await reset(); const s=subscription(`revoke-${suffix}`); await apply(s);
  await apply(s,s,"subscription.revoked"); await apply(s); await apply(s);
  assert.equal((await db.workspace.findUniqueOrThrow({where:{id:a}})).plan,"free");
  await apply(subscription(`replacement-${suffix}`));
  assert.equal((await db.workspace.findUniqueOrThrow({where:{id:a}})).plan,"professional");
  await apply(s,s,"subscription.revoked");
  assert.equal((await db.workspace.findUniqueOrThrow({where:{id:a}})).subscriptionId,`replacement-${suffix}`);
});
it("uses current provider state instead of the activation snapshot", async () => {
  await reset(); const s=subscription(`stale-${suffix}`);
  await apply(s,subscription(s.id,a,{status:"canceled",endedAt:now}));
  assert.equal((await db.workspace.findUniqueOrThrow({where:{id:a}})).plan,"free");
});
it("scheduled cancellation and recovery preserve only existing paid access", async () => {
  await reset(); const s=subscription(`cancel-${suffix}`); await apply(s);
  await apply(s,subscription(s.id,a,{status:"canceled",cancelAtPeriodEnd:true}),"subscription.canceled");
  assert.equal((await db.workspace.findUniqueOrThrow({where:{id:a}})).plan,"professional");
  await apply(s,subscription(s.id,a,{status:"past_due"}),"subscription.past_due");
  assert.equal((await db.workspace.findUniqueOrThrow({where:{id:a}})).plan,"professional");
  await reset(); await apply(s,subscription(s.id,a,{status:"past_due"}),"subscription.past_due");
  assert.equal((await db.workspace.findUniqueOrThrow({where:{id:a}})).plan,"free");
});
it("rejects unknown products and cross-workspace identity or subscription rebinding", async () => {
  await reset(); const s=subscription(`identity-${suffix}`);
  await assert.rejects(apply(s,subscription(s.id,a,{productId:"unknown"})),/Unrecognized/);
  await assert.rejects(apply(s,subscription(s.id,b)),/identity/);
  await apply(s);
  await assert.rejects(apply(subscription(s.id,b)));
  assert.equal((await db.workspace.findUniqueOrThrow({where:{id:b}})).plan,"free");
});
it("does not replace Paddle entitlement, provision from created, or resurrect suspended workspaces", async () => {
  await reset(); const s=subscription(`conflict-${suffix}`);
  await db.workspace.update({where:{id:a},data:{plan:"professional",subscriptionProvider:"paddle",subscriptionId:"existing-paddle"}});
  await assert.rejects(apply(s),/conflicts/);
  assert.equal((await db.workspace.findUniqueOrThrow({where:{id:a}})).subscriptionProvider,"paddle");
  await reset(); await apply(s,s,"subscription.created");
  assert.equal((await db.workspace.findUniqueOrThrow({where:{id:a}})).plan,"free");
  await db.workspace.update({where:{id:a},data:{status:"SUSPENDED"}});
  await assert.rejects(apply(s),/conflicts/);
});
it("provider lookup failure is retryable and rolls back all entitlement and audit writes", async () => {
  await reset(); const s=subscription(`failure-${suffix}`);
  await assert.rejects(reconcilePolarSubscriptionEvent({type:"subscription.active",data:s},{client,now,getSubscription:async()=>{throw new Error("provider unavailable");}}));
  assert.equal((await db.workspace.findUniqueOrThrow({where:{id:a}})).plan,"free");
  assert.equal(await db.auditEvent.count({where:{workspaceId:a}}),0);
});
it("expired current subscription never grants access and removes only its matching entitlement", async () => {
  await reset(); const s=subscription(`expiry-${suffix}`); await apply(s);
  await apply(s,subscription(s.id,a,{currentPeriodEnd:new Date("2026-10-01T00:00:00Z")}));
  assert.equal((await db.workspace.findUniqueOrThrow({where:{id:a}})).plan,"free");
});

function checkout(id: string, overrides: Partial<Checkout> = {}): Checkout {
  return { id, externalCustomerId: a, metadata: { workspace_id: a }, productId: "test-pro", status: "open", expiresAt: new Date("2026-11-03T00:00:00Z"), url: "https://checkout.example.test/synthetic", ...overrides } as Checkout;
}
const purchase={workspaceId:a,userId:user,email:"buyer@example.test",cycle:"monthly" as const};
it("concurrent checkout requests prepare one external checkout and retry reuses it",async()=>{
  await reset();let creates=0;const c=checkout(`checkout-${suffix}`);
  const provider={get:async()=>c,create:async()=>{creates++;await new Promise(resolve=>setTimeout(resolve,30));return c;}};
  const outcomes=await Promise.allSettled([preparePolarCheckout(purchase,{client,provider,now}),preparePolarCheckout(purchase,{client,provider,now})]);
  assert.ok(outcomes.some(result=>result.status==="fulfilled"));assert.equal(creates,1);
  assert.equal((await preparePolarCheckout(purchase,{client,provider,now})).id,c.id);assert.equal(creates,1);
});
it("ambiguous checkout failure keeps its intent and blocks a second external creation",async()=>{
  await reset();let creates=0;const provider={get:async()=>checkout("none"),create:async()=>{creates++;throw new Error("unknown network result");}};
  await assert.rejects(preparePolarCheckout(purchase,{client,provider,now}));
  await assert.rejects(preparePolarCheckout(purchase,{client,provider,now}),/needs review/);assert.equal(creates,1);
});
it("successful checkout awaiting its webhook cannot be purchased again",async()=>{
  await reset();let creates=0;const c=checkout(`settled-${suffix}`);
  const provider={get:async()=>checkout(c.id,{status:"succeeded"}),create:async()=>{creates++;return c;}};
  await preparePolarCheckout(purchase,{client,provider,now});
  await assert.rejects(preparePolarCheckout(purchase,{client,provider,now}),/Payment is processing/);assert.equal(creates,1);
});
it("only a provider-confirmed expired checkout can be replaced and foreign identity fails closed",async()=>{
  await reset();let creates=0;let remote=checkout(`expired-${suffix}`);
  const provider={get:async(id:string)=>({...remote,id}),create:async()=>{creates++;return checkout(`checkout-${creates}-${suffix}`);}};
  await preparePolarCheckout(purchase,{client,provider,now});
  remote=checkout(remote.id,{status:"expired"});await preparePolarCheckout(purchase,{client,provider,now});assert.equal(creates,2);
  remote=checkout(remote.id,{externalCustomerId:b,metadata:{workspace_id:b}});
  await assert.rejects(preparePolarCheckout(purchase,{client,provider,now}),/identity/);assert.equal(creates,2);
});
