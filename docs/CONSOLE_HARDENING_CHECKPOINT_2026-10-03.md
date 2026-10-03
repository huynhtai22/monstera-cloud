# Console and reliability checkpoint — 2026-10-03

This checkpoint completes the connector consent refinement and reassesses existing reliability safeguards on current main. It does not certify provider access, production capacity, payments or a real customer reporting result.

## Completed in this change

- Shared production connector panel: official marks, a dashed bridge with one brand-green moving dot, visible reporting access, provider-specific benefits, Cancel/Continue, themed scrolling and dark/light support. Removed competing shimmer/progress animations and developer callback configuration from customer consent.
- Actual handoff status remains preparing/opening, never “connected” before OAuth returns. Preview performs no authorization or import. Keyboard focus moves into the dialog when the Continue button becomes inert; Escape and focus restoration remain usable.
- Dedicated preview: `/demo/ui/connect-source`. Desktop/mobile, dark/light, four providers, handoff, dismissal, focus restoration, reduced motion and no OAuth/import requests verified by `scripts/verify-connector-panel.mjs`.
- Reproducible local database measurement: `scripts/verify-warehouse-hardening.ts` requires an approved loopback disposable database and cleans its fixtures. It executes the real warehouse snapshot query, checks tenant output and cursor overlap, and records an execution plan.

## Existing safeguards reverified, not newly implemented

| Area | Evidence this session | Boundary |
| --- | --- | --- |
| Tenant isolation | Authorization/scoped reads, tenant guards and transaction-local tenant context; PostgreSQL integration checks pass | Production restricted-role/RLS deployment is not established by these checks; do not claim it enabled |
| Retries | Bounded retry counts, delayed requeue, account-specific retry receipts and provider retry delay; stale worker writes rejected after lease expiry | Real provider throttling and deployed worker cadence remain unmeasured |
| Duplicate prevention | Workspace-scoped job keys, atomic lease claims, connection fencing and database metric uniqueness/upsert checks | Does not certify every external destination write or payment webhook |
| Query performance | 100,000 synthetic metrics, two tenants; actual snapshot query with a 1,000-row page plus count/metadata | Local PostgreSQL, warm cache, one request at a time; not a production load test |

Focused database suites: 27 passed, zero failed/skipped (tenant isolation, tenant guard coverage, database context, warehouse leases and real scheduler/crash/upsert tests). Focused unit/simulation suites: 55 passed, zero failed/skipped (tenant guard, jobs, retry receipts, warehouse query, duplicate work, crashes, fairness and workload benchmark).

Measured snapshot durations: 172, 141, 142, 140, 138 and 148 ms. The date/id page query used `CampaignMetric_workspaceId_date_id_idx`; its SQL execution time was 0.672 ms. Returned 50,000 total rows for the selected tenant, 1,000 per page, zero foreign-tenant rows and zero overlap with the next page. The full snapshot includes metadata and count work, so the SQL page duration must not be advertised as endpoint latency.

## Unfinished agenda, in priority order

1. **Live first customer result:** execute the existing consent → approved accounts/dates → import → warehouse review → rendered destination reconciliation journey. Needs designated workspace/customer access. Keep synthetic evidence distinct.
2. **Paid release:** release/review Polar separately; fix and test stale activation after revocation before enabling charging; then verify signed webhook, correct workspace entitlement, duplicate/out-of-order delivery, cancellation/recovery and production payout. No billing code copied into this change.
3. **Agent console:** C4/minimum C5 foundations exist; pending monitoring/responsibility changes and C7 readiness must be reviewed against current main before integration. C6 is not accepted. Do not turn on autonomous remediation based on prepared code alone.
4. **Fair scheduling:** existing fairness tests document head-of-line blocking, rather than proving it eliminated. Measure heavy/small pilot queue age and validate bounded slices/tenant scheduling before expanding capacity. Passing fairness simulations is not a fairness guarantee.
5. **Production performance and quotas:** measure concurrent pilot requests, actual data sizes, query plans, DB pool pressure, queue age, provider call counts and quota headroom. Approval for external customers/markets still needs provider dashboard and real authorization evidence; Shopee remains VN-only.
6. **Broader queries:** grouped report queries can materialize many groups; assess their cardinality/memory at representative portfolio size separately from this raw-page benchmark.

Completion of this checkpoint supports a reviewed UI release and an assisted pilot. Global paid self-serve readiness remains unverified.
