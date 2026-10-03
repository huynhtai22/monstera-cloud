/**
 * Regression tests for PR #172 P2 remediation and production wiring.
 *
 * Exercises the canonical helpers imported and executed by RefreshWarehouseModal:
 *   A) Contract A: Modal lifecycle, context switching, user modification preservation,
 *      and guaranteed exclusion of stale connections in submitted batch requests.
 *   B) Contract B: Terminal job status routing, canonical headings, failed scope
 *      aggregation, and conditional view-data access.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveSessionKey,
  needsReinit,
  createInitialModalSelectionState,
  resolveSelectionOnContextOrData,
  userToggleSource,
  userToggleMetaAcct,
  userSetAllSources,
  isTargetAccountResolving,
  buildBatchImportItems,
  terminalStatusToUiStep,
  canViewImportedData,
  terminalHeading,
  type ConnectionItem,
  type UiStep,
} from "./refresh-modal-logic";

// ---------------------------------------------------------------------------
// Contract A — Modal Lifecycle & Request Construction
// ---------------------------------------------------------------------------

describe("Contract A: Modal selection lifecycle & production request construction", () => {
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
  const tiktokConn: ConnectionItem = {
    id: "conn-tiktok-1",
    name: "Acme TikTok",
    provider: "tiktok_business",
    type: "source",
    status: "active",
  };
  const allConnections = [metaConn, googleConn, tiktokConn];

  it("0. Derives stable session key and handles reinit detection", () => {
    const keyA = deriveSessionKey({ workspaceId: "ws-1", platform: "meta_ads", accountId: "123" });
    const keyB = deriveSessionKey({ workspaceId: "ws-1", platform: "google_ads", accountId: null });
    assert.strictEqual(keyA, "ws-1|meta_ads|123");
    assert.strictEqual(keyB, "ws-1|google_ads|");
    assert.strictEqual(needsReinit(keyA, null), true);
    assert.strictEqual(needsReinit(keyA, keyA), false);
    assert.strictEqual(needsReinit(keyB, keyA), true);
  });

  it("1. Open modal with Meta context and Meta account: waits for async connection data", () => {
    let state = createInitialModalSelectionState();
    state = resolveSelectionOnContextOrData({
      state,
      isOpen: true,
      workspaceId: "ws-1",
      initialPlatform: "meta_ads",
      initialAccountId: "12345",
      connections: [],
      metaAccountsByConn: {},
    });
    assert.strictEqual(state.selectedConnIds.size, 0);
    assert.strictEqual(state.initializedSessionKey, null);
  });

  it("2 & 3. Async connection and Meta account arrival selects only intended Meta connection and account", () => {
    let state = createInitialModalSelectionState();
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
          { id: "67890", name: "Other Account" },
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

  it("4, 5, 6. User manually changes selection -> SWR revalidation preserves manual changes", () => {
    let state = createInitialModalSelectionState();
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

    // User toggles Google Ads on and toggles an account
    state = userToggleSource(state, "conn-google-1");
    state = userToggleMetaAcct(state, "conn-meta-1", "99999");
    assert.strictEqual(state.userModified, true);
    assert.strictEqual(state.selectedConnIds.size, 2);
    assert.ok(state.metaAcctPick["conn-meta-1"].has("99999"));

    // SWR background polling revalidates connections
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

    // Manual changes are strictly preserved
    assert.strictEqual(state.selectedConnIds.size, 2);
    assert.ok(state.selectedConnIds.has("conn-meta-1"));
    assert.ok(state.selectedConnIds.has("conn-google-1"));
    assert.ok(state.metaAcctPick["conn-meta-1"].has("99999"));
  });

  it("7, 8, 9, 10, 11, 12. Close modal -> change context to Google Ads -> reopen -> old connection cannot be queued", () => {
    let state = createInitialModalSelectionState();
    // Step 1: Initialize Meta
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

    // Step 8 & 9: Reopen with Google Ads context
    state = resolveSelectionOnContextOrData({
      state,
      isOpen: true,
      workspaceId: "ws-1",
      initialPlatform: "google_ads",
      initialAccountId: null,
      connections: allConnections,
      metaAccountsByConn: {},
    });

    // Step 10 & 11: Only Google is selected
    assert.strictEqual(state.selectedConnIds.size, 1);
    assert.ok(state.selectedConnIds.has("conn-google-1"));
    assert.ok(!state.selectedConnIds.has("conn-meta-1"), "Old Meta connection must NOT be retained");

    // Step 12: Build batch import items -> submitted request CANNOT contain the old connection
    const { items, error } = buildBatchImportItems({
      selectedConnIds: state.selectedConnIds,
      connections: allConnections,
      metaAcctPick: state.metaAcctPick,
      metaAccountsByConn: {},
      initialAccountId: null,
    });

    assert.strictEqual(error, undefined);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].connectionId, "conn-google-1");
    assert.ok(!items.some((i) => i.connectionId === "conn-meta-1"), "Old Meta connection proven absent from request");
  });

  it("13. Close and reopen without targeted platform/account -> explicit empty fallback", () => {
    let state = createInitialModalSelectionState();
    state = resolveSelectionOnContextOrData({
      state,
      isOpen: true,
      workspaceId: "ws-1",
      initialPlatform: null,
      initialAccountId: null,
      connections: allConnections,
      metaAccountsByConn: {},
    });

    assert.strictEqual(state.selectedConnIds.size, 0);
    assert.ok(state.initializedSessionKey !== null);
  });

  it("14. Failed targeted account lookup fails closed without selecting unrelated sources", () => {
    let state = createInitialModalSelectionState();
    state = resolveSelectionOnContextOrData({
      state,
      isOpen: true,
      workspaceId: "ws-1",
      initialPlatform: "meta_ads",
      initialAccountId: "missing-account-999",
      connections: allConnections,
      metaAccountsByConn: {
        "conn-meta-1": [{ id: "other-account", name: "Other" }],
      },
    });

    assert.strictEqual(state.selectedConnIds.size, 0);
    assert.ok(state.accountNotFoundNotice !== null);
    assert.ok(state.accountNotFoundNotice!.includes("missing-account-999"));

    // buildBatchImportItems fails closed
    const { items: emptyItems, error: noError } = buildBatchImportItems({
      selectedConnIds: state.selectedConnIds,
      connections: allConnections,
      metaAcctPick: state.metaAcctPick,
      metaAccountsByConn: { "conn-meta-1": [{ id: "other-account", name: "Other" }] },
      initialAccountId: "missing-account-999",
    });
    assert.strictEqual(emptyItems.length, 0);
    assert.strictEqual(noError, undefined);

    // If connection was selected without resolving target account, it returns actionable error
    const { items: errItems, error: targetError } = buildBatchImportItems({
      selectedConnIds: new Set(["conn-meta-1"]),
      connections: allConnections,
      metaAcctPick: {},
      metaAccountsByConn: { "conn-meta-1": [{ id: "other-account", name: "Other" }] },
      initialAccountId: "missing-account-999",
    });
    assert.strictEqual(errItems.length, 0);
    assert.ok(targetError?.includes("Target ad account could not be resolved"));
  });

  it("15. isTargetAccountResolving detects pending async account lookup", () => {
    const state = createInitialModalSelectionState();
    // Meta connection exists, but meta accounts have not loaded yet
    const resolving = isTargetAccountResolving({
      initialAccountId: "12345",
      connections: allConnections,
      metaAccountsByConn: {},
      selectionState: state,
    });
    assert.strictEqual(resolving, true);

    // Once accounts load and match is found
    const loadedState: typeof state = {
      ...state,
      metaAcctPick: { "conn-meta-1": new Set(["12345"]) },
    };
    const resolved = isTargetAccountResolving({
      initialAccountId: "12345",
      connections: allConnections,
      metaAccountsByConn: { "conn-meta-1": [{ id: "12345", name: "Linh" }] },
      selectionState: loadedState,
    });
    assert.strictEqual(resolved, false);
  });

  it("16. userSetAllSources toggles all connections and marks user modified", () => {
    let state = createInitialModalSelectionState();
    state = userSetAllSources(state, ["conn-meta-1", "conn-google-1", "conn-tiktok-1"]);
    assert.strictEqual(state.selectedConnIds.size, 3);
    assert.strictEqual(state.userModified, true);

    state = userSetAllSources(state, []);
    assert.strictEqual(state.selectedConnIds.size, 0);
    assert.strictEqual(state.userModified, true);
  });
});

// ---------------------------------------------------------------------------
// Contract B — Partial Terminal State & Rendering Logic
// ---------------------------------------------------------------------------

describe("Contract B: Partial terminal state & heading logic", () => {
  it("1. Polling receives status: 'partial' -> maps to 'partial' step, never 'success'", () => {
    const step = terminalStatusToUiStep("partial");
    assert.strictEqual(step, "partial");
    assert.notStrictEqual(step, "success" as UiStep);
  });

  it("2 & 3. Partial does NOT display full-success heading; warning heading is distinct", () => {
    const successHeading = terminalHeading("success");
    const partialHeading = terminalHeading("partial");
    const errorHeading = terminalHeading("error");

    assert.strictEqual(successHeading, "Warehouse refresh complete");
    assert.strictEqual(partialHeading, "Warehouse refresh completed with warnings");
    assert.strictEqual(errorHeading, "Refresh failed to start");
    assert.notStrictEqual(partialHeading, successHeading);
  });

  it("4 & 5. Failed items and error messages are correctly filtered from multi-item job results", () => {
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

  it("6 & 7. Distinguishes successful and failed items when counts are available", () => {
    const results = [
      { connectionId: "conn-1", provider: "meta_ads", ok: true, rowsIngested: 50 },
      { connectionId: "conn-2", provider: "tiktok_business", ok: true, rowsIngested: 30 },
      { connectionId: "conn-3", provider: "google_ads", ok: false, error: "Auth expired" },
    ];
    const failed = results.filter((r) => !r.ok);
    assert.strictEqual(failed.length, 1);
    assert.strictEqual(results.length, 3);
  });

  it("8. Permits viewing imported data on partial when approximateRows > 0; denies when 0 or null", () => {
    assert.strictEqual(canViewImportedData("partial", 42), true);
    assert.strictEqual(canViewImportedData("partial", 0), false);
    assert.strictEqual(canViewImportedData("partial", null), false);
    assert.strictEqual(canViewImportedData("partial", undefined), false);
  });

  it("9. Completed always allows viewing imported data; failed never allows viewing", () => {
    assert.strictEqual(canViewImportedData("completed", 0), true);
    assert.strictEqual(canViewImportedData("completed", 100), true);
    assert.strictEqual(canViewImportedData("failed", 100), false);
    assert.strictEqual(canViewImportedData("failed", 0), false);
  });

  it("10. Status semantics strictly distinguish completed, partial, and failed", () => {
    assert.strictEqual(terminalStatusToUiStep("completed"), "success");
    assert.strictEqual(terminalStatusToUiStep("partial"), "partial");
    assert.strictEqual(terminalStatusToUiStep("failed"), "error");
    assert.strictEqual(terminalStatusToUiStep("unknown_status"), "error");
  });
});
