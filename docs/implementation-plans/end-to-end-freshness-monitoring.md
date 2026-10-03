# End-to-end data freshness monitoring

## Scope

Operations displays each evaluated client's Source → Warehouse → Report → Delivery journey, derived from the existing canonical report-readiness evaluator. It does not create a second readiness algorithm or turn connection existence into delivery evidence. The foreground view refreshes every 60 seconds while visible and online, and on focus.

Each stage exposes canonical blocker codes, recovery links, last successful sync, data-through date, and current verified delivery evidence. Missing or capped evidence is explicitly unknown, not healthy. Canonical reporting windows and freshness rules remain authoritative; monitor timestamps do not extend them.

## Background observations

`REPORT_FRESHNESS_MONITOR_ENABLED=1` enables the existing authenticated health-tick route to evaluate a rotating sample of at most three active-workspace clients per 15-minute slot. The response reports sample offset, coverage and estimated sweep duration. This is bounded sampling, not a promise that the whole fleet was checked. Client creation/deletion can change pagination and sweep duration.

Each evaluation uses a tenant-scoped RepeatableRead transaction. A separate short transaction publishes an observation under a nonblocking per-client advisory lock. Older or duplicate observation timestamps cannot overwrite newer state. Unchanged observations advance `checkedAt`; incident changes and recovery append audit events and structured monitor logs. A busy lock skips publication for that observation.

`ClientFreshnessState` is monitoring metadata, not verification authority. A successful observation describes its evaluation snapshot; subsequent source or dataset changes can invalidate readiness. The live canonical evaluator remains authoritative. Evaluation failures become unavailable observations rather than verified results. No new email, Telegram, provider request, or external notification is sent by this feature.

## Rollout

1. Review and apply additive migration `20260921000000_client_freshness_state` before deploying the updated application. It creates one state row per client with composite tenant/client ownership and cascading deletion.
2. If enforcing staged RLS, apply the updated policy installation for the new table before enforcement. The model is included in tenant-guard coverage.
3. Verify Operations on preview with real-shaped local fixtures, including missing sources, stale warehouse data and stale destination receipts.
4. Enable the background flag only after reviewing cron execution capacity and observing a preview sweep. It defaults to disabled.
5. Check `report_freshness.changed` audit events and `report_freshness_changed` / `report_freshness_unavailable` logs. Operations separately labels the last background observation.

No production deployment or migration is performed as part of local implementation. Provider certification and actual customer destination retrieval still require separately authorized live verification.
