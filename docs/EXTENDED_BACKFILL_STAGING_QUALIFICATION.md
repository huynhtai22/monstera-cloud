# Extended-Backfill Staging Qualification

Readiness package for the operator-controlled extended-backfill pilot. This
document produces evidence and a release recommendation. It does not activate
anything: extended execution remains disabled by default, and no customer
action can enable it.

- Deployed baseline: `bdfd6fc7d67aa2fc9ea1695acf1b788dab93f872`
  (production `/api/version` verified).
- Qualification branch (unmerged): pilot controls + this package.

## 1. Provider evidence

### Google Ads — qualifies for staged 731-day execution

- [Zero metrics](https://developers.google.com/google-ads/api/docs/reporting/zero-metrics):
  daily/weekly/hourly grain retained 37 months; older granular requests
  return a date-range error. Retrieved 2026-09-17; confidence high.
- [Retention policy](https://support.google.com/google-ads/answer/15188209?hl=en):
  sub-month grain retained 37 months from 2026-06-01; monthly+ retained
  11 years. Retrieved 2026-09-17; confidence high.
- 731 daily-grain days sit inside the 37-month ceiling. Caveats: reach/
  frequency metrics limited to 3 years (still above 731 days); future API
  versions may rename the beyond-ceiling error.

### Meta Ads — synthetic planning only

- [Ad Account Ads reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/ads):
  official error 3018 caps the Insights range *start* at 37 months.
  Retrieved 2026-09-17; confidence medium-high for the ceiling, with
  documented throttling/timeout caveats on large ranges and no verified
  end-to-end daily-history guarantee.
- Authorizes planning + synthetic execution only. Live/staging Meta
  execution is ineligible. No two-year Meta support is advertised.

## 2. Infrastructure facts

| Capacity dimension               | Known value | Source | Confidence | Missing owner input |
| -------------------------------- | ----------: | ------ | ---------- | ------------------- |
| PostgreSQL storage limit         | UNKNOWN | — | unknown | Provisioned storage (Neon project/settings) |
| Current DB storage used          | UNKNOWN | — | unknown | Current usage snapshot |
| PostgreSQL compute/vCPU          | UNKNOWN | — | unknown | Compute size |
| Autoscaling maximum              | UNKNOWN | — | unknown | Autoscaling range |
| Connection-pool limit            | UNKNOWN | — | unknown | Pool limit (PgBouncer/Neon) |
| Statement timeout                | UNKNOWN | none configured in repo | unknown | Statement timeout policy |
| Vercel plan                      | UNKNOWN | — | unknown | Plan tier |
| Function max duration            | UNKNOWN | hobby cron daily + GH Actions 15 min cadence observed | unknown | Max duration + concurrency |
| Function concurrency             | UNKNOWN | — | unknown | Concurrency limit |
| Cron frequency                   | daily Vercel master; 15-min GH Actions pilot-cron | vercel.json, pilot-cron.yml | repo-config | — |
| Redis memory limit               | UNKNOWN | KV_URL/KV_REST_API env names only | unknown | Memory + request limits |
| Redis request-size limit         | UNKNOWN | — | unknown | Request-size limit |
| Google Ads token tier            | UNKNOWN | — | unknown | Developer-token tier + daily quota |
| Google Ads daily operation quota | UNKNOWN | — | unknown | Daily quota |
| Meta app/reporting eligibility   | synthetic-only | §1 evidence | official-docs | Throughput proof for any live test |

No paid tier was inferred from code. No secret value was read or printed;
only variable names appear in code references. Unknown critical capacity
blocks staging execution admission until the owner supplies sanitized values.

## 3. Capacity scenarios (estimates, measured constants)

Row width measured on disposable PostgreSQL 16: avg `pg_column_size` 272–289
bytes/row; index/heap ratio 0.92–0.96 (many CampaignMetric indexes).
Scenario math uses 272 bytes/row + 0.95 index share, labeled below. Local
synthetic rows are narrow; production rows run wider (conservative
direction varies by column — see assumptions in code).

| Scenario | Rows | Daily / monthly growth | Table | Index | Total | Provision (÷0.6) | Provider calls (total) |
| -------- | ---: | ---------------------: | ----: | ----: | ----: | ---------------: | ---------------------: |
| Pilot: 5 ws × 3 conn × 20 ent × 731d | 219,300 | 300 / 9,000 | 59.6 MB | 56.7 MB | 116.3 MB | 193.9 MB | 375 |
| Growth: 50 × 5 × 50 × 731d | 9,137,500 | 12,500 / 375,000 | 2.49 GB | 2.36 GB | 4.85 GB | 8.08 GB | 6,250 |
| High: 200 × 8 × 100 × 731d | 116,960,000 | 160,000 / 4,800,000 | 31.81 GB | 30.22 GB | 62.04 GB | 103.39 GB | 40,000 |

Per-connection 731-day job: 25 chunks, ~0.8–3.3 min of local synthetic
slice time (live provider latency strictly larger and unmeasured).
Extrapolations are estimates with stated uncertainty, not predictions.

## 4. Local benchmark results (disposable PG16, 790,600 seeded rows)

Serving latencies (11 samples, p50/p95):

| Query | p50 | p95 | Rows touched | Gate |
| ----- | --: | --: | -----------: | ---- |
| 30-day filtered | 8.1 ms | 15.7 ms | 3,000 | pass (≤1500) |
| 365-day provider | 57.2 ms | 82.3 ms | 36,500 | pass |
| 731-day provider | 180.1 ms | 198.4 ms | 73,100 | pass |
| 731-day cross-provider aggregate | ~210 ms | ~220 ms | 2 groups | pass with justified full-scan exception |
| Account-filtered aggregate | 193.4 ms | 196.7 ms | 1 group | pass |
| 731-day interactive page (1000 rows, real serialization) | 480.7 ms | 491.6 ms | 1,000 | pass |
| Distinct platforms | ~42 ms | ~48 ms | 2 | pass with justified full-scan exception |
| Count/pagination (100) | 2.8 ms | 7.5 ms | 100 | pass |
| Job progress polling | 0.6 ms | 2.0 ms | — | pass (≤500) |

Count/group shapes understate full-row serialization cost; the interactive
page row above exercises the production query path end-to-end. Its companion
SELECTs (count, min/max/distinct aggregates over the same range) carry their
own measured plans in the suite; the remaining metadata lookups
(single-workspace connection aggregate, latest sync-job fetch) are bounded
small-table reads. Every selective shape has its measured
`EXPLAIN` asserted index-served in the qualification suite; the three
full-range rollups (cross-provider grouping, range-endpoint extrema,
distinct platforms) carry
explicit justified full-scan exceptions in their verdicts instead, since
they must visit every in-range row without a precomputed structure. The
sequential-scan flags fed to all gate verdicts come from those measured
plans, never hardcoded values. One measurement cycle exposed a genuine gap: the
default platform-less explorer view (`workspaceId` + date range +
`ORDER BY date DESC LIMIT n`) had no leading index and seq-scanned at 790k
rows (60 ms / ~58k buffers, observed pre-index failure output on the same
fixture). It earned the narrow two-column `CampaignMetric(workspaceId, date)`
index added in this package (migration
`20260917100744_campaign_metric_workspace_date_lookup`, 2.8/7.5 ms after).
New migrations here are additive DDL only — no existing rows are rewritten
or deleted — and plain `CREATE INDEX` matches repository migration
convention (Prisma runs migrations transactionally, where `CONCURRENTLY` is
unavailable); the pilot-stage tables involved are small, so the build lock
window is milliseconds. High-scale serving
(117M rows) is projected by the scenario model, measured at 790,600 rows;
precomputed rollups remain the documented answer past measured scale.

## 5. Proposed acceptance gates (require owner acceptance)

- Storage: projected post-backfill usage below 60% of provisioned.
- Interactive filtered queries p95 ≤ 1,500 ms; progress polling p95 ≤ 500 ms.
- No unexpected sequential scans at representative scale.
- No unbounded serialization (HARD_LIMIT 100,000 + explicit pagination).
- Worker invariants: zero duplicate completed chunks, zero stale
  publication, zero cross-tenant claims, deterministic pause/resume/cancel,
  crash resume without repeats, bounded retries, truthful parents,
  attempt-counted budgets.
- Google token tier known before live 731-day qualification.
- Meta synthetic-only unless separately cleared.

## 6. Google staging test procedure (requires explicit authorization)

1. Confirm stage is `staging` (never `production_pilot`).
2. Confirm only the designated test workspace is allowlisted.
3. Confirm actor is platform OPERATOR.
4. Confirm capacity decision is `accept`.
5. Start with 90 days, then 365, then 731 only after reviewing 365-day results.
6. Newest-first ≤30-day slices; monitor every chunk.
7. Exercise pause and resume; exercise cancel on a separate disposable job.
8. Verify restart recovery, zero duplicate rows, sampled provider totals.
9. Record calls, rows, duration, retries, failures, storage growth, latency.

Stop conditions: cross-tenant visibility; duplicate completed chunks;
stale-worker publication; lease loss with continued provider contact;
budget overrun; storage/latency/plan regressions; secrets in logs;
provider/account mismatch; wrong workspace/account; any >30-day request.

## 7. Meta synthetic-only statement

Meta extended backfills remain synthetic-only. No live Meta staging test is
authorized by this package, regardless of stage configuration.

## 8. Serving boundaries (blockers for customer-facing two-year support)

- `/api/export/rows` returns at most 10,000 rows per connection with **no
  pagination or truncation signal** — a 731-day account (~36k rows) would be
  silently truncated. Classified as a blocker; recommend async export jobs
  instead of broadening limits.
- `/api/metrics/query` is bounded per plan with explicit `hasMore` and
  date-range caps — truthful; keep the pattern.
- Warehouse query lib caps at HARD_LIMIT 100,000 with pagination — truthful.
- The refresh modal renders bounded connection/account/job-result lists —
  no unbounded raw-row rendering found.
- Recommendation: aggregated interactive views with bounded pagination now;
  async export jobs for two-year support; precomputed rollups or an OLAP
  store only when documented thresholds are crossed.

## 9. Rollback and stop conditions

- Pilot jobs pause/cancel without touching completed metrics; terminal
  states are explicit; migrations in this package are additive DDL only
  (one composite index per migration, no row rewrites or deletes).
- Stop on any §6 condition, any new P1/P2 finding, or any missing owner input.
- Incident contacts: workspace owner via product support channel; platform
  operator rota (placeholders — no personal secrets recorded here).

## 10. Final recommendation

Staging qualification is **prepared but blocked on owner inputs**: provisioned
storage/usage, compute/autoscaling, pool limits, Vercel duration/concurrency,
Redis limits, Google token tier/quota, exact test workspace/connection/
account identities, ownership confirmation, max authorized range, explicit
live-call authorization, and non-production confirmation. Until supplied, the
verdict is: prepared, awaiting inputs — production activation remains
disabled and no live test is authorized.
