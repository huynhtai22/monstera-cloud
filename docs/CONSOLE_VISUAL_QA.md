# Console visual QA

## Purpose

This checklist defines the acceptance bar for the console polish: make the
product feel composed while data or session state is still resolving, rather
than leaving people to infer whether anything is happening.

## Release checks

### App-shell loading

- Throttle the first authenticated page load and confirm the loader appears
  immediately, with no blank canvas or layout jump.
- Confirm its network panel has no map, D3, TopoJSON, or other third-party
  loader dependency.
- With reduced motion enabled in the operating system, confirm the loader is
  static and still clearly communicates that the secure session is loading.

### Dashboard

- On a cold dashboard request, confirm the skeleton preserves the final
  dashboard hierarchy: heading, summary cards, and the primary content split.
- Confirm the loading announcement is available to screen readers and that
  keyboard focus does not move unexpectedly.
- Force a summary-request error and confirm the retry state says that source
  and warehouse data are safe.
- Confirm the header identifies the active workspace, source/account scope,
  warehouse state, data-through date, and last successful sync when available.
- Confirm source readiness distinguishes **Healthy**, **Connected — not
  synced**, **Stale**, **Syncing**, and **Needs attention**.
- Confirm a never-imported workspace says **Not synced** rather than showing a
  dash or implying that the warehouse is empty because data was deleted.

### Warehouse

- On a cold query, confirm that descriptive loading copy and table-shaped
  placeholders render instead of a spinner-only state.
- Force a query error and use **Try again**; ensure the current filters remain
  selected and no refresh/import is started by the retry.
- Choose a platform or account with no rows. The empty state must identify that
  it is the current view, offer a reset, and not imply that data was deleted.
- Confirm Export appears once, beside the table it exports, and stays disabled
  when no matching rows are available.

### Sources

- Confirm the header identifies the active workspace, connection count, and
  whether a successful sync has ever been recorded.
- Confirm a newly authorized source reads **Connected — not synced**, not just
  Connected; its action must be **Run first sync**.
- Confirm a partial result reads **Partial sync**, explains that only some data
  was imported, and offers **Retry sync**.
- Confirm a disconnected or invalid authorization reads **Needs attention** and
  offers **Reconnect**; its explanation must state that existing warehouse
  history is retained.
- Complete a direct or pipeline sync and confirm an in-page outcome remains
  visible until dismissed, with a safe link to Warehouse or Sync activity.
- Exercise a partial, blocked, cooldown, and failed sync response. Each must
  explain whether data was written or retained, never display raw response
  payloads, and never suggest forcing an active lease from the console.
- Disconnect a source and confirm the persistent confirmation says that syncs
  stopped while Warehouse history was retained. If the request fails, confirm
  the persistent error says neither the connection nor Warehouse data changed.
- Reconnect an expired source and confirm the final state says authorization is
  ready and that the user must run a sync when they want refreshed Warehouse
  data; do not imply that a sync began automatically.

## Acceptance criteria

- No primary console page has an unexplained blank, spinner-only, or ambiguous
  empty state.
- Loading, error, and empty states retain the user’s context and state the
  safest next action.
- Motion is non-essential and respects `prefers-reduced-motion`.
