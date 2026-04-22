# Monstera Cloud — Backend Architecture Recommendations

Summary
- Goal: make `/api/looker-studio` and related data flows scalable, reliable, secure, and easy to maintain for large date-range / multi-account exports.

Priority legend
- P0: Critical, implement immediately.
- P1: High impact, short-to-medium effort.
- P2: Medium impact, medium effort.
- P3: Long-term / optional.

Recommendations (prioritized)

P0 — Critical
- API Pagination & Cursoring: server-side cursor-based pagination (or stable offset with limits). Return `data`, `nextCursor`, and `totalRows`. Client should page until `nextCursor` is null or soft limit reached.
- Server-side Filtering & Aggregation: require and use server filters (date range, platform, accountId(s), reportLevel) to avoid full-table scans.
- Rate Limiting & Throttling: per-API-key rate limits and max-rows-per-request enforcement; return clear 429 messages.
- Security & Key Management: store API keys in a vault, support rotation, issue scoped keys, and validate scopes per-request.

P1 — High impact
- Shared Cache Layer: add Redis (or managed cache) for hot query results and precomputed aggregates; TTL configurable and keyed by query params.
- Meta/Count Endpoint: add `/api/looker-studio/meta` to return supported platforms, account list, and estimated `totalRows` for a query — used by connectors to decide paging/windowing.
- DB Indexing & Partitioning: add indexes on (date, accountId, platform, workspaceId). Consider time-based partitioning for large tables (monthly/yearly) if row counts grow.
- Connector Pagination & Throttles: update clients (we patched the Looker Studio connector) to consume paged APIs and enforce a local row cap.
- Observability: add request metrics (latency, error rates), DB query times, cache hit rate, and alerts (Sentry/Prometheus).

P2 — Medium-term
- Background Processing / Job Queue: run heavy ETL or long exports as background jobs (Redis + Bull / Cloud Tasks). Provide job status endpoints and job ids.
- Incremental / Windowed Exports: support incremental pulls by date windows or delta tokens to avoid reprocessing entire history.
- Streaming & Compression: support newline-delimited JSON or streaming CSV with gzip for large payloads.
- Idempotency & Safe Retries: idempotency keys for long-running requests and retries.

P3 — Long-term
- Pre-aggregations: schedule nightly/periodic aggregate tables for common rollups (daily by account+campaign+platform).
- Data Warehouse / Lake Sync: export raw events to a data warehouse (BigQuery/Redshift/Snowflake) for analytics and heavy joins.
- Query Scheduler & Materialized Views: materialize expensive views and refresh on schedule or via change-data-capture.

Quick wins (what I can implement now)
- Add server-side cursor pagination for `/api/looker-studio` and `meta` endpoint (P0/P1).
- Add Redis caching for query results (P1).
- Add explicit DB indexes (P1) — I already added composite indexes to `prisma/schema.prisma` for `CampaignMetric`.
- Update the Looker Studio connector to page through results (done).

Implementation checklist (concrete next steps)
1. Add/extend `/api/looker-studio` to accept `cursor` and return `{ data, nextCursor, totalRows }` (P0).
2. Add `/api/looker-studio/meta` to return accounts, platforms, and estimated `totalRows` (P1).
3. Add Redis cache and use it to cache query results and job outputs; make cache TTL configurable (P1).
4. Add rate limiting middleware (API key level) and request-size limiting (P0).
5. Add background job queue for heavy exports; return job id and status endpoint (P2).
6. Run DB migration for new indexes (Prisma migration) and monitor query plans (P1).

Testing & rollout
- Add integration tests for pagination, `meta`, rate-limits, and error responses.
- Load-test the `/api/looker-studio` endpoint with representative date ranges and multiple concurrent API keys.
- Roll out staging first, monitor cache hit rates and query latency, then promote to prod.

If you want, I can implement steps 1–3 now (server cursor pagination, `meta` endpoint, Redis caching). Tell me which step to start with and I will create the server patch and tests.