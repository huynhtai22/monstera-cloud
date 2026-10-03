import test from "node:test";
import assert from "node:assert/strict";
import { metaAdsClient } from "./meta-ads";
const account = (id: string) => ({ id, name: id, currency: "USD", account_status: 1 });
test("Meta inventory follows pages and deduplicates accounts without leaking tokens to another origin", async () => {
  const original = globalThis.fetch; const urls: string[] = [];
  try {
    globalThis.fetch = async (input, init) => {
      urls.push(String(input)); assert.ok(init?.signal); assert.equal(init?.redirect, "error");
      return Response.json(urls.length === 1 ? { data: [account("act_1")], paging: { next: "https://graph.facebook.com/v23.0/me/adaccounts?after=test" } } : { data: [account("act_1"), account("act_2")] });
    };
    assert.deepEqual((await metaAdsClient.getAdAccounts("synthetic-token")).map(row => row.id), ["act_1", "act_2"]);
    assert.equal(urls.length, 2);
    globalThis.fetch = async () => Response.json({ data: [], paging: { next: "https://untrusted.example/adaccounts" } });
    await assert.rejects(() => metaAdsClient.getAdAccounts("synthetic-token"), /pagination URL/);
  } finally { globalThis.fetch = original; }
});
test("partial inventory is rejected on a later-page failure or repeated cursor", async () => {
  const original = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async () => ++calls === 1 ? Response.json({ data: [account("act_1")], paging: { next: "https://graph.facebook.com/page2" } }) : Response.json({ error: { message: "synthetic failure" } }, { status: 500 });
    await assert.rejects(() => metaAdsClient.getAdAccounts("synthetic-token"), /discovery failed/);
    globalThis.fetch = async () => Response.json({ data: [], paging: { next: "https://graph.facebook.com/repeated" } });
    await assert.rejects(() => metaAdsClient.getAdAccounts("synthetic-token"), /pagination limit/);
  } finally { globalThis.fetch = original; }
});
