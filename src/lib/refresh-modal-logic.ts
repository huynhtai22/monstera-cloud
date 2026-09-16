/**
 * Canonical logic helpers for RefreshWarehouseModal.
 *
 * Implements the selection lifecycle, batch item construction,
 * and terminal state handling. All helpers are imported and called
 * directly by RefreshWarehouseModal.tsx and verified by unit tests.
 */

// ---------------------------------------------------------------------------
// 1. Session Context & Reinitialization Key
// ---------------------------------------------------------------------------

export interface SessionContextKey {
  workspaceId: string | null;
  platform: string | null;
  accountId: string | null;
}

/**
 * Derive a stable string key identifying the unique open-session context.
 * Format: `<workspaceId>|<platform>|<accountId>`
 */
export function deriveSessionKey(ctx: SessionContextKey): string {
  return [
    ctx.workspaceId ?? "",
    ctx.platform ?? "",
    ctx.accountId ?? "",
  ].join("|");
}

/**
 * Decide whether the session needs a fresh initialization.
 * Returns true if uninitialized (previousKey is null) or if context changed.
 */
export function needsReinit(
  currentKey: string,
  previousKey: string | null
): boolean {
  return previousKey === null || previousKey !== currentKey;
}

// ---------------------------------------------------------------------------
// 2. Selection State & Reducers
// ---------------------------------------------------------------------------

export interface ConnectionItem {
  id: string;
  name: string;
  provider: string;
  type: string;
  status: string;
}

export interface ModalSelectionState {
  selectedConnIds: Set<string>;
  metaAcctPick: Record<string, Set<string>>;
  accountNotFoundNotice: string | null;
  initializedSessionKey: string | null;
  userModified: boolean;
}

export function createInitialModalSelectionState(): ModalSelectionState {
  return {
    selectedConnIds: new Set<string>(),
    metaAcctPick: {},
    accountNotFoundNotice: null,
    initializedSessionKey: null,
    userModified: false,
  };
}

/**
 * Pure state transition for modal selection on open, context change,
 * or asynchronous data arrival (connections or meta accounts).
 */
export function resolveSelectionOnContextOrData({
  state,
  isOpen,
  workspaceId,
  initialPlatform,
  initialAccountId,
  connections,
  metaAccountsByConn,
}: {
  state: ModalSelectionState;
  isOpen: boolean;
  workspaceId: string | null;
  initialPlatform?: string | null;
  initialAccountId?: string | null;
  connections: ConnectionItem[];
  metaAccountsByConn: Record<string, { id: string; name: string }[]>;
}): ModalSelectionState {
  if (!isOpen) {
    return createInitialModalSelectionState();
  }

  const currentSessionKey = deriveSessionKey({
    workspaceId,
    platform: initialPlatform ?? null,
    accountId: initialAccountId ?? null,
  });

  // If already initialized for this exact session context or user manually modified,
  // do not overwrite manual changes during background polling/revalidations
  if (!needsReinit(currentSessionKey, state.initializedSessionKey) || state.userModified) {
    return state;
  }

  // If connection data has not arrived yet, wait for it
  if (connections.length === 0) {
    return state;
  }

  // Branch 1: initialAccountId is specified -> match targeted Meta ad account
  if (initialAccountId) {
    const normTarget = initialAccountId.replace(/^act_/, "").trim();
    let matchFound = false;

    for (const [connId, accounts] of Object.entries(metaAccountsByConn)) {
      if (!Array.isArray(accounts) || accounts.length === 0) continue;
      const match = accounts.find(
        (a) => a.id === initialAccountId || a.id.replace(/^act_/, "").trim() === normTarget
      );
      if (match) {
        matchFound = true;
        return {
          ...state,
          selectedConnIds: new Set([connId]),
          metaAcctPick: { [connId]: new Set([match.id]) },
          accountNotFoundNotice: null,
          initializedSessionKey: currentSessionKey,
        };
      }
    }

    // If match not found, check if all meta accounts have finished loading
    const metaConns = connections.filter((c) => c.provider === "meta_ads");
    const allLoaded = metaConns.length > 0 && metaConns.every((c) => Array.isArray(metaAccountsByConn[c.id]));

    if (allLoaded && !matchFound) {
      // Fail closed: do not select arbitrary connections
      return {
        ...state,
        selectedConnIds: new Set(),
        metaAcctPick: {},
        accountNotFoundNotice: `Configured account ${initialAccountId} was not found in linked Meta connections. Please select an account manually.`,
        initializedSessionKey: currentSessionKey,
      };
    }

    // Still waiting for meta accounts to load
    return state;
  }

  // Branch 2: initialPlatform is specified (e.g. google_ads, meta_ads without specific account)
  if (initialPlatform) {
    const matching = connections.filter((c) => c.provider === initialPlatform);
    if (matching.length > 0) {
      return {
        ...state,
        selectedConnIds: new Set(matching.map((c) => c.id)),
        metaAcctPick: {},
        accountNotFoundNotice: null,
        initializedSessionKey: currentSessionKey,
      };
    }
    return {
      ...state,
      selectedConnIds: new Set(),
      metaAcctPick: {},
      accountNotFoundNotice: null,
      initializedSessionKey: currentSessionKey,
    };
  }

  // Branch 3: No initialPlatform or initialAccountId -> conservative explicit selection (empty)
  return {
    ...state,
    selectedConnIds: new Set(),
    metaAcctPick: {},
    accountNotFoundNotice: null,
    initializedSessionKey: currentSessionKey,
  };
}

