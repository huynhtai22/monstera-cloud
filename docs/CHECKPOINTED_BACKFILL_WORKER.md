# Checkpointed Backfill Worker Foundation

Planning-only note: this phase builds durable chunk ownership, claiming, and
aggregation. It does **not** enable customer-facing 24-month execution. The
production safety boundary is unchanged: generic Meta/Google imports over 30
inclusive days return `REQUEST_CHUNKING_NOT_IMPLEMENTED`.

## 1. Which state is currently relational

- `WarehouseImportJob` (`prisma/schema.prisma`): parent row with workspace FK,
  `status`, `totalItems/completedItems/approximateRows`, job-level
  `leaseId/leaseExpiresAt/heartbeatAt`, `retryCount/maxRetries`,
  `(workspaceId, idempotencyKey)` unique, indexes on `(workspaceId, status)`,
  `(status, scheduledAt)`, `(status, leaseExpiresAt)`.
- `SyncLock` (account-level `SyncLock.scope`, `leaseId`, `fencingToken`,
  heartbeats) continues to fence provider writes; untouched by this phase.
- `CampaignMetric` `@@unique([connectionId, accountId, level, entityId, date,
  breakdownHash])` is the metric idempotency key; replay-safe upserts rely on it.

## 2. Which state is embedded in JSON

- `WarehouseImportJob.items` (`BatchImportItem[]`): connection/account targets
  with optional per-item `executionSince/executionUntil` (OAuth slices),
  `providerState` continuations, and display-range stamps on `items[0]`.
- `WarehouseImportJob.results` (`BatchImportJobResult[]`): per-target outcomes
  consumed directly by `RefreshWarehouseModal`.
- Consequence: a worker restart replays `items` from the beginning; per-slice
  completion is not persisted anywhere except the terminal parent row.

## 3. Which identifiers lack database foreign keys

- `items[].connectionId`, `results[].connectionId`: plain JSON strings, no FK.
- `SyncCheckpoint.pipelineId/jobId`, `SyncLock` scope members: plain strings.
- `WarehouseImportJob.userId`: plain string (workspace FK is the only FK).
- New `WarehouseBackfillChunk.connectionId` is intentionally scalar: Connection
  rows are workspace-scoped with composite uniques and reconnect/delete flows;
  a hard FK would couple chunk retention to connection lifecycle. Ownership is
  proven only for workspace (cascade) and parent job (cascade).

## 4. Where a worker can restart from the beginning

- `runDurableImportWorker` replays `jobRecord.items` on every claim/lease
  recovery; `retryPartialImportJob` narrows to retryable targets but still
  re-executes whole account scopes, not persisted date slices.
- Cron `warehouse-jobs` reclaims expired leases back to `queued`, replaying all
  items. Completed slices inside a multi-slice OAuth job are re-contacted.

## 5. Where duplicate provider calls or stale completions could occur

- Lease loss mid-`processBatchItems`: heartbeat failure sets `isLeaseLost` but
  an in-flight provider call can still complete and its rows persist while the
  job is later reclaimed and re-executed (row-level dedupe via the
  `CampaignMetric` unique key keeps facts correct, but provider calls repeat).
- `completeImportJob`/`failImportJob` are fenced by `(id, leaseId,
  leaseExpiresAt >= now)`; chunk-level outcomes had no equivalent fencing.

## 6. Which paths could bypass chunk execution

- `/import` (single) executes provider sync directly, no job row.
- `/import-batch` sync mode executes without a job row.
- Manual `/connections/[id]/sync` and cron `warehouse-refresh` call
  `syncConnectionData` directly with bounded windows.
- The checkpoint worker therefore only ever sees jobs created through the
  already-approved bounded paths (OAuth ≤90d slices, ≤30d singles); it creates
  no new public entry point and every public route keeps its raw-range guard.

## 7. Which fields the current UI expects in job `items` and `results`

`RefreshWarehouseModal` polls `GET /jobs/[id]` (`getImportJob`) and reads
`status`, `since/until`, `requestedRange/effectiveRange`, `clamped`,
`approximateRows` (fallback: sum of `results[].rowsIngested|upserted`),
`totalItems/completedItems`, `results[]` (`provider, accountId/adAccountId,
ok/outcome, error, rowsIngested/upserted`), and `errorMsg`. Partial renders as
warning. The relational worker keeps these JSON fields synchronized from chunk
states so the modal is unchanged.

## Decisions

- New model `WarehouseBackfillChunk` (not `SyncCheckpoint` reuse: checkpoint
  rows are pipeline-oriented with free-form cursors and no chunk ownership; a
  shared table would mix semantics and risk an unsafe migration).
- Resume cursor lives on the chunk (`status/attempts/persistedRows/lease/
  fencingToken/heartbeatAt`); no separate checkpoint table.
- Deterministic chunk IDs (`wchk_<sha256>`) plus
  `@@unique([jobId, connectionId, accountId, since, until])` make creation
  replay-safe inside the same parent-creation transaction.
- Claim = single-statement guarded `updateMany` (same proven strength as job
  claiming); fencing token increments per claim; completion/failure/heartbeat
  must match `(id, workspaceId, leaseId, fencingToken)`.
- Progress mirroring never writes parent `status`: the worker owns `running`
  from its claim and only the lease-fenced `completeImportJob` path (via
  `finalize`) writes terminal transitions. Re-runs never regress parents.
- No-claimable-chunk stops are non-terminal: chunks still running under
  another lease keep the parent out of `failed`; the route layer requeues the
  parent instead of reporting terminal results. Queued-but-exhausted chunks
  are failed explicitly so the loop always converges.
- Partial provider outcomes are preserved: committed rows complete the slice
  (successful accounts are never re-contacted) with a recorded partial error
  that keeps parent aggregation truthfully `partial`.
- Error sanitizer covers bare, `=`-assigned, and quoted JSON credential forms.
- Extended execution stays disabled: materialization refuses chunk-guarded
  totals beyond the approved 90-day automatic window and any per-slice span
  over 30 days; `EXTENDED_BACKFILL_EXECUTION_ENABLED` defaults off, reads env
  only, and is never consulted from request parameters.
