# Architecture hardening: staged rollout

## Implemented scope

- Shared warehouse execution lives in `src/lib/warehouse-import-worker.ts`;
  scripts and callers no longer import an HTTP route to execute jobs.
- `WAREHOUSE_EXECUTION_MODE=worker` makes batch/manual/OAuth dispatch enqueue
  without Next `after` execution, and scheduled refresh enqueue durable jobs.
  The queue cron leaves claims/recovery to the standalone worker in this mode.
- The standalone worker uses audited application system scope and drains its
  current job on SIGTERM/SIGINT. PostgreSQL jobs, leases and checkpoints remain
  authoritative. Forced termination uses existing expired-lease recovery.
- Delivery monitoring compares canonical scoped dataset fingerprints and
  receipt evidence inside one RepeatableRead transaction. Old receipts and
  changed datasets both require attention. Exceeding the verification budget
  or a database failure is unavailable, never healthy.
- Staged RLS rejects a tenant role forging the system-scope GUC. The local
  rehearsal also verifies transaction-local context does not survive commit.

## Activation gates — not yet production certification

1. Keep `WAREHOUSE_EXECUTION_MODE=serverless` until a persistent worker host is
   approved and running against the same database. This change does not buy or
   provision infrastructure. A worker-mode app without a worker leaves jobs queued.
2. Validate Google on a non-production fixture: enqueue, kill after checkpoint,
   recover expired lease, verify no duplicate publication and correct status.
   Existing Meta/TikTok executors are reused, not replaced or newly certified.
   Do not declare their rollout gate passed from Google results.
3. Operator-only extended historical backfills deliberately retain their
   existing explicit execution route; generic workers never claim pilot jobs.
4. RLS remains staged, not an automatic migration. Policies now cover nullable
   workspace tables and child-only relations, with restricted-role tests.
   Complete the remaining runtime transaction integrations and separate
   identity/system credentials before enabling it globally. See the detailed
   database RLS rollout checklist for remaining paths.
5. Delivery state is current at its RepeatableRead snapshot, not a guarantee
   against later ingestion. Refresh after ingestion/delivery to see new evidence.

No production data, provider credentials, deployment or migration activation
is required for these local checks.

## Local verification

- Node 22.23.2; PostgreSQL 16 in a disposable local Docker container.
- All 32 existing migrations applied successfully to an empty database.
- 58 focused PostgreSQL tests passed with zero skips: operations isolation and
  corrected-dataset receipt invalidation, import-job fencing/concurrency,
  checkpoint recovery, Meta date-range regression, tenant isolation.
- RLS rehearsal: tenant read=1, unscoped read=0, forged system flag=0,
  post-commit context=0, authorized system read=2; cross-tenant insert rejected.
- Worker tests include rejection of a stale initial lease before any provider
  invocation and authenticated worker-mode cron without database execution.
- 125 focused unit tests passed, with zero skips. Typecheck and the production
  build passed. Lint passed with zero errors (68 existing warnings).
- The standalone worker started against the empty disposable database and
  exited cleanly on SIGTERM; no provider request was made.
- No new schema migration, runtime host, provider certification or production
  RLS activation is included in this change.
