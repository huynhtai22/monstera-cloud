import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRawRetentionDryRunHandler } from "./route";
import type { RawRetentionDryRunInput } from "@/lib/warehouse-raw-retention";
import { RawRetentionTimeoutError } from "@/lib/warehouse-raw-retention";

const request = (query = "") => new Request(`http://localhost/api/operations/warehouse/raw-retention/dry-run${query}`);

describe("raw retention dry-run route", () => {
  it("rejects missing authentication before operator lookup or measurement", async () => {
    let lookedUp = 0;
    let measured = 0;
    const handler = createRawRetentionDryRunHandler({
      getSession: async () => null,
      findOperator: async () => { lookedUp++; return null; },
      measure: async () => { measured++; return {} as any; },
    });
    const response = await handler(request("?workspaceId=ws&retentionDays=30"));
    assert.equal(response.status, 401);
    assert.equal(lookedUp, 0);
    assert.equal(measured, 0);
  });

  it("rejects non-operators and malformed or repeated request values before measurement", async () => {
    let measured = 0;
    const base = {
      getSession: async () => ({ user: { id: "user" } } as any),
      findOperator: async () => null,
      measure: async () => { measured++; return {} as any; },
    };
    assert.equal((await createRawRetentionDryRunHandler(base)(request("?workspaceId=ws&retentionDays=30"))).status, 403);
    const operatorHandler = createRawRetentionDryRunHandler({ ...base, findOperator: async () => ({ id: "user" }) });
    for (const q of ["?workspaceId=ws", "?workspaceId=ws&retentionDays=14.5", "?workspaceId=ws&retentionDays=-14", "?workspaceId=ws&retentionDays=30&retentionDays=90", "?workspaceId=&retentionDays=30"]) {
      assert.equal((await operatorHandler(request(q))).status, 400);
    }
    assert.equal(measured, 0);
  });

  it("returns a cache-private dry-run response and never passes secrets to the service", async () => {
    let input: any;
    const handler = createRawRetentionDryRunHandler({
      getSession: async () => ({ user: { id: "operator" } } as any),
      findOperator: async () => ({ id: "operator" }),
      measure: (async (value: RawRetentionDryRunInput) => { input = value; return { dryRun: true, wouldMutate: false, executionAvailable: false }; }) as any,
    });
    const response = await handler(request("?workspaceId=ws-a&retentionDays=30&platform=meta_ads&sampleSize=10"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(input, { workspaceId: "ws-a", retentionDays: 30, platform: "meta_ads", sampleSize: 10 });
    assert.deepEqual(await response.json(), { dryRun: true, wouldMutate: false, executionAvailable: false });
  });

  it("rejects coordination-seam input and maps timeouts to 408 without internals", async () => {
    const operatorBase = {
      getSession: async () => ({ user: { id: "operator" } } as any),
      findOperator: async () => ({ id: "operator" }),
    };
    const strictHandler = createRawRetentionDryRunHandler({ ...operatorBase, measure: async () => ({}) as any });
    for (const q of [
      "?workspaceId=ws&retentionDays=30&afterSummary=1",
      "?workspaceId=ws&retentionDays=30&hooks=1",
      "?workspaceId=ws&retentionDays=30&isolationLevel=Serializable",
    ]) {
      assert.equal((await strictHandler(request(q))).status, 400, "test seams are never request-activatable");
    }
    for (const cause of [
      { code: "57014", message: "canceling statement due to statement timeout" },
      { code: "P2028", message: "Transaction API error: Transaction expired due to timeout" },
    ]) {
      const timeoutHandler = createRawRetentionDryRunHandler({
        ...operatorBase,
        measure: async () => { throw new RawRetentionTimeoutError(`retention timeout (${(cause as any).code})`); },
      });
      const response = await timeoutHandler(request("?workspaceId=ws&retentionDays=30"));
      assert.equal(response.status, 408);
      const body = JSON.stringify(await response.json());
      assert.equal(body, JSON.stringify({ error: "Measurement timed out." }));
      for (const leaked of ["SELECT", "P2028", "57014", "Prisma", "statement_timeout", "rawData"]) {
        assert.equal(body.includes(leaked), false, `error response must not contain ${leaked}`);
      }
    }
  });
});
