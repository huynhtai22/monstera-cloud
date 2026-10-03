# Controlled Extended-Backfill Pilot

Operator-controlled qualification layer for Meta/Google historical backfills
beyond the 30-day generic execution ceiling. The checkpointed worker
foundation is already deployed; this layer adds eligibility, activation,
quota, pause/resume/cancel, preflight, telemetry, and synthetic
qualification.

```text
This change does not enable customer-facing 24-month execution.
```

Public `/import` and `/import-batch` routes keep rejecting raw Meta/Google
ranges over 30 days. No UI offers 24 months. Extended execution stays
disabled by default and cannot be enabled by any request parameter.

## 1. Provider evidence (retrieved 2026-09-17)

### Google Ads — pilot eligible to 731 daily-grain days

- [Google Ads API — Zero metrics](https://developers.google.com/google-ads/api/docs/reporting/zero-metrics):
  granular (daily/weekly/hourly) retention is 37 months; granular requests
  beyond it return a date-range error. Confidence: high.
- [Google Ads Data Retention Policy](https://support.google.com/google-ads/answer/15188209?hl=en)
  (effective 2026-06-01): hourly/daily/weekly reporting retained 37 months;
  monthly+ retained 11 years. Confidence: high.
- Caveats: reach/frequency metrics are limited to 3 years (still above
  731 days); future API versions may rename the beyond-ceiling error. 731
  daily-grain days sit comfortably inside the 37-month ceiling.
- Authorizes: 731-day planning, synthetic execution, and gated staging
  execution. Eventual production execution requires staged qualification
  first; nothing here activates it.

### Meta Ads — synthetic planning only

- [Ad Account Ads reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/ads)
  (also [Ad Campaign Group Ads](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/ads)):
  official error **3018 — “The start date of the time range cannot be beyond
  37 months from the current date.”** Confidence: medium-high for a start-date
  ceiling on the ads endpoints.
- Caveats: the ceiling constrains the range *start*, not an end-to-end
  daily-history guarantee; [Limits and Best Practices](https://developers.facebook.com/docs/marketing-api/insights/best-practices)
  warns that large time ranges throttle/time out and should be broken down
  (which 30-day chunking does); unique metrics are expensive; no documented
  daily-history floor was found. No blog, forum, or remembered limit was
  used, and nothing about Google was inferred onto Meta.
- Authorizes: 731-day planning and synthetic execution only. Staging and live
  Meta execution are ineligible pending throughput evidence. Two-year Meta
  support is not advertised anywhere.

### Other connectors — independent, unchanged

TikTok keeps its provider-specific maximum/chunk policy; Shopee Orders keeps
its order-history policy; Shopee Ads keeps its provider ceiling (never two
years); Lazada keeps its bounded/unverified policy; Amazon SP and Shopify
remain unavailable for Warehouse ingestion; unknown providers fail closed.

## 2. Activation: three server-side keys

Extended execution requires ALL of the following; request input controls
none of them:

1. **Platform OPERATOR session** — `prisma.user.platformRole === "OPERATOR"`.
   Workspace owner/admin/member roles alone are rejected (403).
2. **Trusted server configuration** — `EXTENDED_BACKFILL_STAGE` plus numeric
   quotas from process environment (default stage `disabled`; malformed
   values throw before any work).
3. **Workspace allowlist membership** — `EXTENDED_BACKFILL_ALLOWED_WORKSPACE_IDS`
   (server env only; never returned to clients or written to logs).

Execution additionally requires provider eligibility, quota headroom, and an
accepted capacity preflight, evaluated by the single canonical
`decideExtendedBackfill` function used by every pilot entry point.

## 3. Pilot job identity and lifecycle

- Pilot jobs carry idempotency prefix `xbpilot:<stage>:<hash>` (stage-bound;
  synthetic jobs can never live-execute). Generic schedulers exclude them
  (`claimNextImportJob({ excludePilotJobs: true })`; `runDurableImportWorker`
  refuses them).
- Parent states add `paused`, `pause_requested`, `cancelled`,
  `partial_cancelled`; chunks add `cancelled`. `failed` is never overloaded.
- Pause drains in-flight leases, then settles to `paused`; resume re-gates
  policy/allowlist/capacity without resetting progress or attempts; cancel
  transitions queued chunks immediately while running leases finish fenced.
- Pilot execution is operator-invoked and resumable (bounded chunks per
  invocation); normal bounded imports keep priority by design (no shared
  scheduler contention).

## 4. Capacity model

The estimator is conservative and honest: unknown inputs yield `unknown`
(which fails closed for live execution), storage math uses an explicit
per-row constant the owner must calibrate, and every estimate lists its
assumptions. Local benchmark (disposable PG16, 100 jobs / 10,000 chunks /
3,000 metrics): claim, aggregation, recovery, polling, listing, and budget
queries are index-served; the provider-budget aggregation earned a dedicated
`(workspaceId, provider, completedAt)` index after EXPLAIN showed a
sequential scan at 10k rows (0.089 ms index-only after). Timings are
local-only, not production facts.

## 5. Sanitized owner inputs still required

Database storage limit and current usage; compute/autoscaling tier;
connection-pool limit; Vercel function duration and concurrency; Redis
memory/request limits; Google Ads developer-token tier; Meta app/account
reporting tier or applicable limitations; calibrated bytes-per-row and
rows-per-day for pilot accounts.

## 6. Known limitations

- No public extended-history enqueueing or 24-month UI action.
- `SyncCheckpoint` is not reused; checkpoint state belongs to the chunk.
- The pilot executor reuses the existing provider processing path.
- Failed-account retargeting inside a partial slice relies on overlapping
  catchup windows; the slice itself is never re-contacted once completed.
- A pause/cancel racing the final lease-fenced completion resolves
  last-writer-wins within microseconds; both outcomes are terminal and the
  operator audit trail records the cancel request. Pause/cancel transitions
  themselves retry against concurrent worker claims, so operator intent
  converges instead of silently dropping; every outcome (applied or
  idempotent no-op) is audited. A claimed slice is re-verified against parent
  state before execution and released unexecuted on mismatch, bounding any
  post-pause contact to in-flight slices plus a sub-millisecond window — bulk
  post-pause work is impossible. Attempt-based provider-call budgets count
  every claim (including failed attempts), and concurrency caps are enforced
  atomically with claiming under tenant-scoped advisory locks.
- Synthetic qualification does not prove live-provider eligibility.
- Production Neon/Vercel capacity has not been measured.
