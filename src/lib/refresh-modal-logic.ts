/**
 * Pure logic helpers for RefreshWarehouseModal, extracted for testability.
 *
 * Covers two P2 findings from PR #172 review:
 *   A) Modal reopens must reinitialize selection from current context, not stale state.
 *   B) Partial terminal jobs must not be surfaced as full successes.
 */

// ---------------------------------------------------------------------------
// P2-A: Open-session initialization key & selection state machine
// ---------------------------------------------------------------------------

export interface SessionContextKey {
  workspaceId: string | null;
  platform: string | null;
  accountId: string | null;
}

/**
 * Derive a stable string key that identifies a unique open-session context.
 * When any of these values changes between modal opens, the initialization
 * must be re-run from scratch rather than reusing the previous selection.
 *
 * Format: `<workspaceId>|<platform>|<accountId>`
 * Missing values are normalized to the empty string.
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
 *
 * Returns true when:
 *   - No previous initialization has occurred (previousKey is null), OR
 *   - The current context key differs from the previously initialized key.
 *
 * Returns false when the key is the same — preserving manual changes made
 * during the current open session.
 */
export function needsReinit(
  currentKey: string,
  previousKey: string | null
): boolean {
  return previousKey === null || previousKey !== currentKey;
}

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
  // If modal is closed, reset state completely for next session
  if (!isOpen) {
    return createInitialModalSelectionState();
  }

  const currentSessionKey = deriveSessionKey({
    workspaceId,
    platform: initialPlatform ?? null,
    accountId: initialAccountId ?? null,
  });

  // If already initialized for this exact session context or user manually modified,
  // do not overwrite manual changes
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
    // No matching connections for this platform
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

// ---------------------------------------------------------------------------
// P2-B: Terminal job status classification
// ---------------------------------------------------------------------------

export type TerminalJobStatus = "completed" | "partial" | "failed";
export type UiStep = "config" | "polling" | "success" | "partial" | "error";

/**
 * Map a terminal job status string to the UI step that should be rendered.
 *
 *   completed → "success"  (full success, all items imported)
 *   partial   → "partial"  (some items succeeded, others failed)
 *   failed    → "error"    (all items failed or job could not run)
 *   anything else → "error" (conservative fallback for unknown states)
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
 * Partial jobs may have some rows — allow viewing when approximateRows > 0.
 * Failed jobs have no imported data to view.
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
 * Return the UI heading text for a terminal step.
 * Partial must never return the same string as completed.
 */
export function terminalHeading(step: UiStep): string {
  switch (step) {
    case "success":
      return "Warehouse refresh complete";
    case "partial":
      return "Warehouse refresh completed with warnings";
    case "error":
      return "Refresh failed";
    default:
      return "Warehouse refresh complete";
  }
}
