import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateCacheKey } from "./redis-cache";
import {
  ALL_CLIENTS_TOKEN,
  CLIENT_CONTEXT_SURFACE_POLICY,
  CLIENT_ID_QUERY_PARAM,
  UNASSIGNED_CLIENT_TOKEN,
  applyClientIdParam,
  canonicalHref,
  clientContextCacheParams,
  parseRequestedClientId,
  shouldPropagateClientContext,
  surfaceAllowsAllClients,
  surfaceAllowsUnassigned,
  surfaceForPathname,
  switchClientKeepingFilters,
  withClientContext,
  withClientContextAndFilters,
  withClientContextAndParams,
} from "./client-context";
import {
  ClientContextError,
  assertQueryableClientContext,
  resolveClientContext,
  toClientContextResponse,
  warehouseClientId,
} from "./client-context-server";

describe("client context URL contract", () => {
  it("parses missing, all, unassigned, id, and malformed values as distinct kinds", () => {
    assert.deepEqual(parseRequestedClientId(null), { kind: "missing", raw: null });
    assert.deepEqual(parseRequestedClientId(undefined), { kind: "missing", raw: null });
    assert.deepEqual(parseRequestedClientId(""), { kind: "missing", raw: null });
    assert.deepEqual(parseRequestedClientId(ALL_CLIENTS_TOKEN), { kind: "all", raw: "all" });
    assert.deepEqual(parseRequestedClientId(UNASSIGNED_CLIENT_TOKEN), {
      kind: "unassigned",
      raw: "unassigned",
    });
    assert.deepEqual(parseRequestedClientId("cl_aurora"), { kind: "id", raw: "cl_aurora" });
    assert.equal(parseRequestedClientId("ALL").kind, "id");
    assert.equal(parseRequestedClientId(" all ").kind, "malformed");
    assert.equal(parseRequestedClientId("client/../id").kind, "malformed");
    assert.equal(parseRequestedClientId("client id").kind, "malformed");
    assert.equal(parseRequestedClientId("x".repeat(161)).kind, "malformed");
  });

  it("serializes a single clientId and never duplicates the parameter", () => {
    const params = new URLSearchParams("clientId=a&foo=1&clientId=b");
    applyClientIdParam(params, "c");
    assert.deepEqual(params.getAll(CLIENT_ID_QUERY_PARAM), ["c"]);
    applyClientIdParam(params, null);
    assert.equal(params.has(CLIENT_ID_QUERY_PARAM), false);
    assert.equal(params.get("foo"), "1");
  });

  it("builds hrefs with structured URL APIs instead of string concatenation", () => {
    assert.equal(
      withClientContext("/reports?source=meta_ads", "cl_a"),
      "/reports?source=meta_ads&clientId=cl_a",
    );
    assert.equal(
      withClientContext("/sources?tab=accounts&clientId=old", "cl_b"),
      "/sources?tab=accounts&clientId=cl_b",
    );
    assert.equal(withClientContext("/exports", null), "/exports");
    assert.equal(withClientContext("/explorer?platform=google_ads", "all"), "/explorer?platform=google_ads&clientId=all");
    assert.equal(
      withClientContextAndParams("/sources", "cl_a", { tab: "accounts" }),
      "/sources?clientId=cl_a&tab=accounts",
    );
    assert.equal(
      withClientContextAndFilters(
        "/explorer?view=table",
        "cl_a",
        new URLSearchParams("startDate=2026-09-01&endDate=2026-09-07&platform=google_ads&accountId=act_1&tab=ignored"),
      ),
      "/explorer?view=table&startDate=2026-09-01&endDate=2026-09-07&platform=google_ads&tab=ignored&clientId=cl_a",
    );
    assert.equal(
      withClientContextAndFilters(
        "/sources?tab=accounts",
        "cl_a",
        new URLSearchParams("tab=ignored&search=north"),
      ),
      "/sources?tab=accounts&search=north&clientId=cl_a",
    );
  });

  it("preserves relevant filters and drops account/pagination keys when switching clients", () => {
    const current = new URLSearchParams([
      ["clientId", "cl_a"],
      ["startDate", "2026-09-01"],
      ["endDate", "2026-09-07"],
      ["platform", "google_ads"],
      ["source", "meta_ads"],
      ["view", "sync"],
      ["tab", "accounts"],
      ["search", "north"],
      ["status", "success"],
      ["accountId", "act_1"],
      ["accountIds", "act_1,act_2"],
      ["cursor", "abc"],
      ["page", "2"],
      ["after", "c1"],
    ]);
    const next = switchClientKeepingFilters(current, "cl_b");
    assert.equal(next.get("clientId"), "cl_b");
    assert.equal(next.get("startDate"), "2026-09-01");
    assert.equal(next.get("endDate"), "2026-09-07");
    assert.equal(next.get("platform"), "google_ads");
    assert.equal(next.get("source"), "meta_ads");
    assert.equal(next.get("view"), "sync");
    assert.equal(next.get("tab"), "accounts");
    assert.equal(next.get("search"), "north");
    assert.equal(next.get("status"), "success");
    assert.equal(next.has("accountId"), false);
    assert.equal(next.has("accountIds"), false);
    assert.equal(next.has("cursor"), false);
    assert.equal(next.has("page"), false);
    assert.equal(next.has("after"), false);
    assert.deepEqual(next.getAll("clientId"), ["cl_b"]);
  });

  it("removes client context only when the next value is missing", () => {
    const current = new URLSearchParams("clientId=cl_a&platform=meta_ads");
    const cleared = switchClientKeepingFilters(current, null);
    assert.equal(cleared.has("clientId"), false);
    assert.equal(cleared.get("platform"), "meta_ads");
  });

  it("allows all-clients on operational surfaces and unassigned only on warehouse", () => {
    for (const surface of ["clients", "sources", "reports", "warehouse", "exports"] as const) {
      assert.equal(surfaceAllowsAllClients(surface), true);
      assert.equal(CLIENT_CONTEXT_SURFACE_POLICY[surface].allowsAllClients, true);
    }
    assert.equal(surfaceAllowsUnassigned("warehouse"), true);
    assert.equal(surfaceAllowsUnassigned("reports"), false);
    assert.equal(surfaceAllowsUnassigned("exports"), false);
    assert.equal(surfaceAllowsUnassigned("sources"), false);
    assert.equal(surfaceAllowsUnassigned("clients"), false);
  });

  it("maps operational pathnames and refuses to propagate onto workspace-wide pages", () => {
    assert.equal(surfaceForPathname("/clients"), "clients");
    assert.equal(surfaceForPathname("/sources"), "sources");
    assert.equal(surfaceForPathname("/reports"), "reports");
    assert.equal(surfaceForPathname("/explorer"), "warehouse");
    assert.equal(surfaceForPathname("/exports"), "exports");
    assert.equal(surfaceForPathname("/console"), null);
    assert.equal(surfaceForPathname("/settings"), null);
    assert.equal(shouldPropagateClientContext("/reports"), true);
    assert.equal(shouldPropagateClientContext("/settings"), false);
    assert.equal(canonicalHref("/reports", new URLSearchParams("clientId=cl_a")), "/reports?clientId=cl_a");
    assert.equal(canonicalHref("/reports", new URLSearchParams()), "/reports");
  });

  it("isolates cache keys across missing, all, unassigned, and real client ids", () => {
    const base = { workspaceId: "ws_1", startDateStr: "2026-09-01" };
    const missing = generateCacheKey("metrics:query", { ...base, ...clientContextCacheParams(null) });
    const all = generateCacheKey("metrics:query", { ...base, ...clientContextCacheParams("all") });
    const unassigned = generateCacheKey("metrics:query", { ...base, ...clientContextCacheParams("unassigned") });
    const clientA = generateCacheKey("metrics:query", { ...base, ...clientContextCacheParams("cl_a") });
    const clientB = generateCacheKey("metrics:query", { ...base, ...clientContextCacheParams("cl_b") });
    const keys = new Set([missing, all, unassigned, clientA, clientB]);
    assert.equal(keys.size, 5);
  });
});

