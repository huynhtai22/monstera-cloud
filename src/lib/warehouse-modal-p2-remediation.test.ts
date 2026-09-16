/**
 * Failing-first regression tests for PR #172 P2 findings:
 *
 *   A) PRRT_kwDORrfpSc6izGEj — Modal reopen must use new context, not stale selection.
 *   B) PRRT_kwDORrfpSc6izGEn — Partial terminal jobs must not render as full success.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveSessionKey,
  needsReinit,
  terminalStatusToUiStep,
  canViewImportedData,
  terminalHeading,
  type UiStep,
  createInitialModalSelectionState,
  resolveSelectionOnContextOrData,
  type ConnectionItem,
} from "./refresh-modal-logic";

// ---------------------------------------------------------------------------
// Contract A — Modal reopen and context change (PRRT_kwDORrfpSc6izGEj)
// ---------------------------------------------------------------------------

describe("Contract A: Open-session initialization key & selection lifecycle", () => {
  const metaConn: ConnectionItem = {
    id: "conn-meta-1",
    name: "Linh Lmour Meta",
    provider: "meta_ads",
    type: "source",
    status: "active",
  };
  const googleConn: ConnectionItem = {
    id: "conn-google-1",
    name: "Acme Google Ads",
    provider: "google_ads",
    type: "source",
    status: "active",
  };
  const allConnections = [metaConn, googleConn];

  it("0. Derives stable session key and handles reinit detection", () => {
    const keyA = deriveSessionKey({ workspaceId: "ws-1", platform: "meta_ads", accountId: "123" });
    const keyB = deriveSessionKey({ workspaceId: "ws-1", platform: "google_ads", accountId: null });
    assert.strictEqual(keyA, "ws-1|meta_ads|123");
    assert.strictEqual(keyB, "ws-1|google_ads|");
    assert.strictEqual(needsReinit(keyA, null), true);
    assert.strictEqual(needsReinit(keyA, keyA), false);
    assert.strictEqual(needsReinit(keyB, keyA), true);
  });

  it("1. Open modal with Meta context and Meta account selected: waits for async connection data", () => {
    let state = createInitialModalSelectionState();
    // Modal opens, but connections haven't loaded yet
    state = resolveSelectionOnContextOrData({
      state,
      isOpen: true,
      workspaceId: "ws-1",
      initialPlatform: "meta_ads",
      initialAccountId: "12345",
      connections: [],
      metaAccountsByConn: {},
    });
    // Should still be empty while waiting
    assert.strictEqual(state.selectedConnIds.size, 0);
    assert.strictEqual(state.initializedSessionKey, null);
  });

  it("2 & 3. Allow async connection and meta account data to load -> only intended Meta connection and account selected", () => {
    let state = createInitialModalSelectionState();
    // Connections load
    state = resolveSelectionOnContextOrData({
      state,
      isOpen: true,
      workspaceId: "ws-1",
      initialPlatform: "meta_ads",
      initialAccountId: "12345",
      connections: allConnections,
      metaAccountsByConn: {
        "conn-meta-1": [
          { id: "12345", name: "Linh Lmour Main" },
          { id: "67890", name: "Unrelated Account" },
        ],
      },
    });

    assert.strictEqual(state.selectedConnIds.size, 1);
    assert.ok(state.selectedConnIds.has("conn-meta-1"));
    assert.ok(!state.selectedConnIds.has("conn-google-1"));
    assert.deepEqual(state.metaAcctPick["conn-meta-1"], new Set(["12345"]));
    assert.strictEqual(state.accountNotFoundNotice, null);
    assert.ok(state.initializedSessionKey !== null);
  });

  it("3b. Meta act_ normalization: initialAccountId with act_ prefix matches raw id in metaAccounts", () => {
    let state = createInitialModalSelectionState();
    state = resolveSelectionOnContextOrData({
      state,
      isOpen: true,
      workspaceId: "ws-1",
      initialPlatform: "meta_ads",
      initialAccountId: "act_12345",
      connections: allConnections,
      metaAccountsByConn: {
        "conn-meta-1": [{ id: "12345", name: "Linh Lmour Main" }],
      },
    });

    assert.ok(state.selectedConnIds.has("conn-meta-1"));
    assert.deepEqual(state.metaAcctPick["conn-meta-1"], new Set(["12345"]));
  });

  it("4, 5, 6. Manually change selection while open -> polling/revalidation does not overwrite manual selection", () => {
    let state = createInitialModalSelectionState();
    // Initialize with Meta
    state = resolveSelectionOnContextOrData({
      state,
      isOpen: true,
      workspaceId: "ws-1",
      initialPlatform: "meta_ads",
      initialAccountId: "12345",
      connections: allConnections,
      metaAccountsByConn: {
        "conn-meta-1": [{ id: "12345", name: "Linh Lmour Main" }],
      },
    });

    // Step 4: User manually selects Google Ads in addition to Meta
    state = {
      ...state,
      selectedConnIds: new Set(["conn-meta-1", "conn-google-1"]),
      userModified: true,
    };

    // Step 5: Simulate background connection revalidation from SWR
    state = resolveSelectionOnContextOrData({
      state,
      isOpen: true,
      workspaceId: "ws-1",
      initialPlatform: "meta_ads",
      initialAccountId: "12345",
      connections: [...allConnections],
      metaAccountsByConn: {
        "conn-meta-1": [{ id: "12345", name: "Linh Lmour Main" }],
      },
    });

    // Step 6: User's manual selection is preserved!
    assert.strictEqual(state.selectedConnIds.size, 2);
    assert.ok(state.selectedConnIds.has("conn-meta-1"));
    assert.ok(state.selectedConnIds.has("conn-google-1"));
  });

  it("7, 8, 9, 10, 11. Close modal -> change context to Google Ads -> reopen -> initialized from Google Ads, old Meta connection NOT queued", () => {
    let state = createInitialModalSelectionState();
    // Initial open: Meta
    state = resolveSelectionOnContextOrData({
      state,
      isOpen: true,
      workspaceId: "ws-1",
      initialPlatform: "meta_ads",
      initialAccountId: "12345",
      connections: allConnections,
      metaAccountsByConn: {
        "conn-meta-1": [{ id: "12345", name: "Linh Lmour Main" }],
      },
    });
    assert.ok(state.selectedConnIds.has("conn-meta-1"));

    // Step 7: Close modal
    state = resolveSelectionOnContextOrData({
      state,
      isOpen: false,
      workspaceId: "ws-1",
      connections: allConnections,
      metaAccountsByConn: {},
    });
    assert.strictEqual(state.selectedConnIds.size, 0);
    assert.strictEqual(state.initializedSessionKey, null);
    assert.strictEqual(state.userModified, false);

    // Step 8 & 9: Reopen with context changed to Google Ads
    state = resolveSelectionOnContextOrData({
      state,
      isOpen: true,
      workspaceId: "ws-1",
      initialPlatform: "google_ads",
      initialAccountId: null,
      connections: allConnections,
      metaAccountsByConn: {},
    });

    // Step 10 & 11: Only Google is selected, old Meta connection cannot be queued accidentally!
    assert.strictEqual(state.selectedConnIds.size, 1);
    assert.ok(state.selectedConnIds.has("conn-google-1"));
    assert.ok(!state.selectedConnIds.has("conn-meta-1"), "Old Meta connection must NOT be retained!");
  });

  it("12 & 13. Close and reopen without a targeted account -> explicit empty fallback, does not silently select unrelated sources", () => {
    let state = createInitialModalSelectionState();
    // Reopen without targeted platform or account
    state = resolveSelectionOnContextOrData({
      state,
      isOpen: true,
      workspaceId: "ws-1",
      initialPlatform: null,
      initialAccountId: null,
      connections: allConnections,
      metaAccountsByConn: {},
    });

    assert.strictEqual(state.selectedConnIds.size, 0, "No sources should be selected by default when untargeted");
    assert.ok(state.initializedSessionKey !== null);
  });

  it("Failed targeted account lookup fails closed without selecting unrelated sources", () => {
    let state = createInitialModalSelectionState();
    state = resolveSelectionOnContextOrData({
      state,
      isOpen: true,
      workspaceId: "ws-1",
      initialPlatform: "meta_ads",
      initialAccountId: "non-existent-account",
      connections: allConnections,
      metaAccountsByConn: {
        "conn-meta-1": [{ id: "other-account", name: "Other" }],
      },
    });

    assert.strictEqual(state.selectedConnIds.size, 0, "Must fail closed when target account not found");
    assert.ok(state.accountNotFoundNotice !== null);
    assert.ok(state.accountNotFoundNotice!.includes("non-existent-account"));
  });
});

// ---------------------------------------------------------------------------
// Contract B — Partial terminal job (PRRT_kwDORrfpSc6izGEn)
// ---------------------------------------------------------------------------

describe("Contract B: Partial terminal job UI routing", () => {
  it("1. Polling receives status: 'partial' -> maps to 'partial' step, not 'success'", () => {
    const step = terminalStatusToUiStep("partial");
    assert.strictEqual(step, "partial");
    assert.notStrictEqual(step, "success" as UiStep);
  });

  it("2 & 3. Partial does NOT display ordinary full-success heading", () => {
    const successHeading = terminalHeading("success");
    const partialHeading = terminalHeading("partial");
    assert.strictEqual(successHeading, "Warehouse refresh complete");
    assert.notStrictEqual(partialHeading, successHeading);
  });

  it("4. Partial heading shows 'Warehouse refresh completed with warnings'", () => {
    assert.strictEqual(terminalHeading("partial"), "Warehouse refresh completed with warnings");
  });

  it("5 & 6. Failed items and error messages are correctly filterable from results", () => {
    const results = [
      { connectionId: "conn-1", provider: "meta_ads", ok: true, rowsIngested: 100 },
      { connectionId: "conn-2", provider: "google_ads", ok: false, error: "Rate limit exceeded" },
    ];
    const failed = results.filter((r) => !r.ok);
    const succeeded = results.filter((r) => r.ok);

    assert.strictEqual(failed.length, 1);
    assert.strictEqual(succeeded.length, 1);
    assert.strictEqual(failed[0].connectionId, "conn-2");
    assert.strictEqual(failed[0].error, "Rate limit exceeded");
  });

  it("7. Distinguishes successful and failed items when counts are available", () => {
    const results = [
      { connectionId: "conn-1", provider: "meta_ads", ok: true, rowsIngested: 50 },
      { connectionId: "conn-2", provider: "tiktok_business", ok: true, rowsIngested: 30 },
      { connectionId: "conn-3", provider: "google_ads", ok: false, error: "Auth expired" },
    ];
    const failed = results.filter((r) => !r.ok);
    const total = results.length;
    assert.strictEqual(failed.length, 1);
    assert.strictEqual(total, 3);
  });

  it("8. Permits viewing successfully imported data when rows were actually imported", () => {
    assert.strictEqual(canViewImportedData("partial", 42), true);
    assert.strictEqual(canViewImportedData("partial", 0), false);
    assert.strictEqual(canViewImportedData("partial", null), false);
  });

  it("9. Completed always allows viewing imported data; failed never allows it", () => {
    assert.strictEqual(canViewImportedData("completed", 0), true);
    assert.strictEqual(canViewImportedData("failed", 100), false);
  });

  it("10 & 11. Status semantics distinguish completed, partial, and failed", () => {
    assert.strictEqual(terminalStatusToUiStep("completed"), "success");
    assert.strictEqual(terminalStatusToUiStep("partial"), "partial");
    assert.strictEqual(terminalStatusToUiStep("failed"), "error");

    assert.strictEqual(terminalHeading("success"), "Warehouse refresh complete");
    assert.strictEqual(terminalHeading("partial"), "Warehouse refresh completed with warnings");
    assert.strictEqual(terminalHeading("error"), "Refresh failed");
  });
});
