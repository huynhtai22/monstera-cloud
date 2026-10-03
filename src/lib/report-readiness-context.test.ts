import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { currencySchema, timezoneSchema, effectiveReportingContext } from "./reporting-context";
import { metaAdsClient } from "./meta-ads";
import { tiktokReportClient } from "./tiktok-business";
import { googleAdsReportClient, normalizeGoogleAdsRow } from "./google-ads";

describe("reporting context validation and provider response contracts",()=>{
  const originalFetch=globalThis.fetch;
  afterEach(()=>{globalThis.fetch=originalFetch;});
  it("never invents a currency or timezone; rejects invalid values and normalizes aliases",()=>{
    assert.equal(effectiveReportingContext(undefined).timezone,null);
    assert.equal(effectiveReportingContext(undefined).currency,null);
    assert.equal(timezoneSchema.safeParse("browser").success,false);
    assert.equal(currencySchema.safeParse("ZZZ").success,false);
    assert.equal(currencySchema.parse("vnd"),"VND");
    assert.equal(timezoneSchema.parse("Asia/Ho_Chi_Minh"),timezoneSchema.parse("Asia/Saigon"));
  });
  it("an unverified field is not evidence; conflicts have deterministic flags",()=>{
    const raw={accountId:"a",providerTimezone:"UTC",providerCurrency:"VND",providerObservedAt:null,overrideTimezone:null,overrideCurrency:null,overrideAt:null};
    assert.equal(effectiveReportingContext(raw).timezone,null);
    const conflict=effectiveReportingContext({...raw,providerObservedAt:new Date().toISOString(),overrideAt:new Date().toISOString(),overrideTimezone:"America/New_York",overrideCurrency:"USD"});
    assert.equal(conflict.timezoneConflict,true); assert.equal(conflict.currencyConflict,true);
  });
  it("Meta requests timezone_name and currency without manufacturing missing values",async()=>{
    globalThis.fetch=async input=>{
      const url=new URL(String(input)); assert.ok(url.searchParams.get("fields")?.includes("timezone_name")); assert.ok(url.searchParams.get("fields")?.includes("currency"));
      return Response.json({data:[{id:"act_123",currency:"VND",timezone_name:"Asia/Ho_Chi_Minh"},{id:"act_456"}]});
    };
    const rows=await metaAdsClient.getAdAccounts("synthetic"); assert.equal(rows[0].timezone_name,"Asia/Ho_Chi_Minh"); assert.equal(rows[1].currency,undefined);
  });
  it("Google includes customer context in the report and preserves normalized fields",async()=>{
    const original=googleAdsReportClient.searchStream;
    googleAdsReportClient.searchStream=async(_token,_id,query)=>{assert.ok(query.includes("customer.time_zone"));assert.ok(query.includes("customer.currency_code"));return[];};
    try { await googleAdsReportClient.getCampaignPerformance("synthetic","123","LAST_7_DAYS"); }
    finally {googleAdsReportClient.searchStream=original;}
    const row=normalizeGoogleAdsRow({customer:{timeZone:"Asia/Ho_Chi_Minh",currencyCode:"VND"}});
    assert.equal(row.customer_time_zone,"Asia/Ho_Chi_Minh");assert.equal(row.customer_currency_code,"VND");
  });
  it("TikTok account context is matched to the requested advertiser and sandbox stays separate",async()=>{
    globalThis.fetch=async(input,init)=>{
      const url=new URL(String(input)); assert.equal(url.hostname,"sandbox-ads.tiktok.com"); assert.equal(url.searchParams.get("advertiser_ids"),'["123"]');
      assert.equal(new Headers(init?.headers).get("Access-Token"),"synthetic");
      return Response.json({code:0,data:{list:[{advertiser_id:"other",timezone:"UTC",currency:"USD"},{advertiser_id:"123",timezone:"Asia/Ho_Chi_Minh",currency:"VND"}]}});
    };
    assert.deepEqual(await tiktokReportClient.getAdvertiserReportingContext("synthetic","123",true),{timezone:"Asia/Ho_Chi_Minh",currency:"VND"});
    globalThis.fetch=async()=>Response.json({code:0,data:{list:[]}});
    await assert.rejects(tiktokReportClient.getAdvertiserReportingContext("synthetic","123"));
  });
});
