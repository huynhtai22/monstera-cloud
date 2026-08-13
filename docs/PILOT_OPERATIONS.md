# Agency pilot operations

## Release sequence

1. Rehearse the migration against a production-like snapshot and confirm Prisma reports no unexpected drops or drift.
2. Confirm all legacy connection credentials are encrypted before enabling code that rejects plaintext.
3. Run CI gates and connector contract tests for every enabled provider.
4. Deploy three internal tenants, then five design partners, then expand to no more than twenty agencies.
5. After the production alias changes, compare `/api/version` with the intended commit and schema migration.

Pause expansion immediately for a confirmed tenant leak, data corruption, or sustained connector failure. Revoke affected API keys and OAuth credentials, preserve audit evidence, and notify affected pilot owners through the agreed incident channel.

## Required monitors

- OAuth attempts by provider and failure code, especially invalid/reused state.
- First import completion and time-to-first-row.
- Queued/running job age and exhausted retries.
- Workspace freshness from `lastSyncAt`, latest successful job, and warehouse `asOf`.
- API error rate, tenant authorization failures, and connector error rate.
- Invitation creation/acceptance and API-key issue/revoke audit events.

## Connector certification

Each enabled provider must pass OAuth, account discovery, first import, token refresh, manual refresh, nightly refresh, expired-token recovery, and visible freshness/error state. Lazada, Amazon, Shopify, and TikTok Shop remain disabled until the same checklist passes.

## Rollback

Use the previous Vercel deployment for application rollback. Database migrations are forward-only: restore only from a verified snapshot after incident review. Never run destructive Prisma reset commands against pilot or production data.
