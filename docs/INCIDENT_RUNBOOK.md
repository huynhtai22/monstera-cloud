# Incident runbook

Operator procedures for the failure modes this system is designed to produce loudly. Each runbook states the symptom, the confirmation step, where to look, and the fix. Pause-and-expand rules live in [PILOT_OPERATIONS.md](./PILOT_OPERATIONS.md).

Owner of record: repository owner (`huynhtai22`). Escalation before GA: pause pilot expansion, then fix or roll back per the release sequence.

Log conventions used below:

- Rate-limit events are single-line JSON with `"scope":"ratelimit"` and a `failureCategory` field (`src/lib/request-rate-limit-policy.ts`).
- Sync lease warnings are `[SYNC_LEASE]` / `[SYNC_STATE]` prefixed lines.
- Tenant-guard rejections raise `TenantScopeError` with code `TENANT_SCOPE_REQUIRED`.

---

## Runbook 1 — Sheets/Looker returns 503 (`limiter_unavailable`)

**Symptom:** Live Sheets add-on or Looker Studio requests return HTTP 503 instead of 401/200. The 503 body/code is `limiter_unavailable`, meaning the request was rejected because the external rate limiter (Upstash Redis) could not be reached — auth was never evaluated.

**Confirm:**

```bash
curl -s -o - -w "\n%{http_code}\n" "https://monsteracloud.com/api/looker-studio"
```

`401` (or `405`) = healthy, stop here. `503` = proceed.

**Where to look:** Vercel runtime logs for the failing deployment, filter on `"scope":"ratelimit"`. Each event carries `routeClass`, `limiterTier`, `runtimeUrlPresent`, `runtimeTokenPresent`, and `failureCategory`.

**Decision table by `failureCategory`:**

| Category | Meaning | Fix |
|---|---|---|
| `missing_runtime_env` | `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` absent at runtime | Check Vercel env vars exist with **Production** scope (names/scopes only — never paste values); redeploy after saving so a new deployment picks them up |
| `timeout` | Env present but Upstash did not answer inside the limiter timeout | Check Upstash status/plan limits and Vercel-region egress; if Upstash is down this is expected behavior (fail-closed) — communicate, do not disable the limiter |
| `network` | Connection-level failure to Upstash | Same as `timeout`; verify no network/Vercel-blocklist change |
| `http_401` / `http_403` | Token rejected by Upstash | The stored token is wrong or rotated — replace both variables together from the Upstash console and redeploy |
| `http_429` | Upstash plan rate limit hit | Upgrade plan or reduce limiter tiers; requests are being refused by Upstash itself |
| `http_5xx` | Upstash server-side error | Transient unless persistent; check Upstash status page |

**Reminders:**

- Environment variable values must be saved as a matching pair (URL + token from the same Upstash instance). A mixed pair typically presents as `http_401`.
- Redeployment is required after any env change; existing deployments keep their old env.
- Do not widen CSP or bypass the limiter to "fix" an outage — the limiter failing closed is intentional.

**Verify after fix:** repeat the curl until `401`/`200` replaces `503`, then run one authenticated Sheets/Looker request end-to-end.

---

## Runbook 2 — `[SYNC_LEASE]` / `[SYNC_STATE]` warnings in logs

These lines mean a worker generation lost its connection lease and was **stopped before writing**. They are the fence working, not data corruption.

| Log line | Source | Meaning |
|---|---|---|
| `[SYNC_LEASE] Stale worker detected for scope=…` | `assertConnectionSyncLease` | Worker tried to write outcome/state after its lease expired or was stolen — blocked |
| `[SYNC_LEASE] Lease lost … Aborting current phase.` | `heartbeatConnectionSyncLease` | Ingestion or marketplace pagination self-aborted mid-loop |
| `[SYNC_STATE] Stale worker skipping outcome write…` | pipeline-run outcome writes | An old pipeline generation could not clobber the current owner's `lastSyncAt`/`lastError`/`status` |
| `[SYNC_LEASE] Stale worker refusing to persist … outcome` | outcome persistence | Same refusal at sync-outcome level |
| `[SYNC_LEASE] Release failed … (expiry will recover)` | lease release | Benign: advisory lock busy during cleanup; the row expires anyway |
| `[AD_INGEST] Lease lost during ingestion; aborting remaining rows` | ad-platform ingest loop | Row batch aborted; rows reported as failed, owner's data untouched |

**Normal vs problem:**

- Occasional, spread across scopes: healthy contention (cron overlapped a manual sync). No action.
- Repeated for the same `scope=` over many minutes: a sync routinely outlives the 20-minute lease. Investigate that provider/connection's duration; candidate remedies are faster heartbeats or a longer lease duration (`LEASE_DURATION_MS` in `src/lib/connection-sync-lease.ts`), never removing the fence.
- Warnings immediately after a deploy spike: expected — old-generation workers from the previous deployment finish against new lease semantics.

**Data-integrity note:** a stale worker's writes were *rejected*, so there is nothing to repair. If a user reports missing rows from an affected window, simply re-run the sync for that connection/window once the contention clears.

---

## Runbook 3 — `TENANT_SCOPE_REQUIRED` errors (500s)

**Symptom:** API routes return 500 whose cause chain includes `TenantScopeError` / code `TENANT_SCOPE_REQUIRED`.

**Meaning:** A bulk query on a tenant-guarded model reached Prisma without a workspace filter and outside a `withSystemScope()` boundary. The guard failed closed; no cross-tenant data moved.

**Procedure:**

1. Capture the model + operation from the error message (`Model.operation requires workspaceId`).
2. Find the call site introduced or touched by the most recent deploy (`git log -- <path>` from the stack trace).
3. Fix narrowly: add an explicit `workspaceId` filter, or — only for legitimate fleet/cron/webhook paths — wrap the single query in `withSystemScope()`. Never wrap a whole workflow.
4. Add/extend a unit assertion in `src/lib/tenant-guard.test.ts` so the shape cannot regress silently.

Reference: guarded-model list and deferred models are documented in `src/lib/tenant-guard.ts`; enforcement rationale in PR #69.

---

## Quick reference — scheduled work and fail-closed behavior

| Path | Cadence | Fails how |
|---|---|---|
| `/api/cron/master` | Daily (Vercel Hobby) | Fan-out fetcher; downstream crons log failures |
| `/api/cron/warehouse-jobs`, `token-prefetch`, `shopee/refresh`, `health-tick` | ~15 min via GitHub Actions `pilot-cron.yml` | Requires `CRON_SECRET` match; non-200 marks the workflow failed |
| Sync workers | On demand / queued | Lease-fenced; see Runbook 2 |
| External limiters (Upstash) | Every API request | Fail-closed 503; see Runbook 1 |

After any incident: record timeline + root cause in the incident thread, and update this runbook if the procedure changed.
