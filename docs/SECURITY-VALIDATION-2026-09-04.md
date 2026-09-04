# Security validation — September 4, 2026

## Outcome and scope

Base: `2613253` (billing redesign PR #147), plus the local changes accompanying this record. **Not deployed by this task.** No production database access, environment changes, provider messages, real payments, or retention jobs were performed.

Story: a signed-in agency owner requests billing, clients, exports or analyst results; the API must authorize the selected workspace before reading/writing PostgreSQL. Only a verified payment notification may extend the workspace bound to its durable order.

The August audit and September `5255156` addendum are historical snapshots. This pass supplements them; it does not certify all production services or approve GA.

## Confirmed gaps fixed

1. **Concurrent payment fulfillment:** a transaction alone did not serialize the initial order/workspace reads. Duplicate deliveries could both process an order; distinct orders could lose an extension. Fulfillment now locks the `PaymentOrder` before checking status, then locks its `Workspace` before computing access. Both locks are parameterized PostgreSQL row locks held through commit/rollback. No migration required.
2. **Legacy cache-only activation:** the Redis fallback could grant access without a durable paid marker/audit. Fulfillment now fails closed if the database order is absent. Legacy cache-only payments require explicit reconciliation, not repeated automatic activation. Existing workspace data and access are not rewritten.
3. **Payment validation:** missing amounts no longer qualify for a manual exception. The webhook checks the **signed inner success code**, safe positive order code/amount, and supplied currency/payment-link consistency. Database errors remain retryable but their details are no longer returned to the caller.
4. **Cache before commit:** fulfillment no longer advertises PAID to Redis from inside an uncommitted transaction or waits for external cache I/O while holding locks. PostgreSQL remains the status authority.
5. **AI client-scope inconsistency:** readiness honored a selected client while metrics/health did not. All tools now receive that client through server-created context. Rival client IDs are rejected before budget/job writes and revalidated for queued execution.
6. **Client list defense in depth:** nested source details now explicitly filter by the authorized workspace as well as the client relation.

The session-based routes under test use the existing `getAuthSession` wrapper. Its runtime behavior remains NextAuth; the integration suite substitutes only the session identity, not RBAC, database queries, or payment transactions.

## Evidence

Local PostgreSQL **16.14**, initialized empty using the existing 14 migrations. Test credentials are synthetic. `scripts/run-security-validation.mjs` strips inherited service credentials, requires a localhost test database name, and sets CI discipline so missing database coverage fails rather than silently skips.

| Boundary | Evidence |
| --- | --- |
| API → database → response | `security-boundaries.pg.integration.test.ts`: real route handlers, membership checks, database fixtures, positive owner/viewer reads and rival/signed-out denials |
| Payment concurrency | Eight simultaneous signed callbacks produce one extension and one audit; separate monthly + annual payments add 395 days |
| Atomic failure/retry | Fixture-specific database constraint forces audit failure after writes; order and access roll back, then retry succeeds |
| Payment authenticity | Forged signatures, signed failed events, missing/insufficient amounts, wrong currency/link, cancelled/expired orders and cache-only orders cannot activate |
| Price authority | Mock PayOS transport, real stored orders: monthly 1,490,000 VND / 30 days and annual 14,900,000 VND / 365 days; browser amounts/durations ignored |
| Read-only return/status | Forged success query parameters do not change orders or access; rival order status and billing requests denied |
| AI scope | All three tools use the workspace/client context; raw payloads and credentials absent from tool output; owner turn persists only selected-client evidence |
| Client/portfolio/export scope | Rival client read/create/update/delete denied; portfolio membership filtering; raw and aggregate metric inputs exclude rival rows |
| Browser → authenticated API | Extended two-tenant Playwright journey exercises billing, client lists, analyst history/turns and viewer restrictions using real NextAuth sessions |

Executed checks:

- Full unit + PostgreSQL suite: **590 passed, 0 failed, 0 skipped**.
- Type checking: passed.
- ESLint: 0 errors, 56 existing warnings (within repository CI threshold).
- Production-mode build: passed from a temporary source snapshot excluding `.env*`, with a separate output directory; original localhost preview untouched.
- Browser suite: **26 passed** across desktop Chromium and mobile Chromium; it uses the isolated database and temporary production-mode app, not production.

Reproduce the database suite after preparing an empty local test database with existing migrations:

```sh
node scripts/run-security-validation.mjs 'postgresql://USER:PASSWORD@127.0.0.1:PORT/monstera_security_test'
node scripts/run-security-validation.mjs 'postgresql://USER:PASSWORD@127.0.0.1:PORT/monstera_security_test' --all
```

Standard CI also discovers the new `*.test.ts` suite against its `monstera_ci` service. Browser tests require `ENABLE_GOVERNED_ANALYST=1` in the test server so a disabled feature cannot produce a misleading isolation pass.

## AI scope review and remaining boundaries

- Interactive GET/POST check membership before history, budget or execution. Viewer is read-only; member+ can run turns. History is filtered by workspace.
- The three registered tools are deterministic, read-only typed tools. Metric dimensions/fields are allowlisted; rawData is stripped from sanitized tool output. This is **not** certification of an unconstrained LLM/tool-calling agent.
- The worker obtains workspace identity from the persisted job, rejects conflicting payload workspace IDs, and fences result writes by workspace + job + lease.
- `WorkspaceAiPolicy.enabledFeatures` exists but is not currently enforced as a per-feature authorization gate. Budget checks are not atomic reservations for future paid model calls. Do not claim those are proven spending controls or enable paid autonomous AI based on this pass; that requires a separate implementation/review. No paid model was called here.
- Workspace membership, not client-specific RBAC, remains the authorization boundary. Client selection narrows reporting; it is not a client-portal permission model.

## Readiness records corrected

`9d6f572` implemented durable poison-account quarantine/reconnect states for Meta, Google Ads and TikTok. Corresponding unit/real-PG tests pass. Missing-provider-row detection is **observability only** and retains rows; automatic deletion/reconciliation remains a limitation. Neither proves real-account connector certification or delivered alerts.

## Explicit release / owner gates still open

1. Review and approve these local changes; run required CI on the eventual commit and verify the deployed immutable SHA after any separately approved release.
2. Real PayOS end-to-end conversion and bank notification delivery remain unproven by synthetic signatures. Late payments after checkout expiry require human reconciliation; this pass does not change that policy.
3. Production schema drift was **not** re-inspected. A fresh read-only comparison requires owner approval; do not treat a clean empty-database migration as evidence about production shape.
4. Named monitoring/restore/retention owners, real alert delivery/escalation evidence and connector certification remain external acceptance gates.
5. Do not activate retention/deletion without a qualified owner decision and isolated drill. Tax/refund/financial-policy wording requires qualified human review.

This closes the exercised local concurrency and tenant-boundary gaps, not every possible security risk. No broad GA claim or automatic deployment is authorized by these results.
