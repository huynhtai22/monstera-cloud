# Console visual refresh — 2026-09-28

## Scope

Apply the approved neutral surfaces, restrained green work indicators, and scorecard hover sweep to the real console. The demo is a design reference, not a replacement implementation. No deployment is performed by this change.

The existing app shell owns workspace selection, client context, notifications, profile, theme switching, admin visibility, and navigation. `Sidebar.tsx`, `Logo.tsx`, integration artwork, authorization, API handlers, and database schemas are not changed.

## Functionality retained

| Surface | Existing controls retained |
| --- | --- |
| Sources | Connected/Client accounts/Catalog, Detailed/Lite, sorting, platform filters, identifier search, selection/bulk actions, rename, diagnostics, direct Sync/Retry/Reconnect, disconnect confirmation |
| Warehouse | Date presets and custom dates, client/platform/account filters, column presets and selection, sorting/resizing, data bars, platform breakdown, Shopee catalog, refresh wizard, export and report actions |
| Reports | Client selection, report requirements, timezone/currency verification, prerequisites, generation/approval/delivery flow, readiness evidence, performance filters, brief/export, sync logs |
| Operations | Health sections, freshness journey, actionable failures and refresh controls |
| Clients | Client/workspace portfolio, assignments, readiness, anomalies, report schedules and editing |
| Exports and Settings | Existing eligibility, setup links, keys, workspace/team/billing/session controls |

Implementation uses scoped theme tokens and additive presentation classes. Loading components consume the existing busy state; they do not trigger or time provider operations. Red/amber diagnostic states retain their meaning. Reduced-motion and forced-color alternatives are included.

## Validation boundary

Type checking, focused lint, and local browser checks exercise the actual page components with synthetic API responses. These checks cover UI rendering and selected interactions; they do not establish production feature parity for every role, successful provider authorization, numerical reconciliation, or live delivery. Existing backend and end-to-end release gates still apply before shipping.

Verified locally: Sources search and Detailed/Lite switching; the direct-sync busy transition; Warehouse column controls and sample metric rendering; client selection and report prerequisites; Exports, Clients, Settings and the Operations error state; sidebar collapse and theme switching; Sources/Warehouse/Reports at 390px and 320px; reduced-motion transitions. The final browser pass reported no uncaught page errors. Type checking, focused lint and whitespace checks passed.

## Launch assessment

The feature scope is sufficient to evaluate a focused agency reporting pilot. General-availability readiness is not established by this refresh or the current demo.

The latest [connector certification matrix](certification/summary-matrix.md), dated 2026-09-27, records Google Ads, Meta Ads, and TikTok Ads at `CODE_VERIFIED`, with no live-certified connector. The [operations acceptance gate](OPERATIONS_ACCEPTANCE.md) still records unassigned owners and unverified operational evidence. These are repository records, not a fresh audit of the deployed environment.

Before onboarding paying pilot users, certify the specific providers and destinations offered: authorize, import a bounded window, reconcile with native totals under the same semantics, verify authenticated destination retrieval, and prove recovery/idempotency. Complete the applicable operational acceptance gates. Before broader availability, also close the retention decision/drill and verify the commercial onboarding, billing and support journeys in the release environment.

Recommended next scope: a small, assisted agency pilot around one verified source-to-report-to-destination workflow. Freeze connector expansion until that loop is proven. Treat real customer usage and willingness to pay as market-fit evidence.

Elton Data positions itself as a broad data movement platform, with transformation, governance, scheduling and monitoring. Borrowing workflow ideas can improve usability; it does not replace reliability evidence. Monstera's existing roadmap supports a narrower agency-focused proposition: knowing whether client data is current, complete, and safe to report.

Sources reviewed: [Elton Data overview](https://eltondata.com/en), [Elton Data plans](https://eltondata.com/en/pricing), [Monstera product roadmap](PRODUCT_ROADMAP_2026.md).
