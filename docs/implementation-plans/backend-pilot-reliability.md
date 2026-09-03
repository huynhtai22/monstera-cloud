# Backend Pilot-Reliability Plan

Status: In Progress (Blocks 1 & 2 complete)

## Objective

Make Monstera Cloud safe and dependable enough to onboard the first paid HCMC agency design partner without expanding product scope or adding avoidable operating cost.

## Facts at the time this plan was recorded

- The automated suite passed 443 tests with 0 failures; 26 PostgreSQL-dependent tests were skipped locally and remain part of CI coverage.
- Durable PostgreSQL-backed jobs already exist for core warehouse work.
- The active rebuild branch was six commits ahead of `origin/main`.
- `/api/version` exposed a hard-coded historical schema identifier rather than a release-derived value.
- PayOS checkout state used Redis with a 24-hour lifetime.
- The end-to-end delivery of founder alerts had not yet been proven with one approved production test.

## Recommended implementation

### 1. Make PostgreSQL authoritative for PayOS fulfillment (COMPLETED)

- Add a durable `PaymentOrder` record for checkout intent, workspace, offer, amount, currency, status, expiration, PayOS reference, fulfillment timestamp, and webhook audit metadata.
- Reduce checkout validity to 30 minutes.
- Fulfill subscriptions only inside a database transaction after signature and payload verification.
- Make repeat webhook deliveries idempotent.
- Return a retryable 5xx response when fulfillment cannot be persisted.
- Never activate a subscription from browser redirects, success pages, or cancellation pages.
- Retain payment records until a qualified Vietnam tax/accounting review defines the required retention policy.

### 2. Restore one controlled release path (COMPLETED)

- Merge the rebuild branch to `main` through a reviewed pull request or fast-forward release.
- Allow normal CI to be the only routine production deployment path.
- Derive `RELEASE_SCHEMA_VERSION` during build instead of maintaining a hard-coded value.
- Use the direct migration database URL for release migrations and rehearse the migration before production.
- Post-deploy verification checklist covering deployed Git SHA, source branch, schema version, authentication, PayOS, rate limiting, and cron health (detailed below).

#### Post-Deploy Verification Checklist

1. **Release Identity & Version Verification**:
   - Query `GET https://monsteracloud.com/api/version`.
   - Verify `commitSha` matches the released Git commit SHA on `main`.
   - Verify `commitSource` is `"build"`.
   - Verify `schemaVersion` matches the latest migration (e.g. `20260903120000_payment_order_authoritative`).
   - Verify `buildTime` is populated and matches the release timestamp.

2. **Database Migration Health**:
   - Verify `_prisma_migrations` in production has all migrations applied (`finished_at` not null, `rolled_back_at` null).
   - Ensure `DIRECT_URL` was used for unpooled DDL execution during deployment.

3. **Authentication & Multi-Tenant Guarding**:
   - Verify login and session handling on `https://monsteracloud.com/login`.
   - Confirm tenant-guarded models strictly isolate workspace resources.

4. **PayOS Billing Integrity**:
   - Verify checkout initialization creates a `PaymentOrder` in PostgreSQL with 30-minute validity.
   - Verify `/api/webhooks/payos` rejects invalid signatures (401) and handles duplicates idempotently (200).

5. **Edge Rate Limiting & Webhook Fallback**:
   - Verify health checks pass and rate limiting fallbacks remain available.

6. **Cron & Background Processing**:
   - Confirm cron endpoints (`/api/cron/health-tick`, `/api/cron/sync-jobs`, `/api/cron/warehouse-jobs`) execute under valid `CRON_SECRET`.

### 3. Track account-level connector health (COMPLETED)

- Added durable `ProviderAccountHealth` model and schema migration for Meta, Google Ads, and TikTok accounts.
- Stored structured child-account errors with taxonomy (`AUTH_EXPIRED`, `PERMISSION_DENIED`, `RATE_LIMITED`, `SCHEMA_DRIFT`, `TRANSIENT_NETWORK`, `UNKNOWN`) and lifecycle states (`healthy`, `degraded`, `quarantined`, `reconnect_required`).
- Isolated sibling accounts so healthy accounts continue syncing while poison or revoked accounts are safely bypassed.
- Added provably complete-fetch, observability-only stale row reconciliation (`computeStaleRowStats`) detecting unreturned entities without destructive warehouse mutation.
- Exposed account-level health through `GET /api/connections/[id]/status` for product UI and operator dashboards.
- Wired actionable failures to `upsertOpenTicket` support tickets and Telegram founder notifications via `sendAgencyAlert`.

### 4. Simplify operations and prove alerting

- Run one explicitly approved production alert test and verify receipt.
- Keep the founder as the primary incident recipient during the design-partner phase.
- Remove unused Redis queue or interceptor paths after confirming they have no runtime callers.
- Do not add a new queue vendor, Vercel Pro, new connectors, or automated record deletion as part of this plan.

## Acceptance tests

- Exact monthly, annual, and private-offer PayOS amounts produce durable orders with the intended expiration and workspace binding.
- Forged, expired, wrong-workspace, and already-redeemed offers cannot create or fulfill discounted orders.
- A verified webhook activates access once; repeated delivery is harmless.
- Redirects, cancellation pages, and manual browser requests cannot activate access.
- A database outage causes a retryable webhook response rather than acknowledged-but-lost fulfillment.
- One failing provider account is visible and isolated while healthy siblings continue.
- The deployed Git SHA and schema version are observable and match the intended release.
- The founder receives one approved end-to-end incident alert.

## Assumptions

- This work is resumed only after the landing-page and first-customer priorities justify it.
- PostgreSQL remains the source of truth; Redis may remain an optimization but not the only payment record.
- Existing customers and legacy payment records are preserved during the migration.
- Legal, tax, retention, and invoicing decisions receive qualified Vietnam professional review.