/**
 * Transition when user toggles a connection checkbox.
 */
export function userToggleSource(
  state: ModalSelectionState,
  connId: string
): ModalSelectionState {
  const next = new Set(state.selectedConnIds);
  if (next.has(connId)) {
    next.delete(connId);
    const cp = { ...state.metaAcctPick };
    delete cp[connId];
    return {
      ...state,
      selectedConnIds: next,
      metaAcctPick: cp,
      userModified: true,
    };
  } else {
    next.add(connId);
    return {
      ...state,
      selectedConnIds: next,
      userModified: true,
    };
  }
}

/**
 * Transition when user toggles a specific Meta sub-account checkbox.
 */
export function userToggleMetaAcct(
  state: ModalSelectionState,
  connId: string,
  acctId: string
): ModalSelectionState {
  const base = new Set(state.metaAcctPick[connId] ?? []);
  if (base.has(acctId)) base.delete(acctId);
  else base.add(acctId);
  return {
    ...state,
    metaAcctPick: { ...state.metaAcctPick, [connId]: base },
    userModified: true,
  };
}

/**
 * Transition when user clicks "Select all" or "Deselect all".
 */
export function userSetAllSources(
  state: ModalSelectionState,
  connectionIds: string[]
): ModalSelectionState {
  return {
    ...state,
    selectedConnIds: new Set(connectionIds),
    userModified: true,
  };
}

/**
 * Pure check whether a targeted ad account is still resolving asynchronously.
 */
export function isTargetAccountResolving({
  initialAccountId,
  connections,
  metaAccountsByConn,
  selectionState,
}: {
  initialAccountId?: string | null;
  connections: ConnectionItem[];
  metaAccountsByConn: Record<string, { id: string; name: string }[]>;
  selectionState: ModalSelectionState;
}): boolean {
  if (!initialAccountId) return false;
  if (selectionState.accountNotFoundNotice) return false;
  if (Object.keys(selectionState.metaAcctPick).length > 0) return false;
  return connections.some(
    (c) => c.provider === "meta_ads" && !Array.isArray(metaAccountsByConn[c.id])
  );
}

/**
 * Constructs the batch import items array sent to the refresh API.
 * Fails closed if a targeted initialAccountId was requested but could not be resolved.
 */
export function buildBatchImportItems({
  selectedConnIds,
  connections,
  metaAcctPick,
  metaAccountsByConn,
  initialAccountId,
}: {
  selectedConnIds: Set<string>;
  connections: ConnectionItem[];
  metaAcctPick: Record<string, Set<string>>;
  metaAccountsByConn: Record<string, { id: string; name: string }[]>;
  initialAccountId?: string | null;
}): { items: { connectionId: string; adAccountId?: string }[]; error?: string } {
  const items: { connectionId: string; adAccountId?: string }[] = [];

  for (const cid of selectedConnIds) {
    const c = connections.find((x) => x.id === cid);
    if (!c) continue;

    if (c.provider !== "meta_ads") {
      items.push({ connectionId: cid });
      continue;
    }

    const picks = metaAcctPick[cid];
    const loaded = metaAccountsByConn[cid] ?? [];

    if (initialAccountId && (!loaded.length || picks == null || picks.size === 0)) {
      return {
        items: [],
        error: "Target ad account could not be resolved. Please select an ad account manually.",
      };
    }

    if (!loaded.length || picks == null || picks.size === 0) {
      items.push({ connectionId: cid });
      continue;
    }

    const wantAll = picks.size === loaded.length && loaded.every((a) => picks.has(a.id));
    if (wantAll) {
      items.push({ connectionId: cid });
    } else {
      for (const id of picks) {
        items.push({ connectionId: cid, adAccountId: id });
      }
    }
  }

  return { items };
}

// ---------------------------------------------------------------------------
// 3. Terminal Job Status & Heading Classification
// ---------------------------------------------------------------------------

export type TerminalJobStatus = "completed" | "partial" | "failed";
export type UiStep = "config" | "polling" | "success" | "partial" | "error";

/**
 * Map a terminal job status string to the UI step that should be rendered.
 */
export function terminalStatusToUiStep(status: string): UiStep {
  switch (status) {
    case "completed":
      return "success";
    case "partial":
      return "partial";
    case "failed":
      return "error";
    default:
      return "error";
  }
}

/**
 * Determine whether a completed job allows viewing imported data.
 * Partial jobs allow viewing only when approximateRows > 0.
 */
export function canViewImportedData(
  status: string,
  approximateRows: number | null | undefined
): boolean {
  if (status === "completed") return true;
  if (status === "partial") return (approximateRows ?? 0) > 0;
  return false;
}

/**
 * Return the canonical UI heading text for a terminal step.
 */
export function terminalHeading(step: UiStep): string {
  switch (step) {
    case "success":
      return "Warehouse refresh complete";
    case "partial":
      return "Warehouse refresh completed with warnings";
    case "error":
      return "Refresh failed to start";
    default:
      return "Warehouse refresh complete";
  }
}
