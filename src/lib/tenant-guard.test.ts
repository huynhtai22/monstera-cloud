import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  argsHaveWorkspaceScope,
  assertTenantScoped,
  TenantScopeError,
  withSystemScope,
  shouldSkipTenantGuard,
} from "./tenant-guard";

describe("tenant query guard", () => {
  it("accepts workspaceId, membership nested filters, and single-id updates", () => {
    assert.equal(argsHaveWorkspaceScope({ where: { workspaceId: "ws-a" } }), true);
    assert.equal(
      argsHaveWorkspaceScope({
        where: { workspace: { members: { some: { userId: "u1" } } } },
      }),
      true,
    );
    assert.equal(argsHaveWorkspaceScope({ where: { status: "connected" } }), false);

    assert.doesNotThrow(() =>
      assertTenantScoped("Connection", "findMany", { where: { workspaceId: "ws-a" } }),
    );
    assert.doesNotThrow(() =>
      assertTenantScoped("WarehouseImportJob", "updateMany", { where: { id: "job_1" } }),
    );
    assert.throws(
      () => assertTenantScoped("Connection", "findMany", { where: { status: "connected" } }),
      TenantScopeError,
    );
    assert.throws(
      () =>
        assertTenantScoped("WarehouseImportJob", "updateMany", {
          where: { status: "running" },
        }),
      TenantScopeError,
    );
    assert.throws(
      () => assertTenantScoped("CampaignMetric", "create", { data: { platform: "meta_ads" } }),
      TenantScopeError,
    );
    assert.doesNotThrow(() =>
      assertTenantScoped("CampaignMetric", "create", {
        data: { workspaceId: "ws-a", platform: "meta_ads" },
      }),
    );
    assert.doesNotThrow(() =>
      assertTenantScoped("User", "findMany", { where: {} }),
    );
  });

  it("skips enforcement inside withSystemScope", () => {
    assert.equal(shouldSkipTenantGuard(), false);
    withSystemScope(() => {
      assert.equal(shouldSkipTenantGuard(), true);
    });
    assert.equal(shouldSkipTenantGuard(), false);
  });
});
