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

### Warehouse

- On a cold query, confirm that descriptive loading copy and table-shaped
  placeholders render instead of a spinner-only state.
- Force a query error and use **Try again**; ensure the current filters remain
  selected and no refresh/import is started by the retry.
- Choose a platform or account with no rows. The empty state must identify that
  it is the current view, offer a reset, and not imply that data was deleted.
- Confirm Export appears once, beside the table it exports, and stays disabled
  when no matching rows are available.

## Acceptance criteria

- No primary console page has an unexplained blank, spinner-only, or ambiguous
  empty state.
- Loading, error, and empty states retain the user’s context and state the
  safest next action.
- Motion is non-essential and respects `prefers-reduced-motion`.
