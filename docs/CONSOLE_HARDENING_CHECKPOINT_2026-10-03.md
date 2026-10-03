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

## Follow-up build — saved setup, handoff and worker admission

Prepared on the connector checkpoint branch, with no runtime feature/cohort changes:

- Reconciled PR #207 saved monitoring drafts and the functional handoff commit from #208 against current main. Retained current main's owner membership and provider-account validation. The later branding/navigation commits from #208 were already represented by the production-parity work and were not replayed.
- Reviewed onboarding snapshots its goal and account/date context. An explicit action can prepare one deduplicated, unapproved monitoring draft. Save/reload/edit retains selected accounts; stale edits, unavailable grants, missing data, incomplete imports and lost membership fail closed. OAuth, onboarding completion and saving never create monitoring authorization.
- Integrated the code/test credential-error fix from #212. TikTok token exchange and refresh failures expose only a safe numeric code and fixed guidance, not provider message/payload echoes. The historical C7 deployment document was not copied as a new current deployment claim. Advertiser-discovery/report error handling and historical log cleanup remain separate work.
- Generic warehouse admission keeps plan priority first, then chooses the workspace with the fewest unexpired running jobs, then due time. A short transaction serializes generic admissions; provider execution is outside it. Concurrent workers observe committed occupancy and retain row/lease guards. Pilot keys remain excluded, null keys remain eligible, expired leases do not count as active, and a sole busy workspace can still progress. Explicit UTC timestamp casts avoid dependence on database session timezone.
- This admission change helps multiple available worker slots. It does **not** preempt a running multi-account job, change serial cron execution into parallel execution, guarantee fairness across priorities or establish a production queue-age SLO. Item-level time slicing and measured deployed capacity remain open.
- Expanded the local 100,000-row benchmark: nonempty campaign/account grouping respected a 1,000-row limit and took 196/126 ms; five concurrent snapshots across two tenants completed together in 242 ms with correct scope/counts. Existing grouped implementations already use query limits; these measurements assess grouping cost, not an unbounded-result bug fix.

Validation: 12 real scheduler/lease tests; 55 onboarding/saved-draft/handoff/health journey tests (including the added foreign-owner rejection); 51 wider database regressions; 62 unit tests for TikTok, warehouse queries, jobs and retry receipts. All passed without skips/cancellations in the successful runs. Disposable PostgreSQL used the schema plus the existing `AgentCase_workspaceId_fingerprint_open_idx` migration-only constraint. Production build/TypeScript and touched-file lint passed. Synthetic browser checks passed for saved setup, optional handoff and the connector. No production credentials, grants, data or billing were modified.

Remaining order: responsibility/case inspection and delayed coverage; bounded worker execution/fairness measurement; real customer/provider/destination acceptance; separately reviewed Polar lifecycle/replay release and payment/payout evidence; then invited agent-console pilot activation. C6 and C7 live acceptance are not completed by this build.
