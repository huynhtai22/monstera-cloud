# Raw Data Retention Observability

`CampaignMetric.rawData` pruning is disabled. The operator-only dry-run route
`GET /api/operations/warehouse/raw-retention/dry-run` only measures potential
eligibility and has no write path, audit record, job, provider call, archive, or
cleanup cron.

## Retention clock

The dry-run uses `pulledAt < cutoff` in UTC. Provider `date` is not the clock:
an old historical row imported today must retain its payload for the full policy
window. The only accepted future-policy measurements are 14, 30, and 90 days;
30 days is the recommended future default, but is not enabled.

14 days minimizes payload storage but only supports immediate triage. 30 days
aligns with normal import windows and is the recommended future choice. 90 days
supports quarterly review but delivers the smallest storage reduction.

## Preconditions for any future pruning

Meta Data Explorer currently derives `ad_name` from raw payload text. Shopee Ads
uses raw broad/direct metrics and keyword settings in its performance endpoint.
Those fields must be promoted or explicitly retired before any pruning. Data
quality schema rules can also reference raw-only fields and require an inventory.

An archive table in the same PostgreSQL database does not reduce total storage;
it only relocates payloads and adds write/TOAST overhead. A future recovery option
is encrypted object storage with a manifest and lifecycle policy, after separate
security and restoration design.

The response labels exact candidate counts separately from byte estimates, which
carry their own evidence: `exact` when every eligible row was measured, `sampled`
for a bounded physical sample, and `unknown` when nothing was sampled (never a
false zero). Small eligible sets are measured with a bounded unsorted scan; large
sets use a fixed internal `TABLESAMPLE SYSTEM (10)` page sample with a hard row
cap. Sampling never ranks or sorts the candidate population, and the sampling
percentage is not caller-controlled. Only `octet_length("rawData")` is read;
payload values never leave PostgreSQL and malformed JSON is opaque text.
No migration or index is added here. Exact `pulledAt` aggregates scan scoped rows
and remain statement-timeout bounded without a supporting index; if that scan
proves too expensive, capture measured plans before proposing an index later.

## Snapshot and timeout behavior

All measurement queries run in one RepeatableRead transaction, so the response
is internally snapshot-consistent: concurrent imports cannot make sections
disagree, and a later invocation observes subsequently committed rows. The
transaction budget is derived from the statement budget (3 timed statements ×
1.5 s + 1 s buffer = 5.5 s) so it cannot self-expire before PostgreSQL
statement timeouts fire. Both PostgreSQL cancellation (57014 / statement
timeout) and Prisma transaction expiry (P2028) map to HTTP 408; unrelated
errors keep their existing classification and error bodies never carry SQL,
payload, credential, or transaction-internals content.
