import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TENANT_GUARDED_MODELS, shouldSkipTenantGuard, withSystemScope } from "./tenant-guard";

// Fleet cron/webhooks escape the tenant guard only inside a withSystemScope
// callback. These tests pin the lifetime contract: the scope is bounded by
// AsyncLocalStorage and can never leak past a return or a throw.
describe("withSystemScope lifetime", () => {
  it("is inactive outside any system scope and keeps the guarded model set intact", () => {
    assert.equal(shouldSkipTenantGuard(), false);
    assert.ok(TENANT_GUARDED_MODELS.has("ReportSchedule"));
  });

  it("activates inside a sync callback and closes after it returns", () => {
    withSystemScope(() => {
      assert.equal(shouldSkipTenantGuard(), true);
    });
    assert.equal(shouldSkipTenantGuard(), false);
  });

  it("stays active across awaits inside an async callback and closes after success", async () => {
    await withSystemScope(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      assert.equal(shouldSkipTenantGuard(), true);
    });
    assert.equal(shouldSkipTenantGuard(), false);
  });

  it("closes after an async callback throws", async () => {
    await assert.rejects(
      withSystemScope(async () => {
        assert.equal(shouldSkipTenantGuard(), true);
        throw new Error("scope-boom");
      }),
      /scope-boom/,
    );
    assert.equal(shouldSkipTenantGuard(), false);
  });

  it("closes after a sync callback throws", () => {
    assert.throws(
      () =>
        withSystemScope(() => {
          assert.equal(shouldSkipTenantGuard(), true);
          throw new Error("sync-boom");
        }),
      /sync-boom/,
    );
    assert.equal(shouldSkipTenantGuard(), false);
  });
});