describe("client context server resolver contract", () => {
  it("returns none vs all as distinct statuses without querying", async () => {
    let lookedUp = false;
    const db = {
      client: {
        findFirst: async () => {
          lookedUp = true;
          return null;
        },
      },
    };
    const none = await resolveClientContext({ workspaceId: "ws_1", requestedClientId: null, surface: "reports" }, db);
    const all = await resolveClientContext({ workspaceId: "ws_1", requestedClientId: "all", surface: "reports" }, db);
    assert.equal(none.status, "none");
    assert.equal(all.status, "all");
    assert.equal(warehouseClientId(none), undefined);
    assert.equal(warehouseClientId(all), undefined);
    assert.equal(lookedUp, false);
  });

  it("rejects unassigned on non-warehouse surfaces and all on require-explicit operations", async () => {
    const unassigned = await resolveClientContext({
      workspaceId: "ws_1",
      requestedClientId: "unassigned",
      surface: "reports",
    }, { client: { findFirst: async () => null } });
    assert.equal(unassigned.status, "unsupported_unassigned");
    assert.throws(
      () => assertQueryableClientContext(unassigned),
      (error: unknown) => error instanceof ClientContextError && error.statusCode === 400 && error.code === "UNSUPPORTED_CLIENT_SCOPE",
    );

    const all = await resolveClientContext({
      workspaceId: "ws_1",
      requestedClientId: "all",
      surface: "reports",
    }, { client: { findFirst: async () => null } });
    assert.throws(
      () => assertQueryableClientContext(all, { requireExplicitClient: true }),
      (error: unknown) => error instanceof ClientContextError && error.code === "INVALID_CLIENT",
    );
  });

  it("treats missing and rival ids as the same 404 body and never falls back to all", async () => {
    const db = {
      client: {
        findFirst: async (args: Record<string, unknown>) => {
          const where = args.where as { id: string; workspaceId: string };
          assert.equal(where.workspaceId, "ws_1");
          return null;
        },
      },
    };
    const missing = await resolveClientContext({
      workspaceId: "ws_1",
      requestedClientId: "cl_deleted",
      surface: "warehouse",
    }, db);
    const rival = await resolveClientContext({
      workspaceId: "ws_1",
      requestedClientId: "cl_other_workspace",
      surface: "warehouse",
    }, db);
    assert.equal(missing.status, "not_found");
    assert.equal(rival.status, "not_found");
    const missingRes = toClientContextResponse(
      (() => {
        try {
          assertQueryableClientContext(missing);
        } catch (error) {
          return error;
        }
      })(),
    );
    const rivalRes = toClientContextResponse(
      (() => {
        try {
          assertQueryableClientContext(rival);
        } catch (error) {
          return error;
        }
      })(),
    );
    assert.ok(missingRes);
    assert.ok(rivalRes);
    assert.equal(missingRes!.status, 404);
    assert.equal(rivalRes!.status, 404);
    assert.deepEqual(await missingRes!.json(), await rivalRes!.json());
    assert.equal(warehouseClientId(missing), undefined);
  });

  it("returns 400 INVALID_CLIENT for malformed ids without querying", async () => {
    let lookedUp = false;
    const malformed = await resolveClientContext({
      workspaceId: "ws_1",
      requestedClientId: "not a valid id",
      surface: "exports",
    }, {
      client: {
        findFirst: async () => {
          lookedUp = true;
          return { id: "x", name: "leak", workspaceId: "ws_1" };
        },
      },
    });
    assert.equal(malformed.status, "malformed");
    assert.equal(lookedUp, false);
    try {
      assertQueryableClientContext(malformed);
      assert.fail("expected throw");
    } catch (error) {
      assert.ok(error instanceof ClientContextError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "INVALID_CLIENT");
      const response = toClientContextResponse(error);
      assert.equal(response?.status, 400);
      const body = await response!.json() as { error: string; code: string };
      assert.equal(body.error, "Client not found in workspace");
      assert.equal(body.code, "INVALID_CLIENT");
    }
  });

  it("resolves a workspace-owned client and exposes it for warehouse queries", async () => {
    const resolution = await resolveClientContext({
      workspaceId: "ws_1",
      requestedClientId: "cl_a",
      surface: "warehouse",
    }, {
      client: {
        findFirst: async () => ({ id: "cl_a", name: "Aurora Retailer", workspaceId: "ws_1" }),
      },
    });
    assert.equal(resolution.status, "resolved");
    if (resolution.status !== "resolved") return;
    assert.equal(resolution.client.name, "Aurora Retailer");
    assert.equal(warehouseClientId(resolution), "cl_a");
    assertQueryableClientContext(resolution);
  });

  it("accepts unassigned only for warehouse and maps it to the warehouse token", async () => {
    const warehouse = await resolveClientContext({
      workspaceId: "ws_1",
      requestedClientId: "unassigned",
      surface: "warehouse",
    }, { client: { findFirst: async () => null } });
    assert.equal(warehouse.status, "unassigned");
    assert.equal(warehouseClientId(warehouse), "unassigned");
  });
});
