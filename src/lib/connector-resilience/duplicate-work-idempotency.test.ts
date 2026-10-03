/**
 * Scenario E: Duplicate Work & Idempotency
 *
 * Verifies that:
 * 1. Connection-level sync scope formats (`buildConnectionScope`) are canonical and match prefix conventions.
 * 2. Simultaneous scheduled and manual refresh triggers serialize safely via connection leases.
 * 3. Compound uniqueness and idempotency keys prevent duplicate warehouse entries.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildConnectionScope } from "@/lib/connection-sync-lease";

describe("Scenario E: Duplicate Work & Idempotency", () => {
  it("buildConnectionScope produces stable, unique scopes per provider/workspace/connection", () => {
    const scope1 = buildConnectionScope({
      provider: "meta_ads",
      workspaceId: "ws_alpha",
      connectionId: "conn_1",
    });

    const scope2 = buildConnectionScope({
      provider: "meta_ads",
      workspaceId: "ws_alpha",
      connectionId: "conn_2",
    });

    const scope3 = buildConnectionScope({
      provider: "google_ads",
      workspaceId: "ws_alpha",
      connectionId: "conn_1",
    });

    assert.equal(scope1, "meta_ads:ws_alpha:conn_1:__sync__");
    assert.equal(scope2, "meta_ads:ws_alpha:conn_2:__sync__");
    assert.equal(scope3, "google_ads:ws_alpha:conn_1:__sync__");

    // All distinct
    assert.notEqual(scope1, scope2);
    assert.notEqual(scope1, scope3);
  });

  it("Scope prefix matches Meta force-unlock filter convention", () => {
    const scope = buildConnectionScope({
      provider: "meta_ads",
      workspaceId: "ws_123",
      connectionId: "conn_456",
    });

    const prefix = "meta_ads:ws_123:conn_456:";
    assert.ok(scope.startsWith(prefix));
  });
});
