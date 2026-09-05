# Google Connector Runtime — Controlled Live-Shadow Validation Runbook

Status: `CODE_COMPLETE_AWAITING_LIVE_SHADOW_VALIDATION`. This runbook is
executed by an operator later. It performs no live run itself and must not
be read as live certification, production runtime authority, provider
reconciliation, customer-safe promotion, or Meta/TikTok readiness.

## Preconditions

- [ ] Exact release commit recorded below (runbook executed against): ______
- [ ] Clean deployed build verified via `/api/version` (`commitSha` matches).
- [ ] Migration state verified (`ConnectorRunArtifact` table present; no pending migrations).
- [ ] Google credentials configured through normal secret management (never pasted here).
- [ ] One explicitly approved **non-critical** Google Ads account identified (sanitized id): ______
- [ ] Reporting timezone: ______ ; currency: ______
- [ ] Baseline legacy sync completed successfully for the approved account.
- [ ] Artifact cleanup scheduling confirmed (cleanup path present in `pilot-cron.yml`).
- [ ] Rollback authority identified (who may flip the flag): ______

## Activation

1. Confirm the default mode is `legacy`: with `GOOGLE_CONNECTOR_RUNTIME_MODE`
   unset, syncs run the legacy path only.
2. This flag is **environment-wide**. Enable `shadow` only in an environment
   whose traffic is limited to approved test accounts. Never enable it in an
   environment serving unapproved customer traffic.
3. Set `GOOGLE_CONNECTOR_RUNTIME_MODE=shadow` and redeploy that environment.
4. `runtime` remains prohibited: selecting it fails closed with
   `GOOGLE_RUNTIME_MODE_NOT_PROMOTED` before any provider contact.
5. To return immediately to `legacy`: unset the flag (or set `legacy`) and
   redeploy. No data migration is needed; shadow artifacts are inert.

## Validation matrix

Run in order; record each result before proceeding:

1. **Small account, seven-day window.** One approved account, completed 7-day
   window. Expect legacy success + `shadow_comparison` artifact with
   `pass: true`.
2. **Repeat of the same window for idempotency.** Re-run; expect the
   deterministic `already-published` conflict and no duplicate artifacts,
   rows, or audit events.
3. **Thirty-day window for artifact volume.** Confirm chunk counts stay
   within bounds and comparison still passes.
4. **Heavier approved account or representative fixture.** Exercise chunk
   boundaries and shadow-stage durations; confirm the budget is not
   exhausted.
5. **Replay of persisted artifacts with zero Google calls.** Re-run
   evaluation from stored artifacts only; provider-call count must be 0.
6. **Cleanup verification using expired test artifacts only.** Confirm
   expired rows delete, unexpired/certification/warehouse data survives,
   and repeats are no-ops.

## Evidence to collect (per run)

Release commit SHA · run and artifact identifiers · sanitized account id ·
reporting window, timezone, currency · provider-call count · artifact count
and bytes · comparison result and mismatch counts · metric deltas against
the ±0.01 / exact contract tolerances · replay provider-call count ·
lease/fencing status · legacy delivery result · shadow-stage durations ·
cleanup outcome · sanitized errors only.

## Pass criteria

- [ ] No additional Google extraction caused by shadow.
- [ ] Repeated comparisons return `pass: true`.
- [ ] Spend and revenue within ±0.01; impressions, clicks, conversions and
      campaign count exact.
- [ ] Provider IDs remain exact strings.
- [ ] Replay makes zero Google calls.
- [ ] No duplicate rows, artifacts or audit events.
- [ ] No stale-worker writes.
- [ ] No lease expiry or job timeout.
- [ ] Legacy delivery unchanged and successful.
- [ ] Artifact limits and retention policy enforced.
- [ ] No secret or raw sensitive payload in logs.

## Stop/rollback criteria

Immediately return to `legacy` if any of these occur:

- Legacy delivery changes or fails.
- Shadow causes lease expiry or job timeout.
- Shadow triggers additional provider extraction.
- Checksums fail.
- IDs lose precision.
- Runtime writes partial output.
- Cross-workspace evidence appears.
- Comparisons repeatedly fail without an understood provider-semantic reason.
- Sensitive data appears in logs.

## Promotion boundary

Successful shadow validation does **not** automatically enable `runtime`.
Promotion requires a separate reviewed task, explicit authorization, and its
own rollback plan. `GOOGLE_RUNTIME_MODE_NOT_PROMOTED` remains the enforced
default until then.
