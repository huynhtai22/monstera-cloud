import assert from "node:assert/strict";
import { after, it } from "node:test";
import { NextRequest } from "next/server";
import { isPolarCheckoutConfigured } from "./polar-billing";

const keys=["NODE_ENV","ENABLE_POLAR_BILLING","POLAR_SERVER","POLAR_ACCESS_TOKEN","POLAR_WEBHOOK_SECRET","POLAR_PRODUCT_ID_PRO_MONTHLY","POLAR_PRODUCT_ID_PRO_ANNUAL"] as const;
const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
after(()=>{for(const key of keys){if(saved[key]===undefined)delete process.env[key];else Object.assign(process.env,{[key]:saved[key]});}});
process.env.POLAR_WEBHOOK_SECRET="whsec_"+Buffer.from("synthetic-verification-secret-32bytes").toString("base64");
const route=import("@/app/api/webhooks/polar/route");
function request(headers: Record<string,string>={}) {return new NextRequest("http://localhost/api/webhooks/polar",{method:"POST",body:'{"type":"subscription.active"}',headers});}
it("checkout requires a signing secret and distinct configured products",()=>{
  process.env.POLAR_ACCESS_TOKEN="synthetic";process.env.POLAR_PRODUCT_ID_PRO_MONTHLY="monthly";process.env.POLAR_PRODUCT_ID_PRO_ANNUAL="annual";
  assert.equal(isPolarCheckoutConfigured(),true);
  delete process.env.POLAR_WEBHOOK_SECRET;assert.equal(isPolarCheckoutConfigured(),false);
  process.env.POLAR_WEBHOOK_SECRET=saved.POLAR_WEBHOOK_SECRET??"synthetic";
  process.env.POLAR_PRODUCT_ID_PRO_ANNUAL="monthly";assert.equal(isPolarCheckoutConfigured(),false);
});
it("production remains disabled without explicit enablement",async()=>{
  Object.assign(process.env,{NODE_ENV:"production",ENABLE_POLAR_BILLING:"0",POLAR_SERVER:"production"});
  assert.equal((await (await route).POST(request())).status,404);
});
it("production refuses sandbox webhook processing",async()=>{
  Object.assign(process.env,{NODE_ENV:"production",ENABLE_POLAR_BILLING:"1",POLAR_SERVER:"sandbox"});
  assert.equal((await (await route).POST(request())).status,503);
});
it("unsigned and forged signed deliveries are denied before reconciliation",async()=>{
  Object.assign(process.env,{NODE_ENV:"production",ENABLE_POLAR_BILLING:"1",POLAR_SERVER:"production"});
  assert.equal((await (await route).POST(request())).status,403);
  const res=await (await route).POST(request({"webhook-id":"synthetic-event","webhook-timestamp":String(Math.floor(Date.now()/1000)),"webhook-signature":"v1,Zm9yZ2Vk"}));
  assert.equal(res.status,403);
});
