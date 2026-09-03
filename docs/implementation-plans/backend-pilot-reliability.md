# Backend Pilot-Reliability Plan

Status: Deferred for later implementation

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

### 1. Make PostgreSQL authoritative for PayOS fulfillment

- Add a durable `PaymentOrder` record for checkout intent, workspace, offer, amount, currency, status, expiration, PayOS reference, fulfillment timestamp, and webhook audit metadata.
- Reduce checkout validity to 30 minutes.
- Fulfill subscriptions only inside a database transaction after signature and payload verification.
- Make repeat webhook deliveries idempotent.
- Return a retryable 5xx response when fulfillment cannot be persisted.
- Never activate a subscription from browser redirects, success pages, or cancellation pages.
- Retain payment records until a qualified Vietnam tax/accounting review defines the required retention policy.

### 2. Restore one controlled release path

- Merge the rebuild branch to `main` through a reviewed pull request.
- Allow normal CI to be the only routine production deployment path.
- Derive `RELEASE_SCHEMA_VERSION` during build instead of maintaining a hard-coded value.
- Use the direct migration database URL for release migrations and rehearse the migration before production.
- Add a post-deploy checklist covering deployed Git SHA, source branch, schema version, authentication, PayOS, rate limiting, and cron health.

### 3. Track account-level connector health

- Add a `ProviderAccountHealth` record for Meta, Google Ads, and TikTok accounts.
- Store structured child-account errors and distinguish healthy, degraded, quarantined, and reconnect-required states.
- Continue syncing healthy sibling accounts when one child account fails.
- Add detection-only reconciliation for missing provider-account rows before enabling automatic repair.
- Expose account-level health to the product and founder operations view.
- Deliver actionable failures through the existing support-ticket path and Telegram founder alerting.

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
