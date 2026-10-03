# M4: provider setup and account recovery

Implemented locally on 2026-09-30. The guided implementation now covers TikTok, Meta, Google Ads and Shopee. Live provider acceptance remains outstanding.

## Meta setup

Meta joins TikTok in the guided onboarding path. Both use task-bound, single-use OAuth attempts, the existing provider adapters, encrypted connection storage, explicit empty-default account selection, confirmed reporting dates, atomic job submission and warehouse-backed review. The callback schedules account discovery and does not authorize an automatic onboarding backfill.

Meta discovers current `/me/adaccounts` inventory through the existing Graph client. Pagination is bounded to 20 pages and 15 seconds total, rejects repeated cursors, deduplicates IDs, rejects a failed or malformed page, and follows only HTTPS Graph-origin URLs without redirects. No partial inventory is silently declared complete. Meta's official SDK describes the same next-page protocol: [APINodeList](https://github.com/facebook/facebook-java-business-sdk/blob/main/src/main/java/com/facebook/ads/sdk/APINodeList.java).

Provider configuration is checked separately in the interface: missing Meta configuration disables Meta consent without disabling TikTok or existing-source reuse. Workspace enablement and permissions are rechecked on the server. Shared Sources inventory is updated from live discovery in the confirmation transaction. Meta assignments and job targets use canonical `act_…` IDs.

Confirmed scopes record their provider; older TikTok records parse with a TikTok default. Preview queries use both provider and connection/account/date boundaries. Meta reads `META_CANONICAL_METRIC_GRAIN` (ad); TikTok reads campaign grain. Campaign rollups are excluded from Meta totals. Currency groups remain separate; timezone remains explicitly unverified.

## Failed-account recovery

“Retry failed accounts” is a versioned task action, not a new scope approval. It is available only for terminal failed/partial jobs and preserves the approved connection, advertisers, dates, client and scope revision. The server derives the failed subset from stored receipts; browser-supplied retry IDs are not accepted.

Before submission, it rechecks current membership/initiator, feature/provider access, advertiser authorization, connection identity and credentials, client assignment, plan/execution limits and workspace/connection concurrency. One atomic transaction creates the failed-target-only job, carries prior successful receipts, records the old/new job identity, and updates the task. Identical concurrent clicks reuse the committed job. Dispatch follows commit.

The new job continues the prior retry count and limit instead of opening another automatic retry budget. If that budget is exhausted, the interface explains the limit and offers source investigation or a new explicit account/date confirmation. Prior jobs and warehouse rows are retained. A newly unauthorized target requires reconnect; it cannot become an automatic retry.

Legacy targeted worker retries also retain previous account receipts rather than replacing the whole result with the most recent subset. Receipts are keyed by provider, connection, account and actual execution dates. Re-executed receipts replace earlier results rather than double-counting rows; unresolved failures remain visible. Connection-wide legacy aggregation and checkpoint execution retain their existing contracts.

## Review and continuation

Partial tasks can show actual available coverage, including selected accounts with no rows, without receiving ready status. Finish stays blocked until there is reviewed usable data and every unfinished task is explicitly deferred. Earlier authorization/selection stages remain visually complete when an import needs attention. Stage and status updates use the existing charcoal interface and motion behavior.

Unfinished runs survive reload and defer/restore. A completed run remains immutable; later source work uses the existing Sources entry point. The completed page offers **Continue saved sources** when deferred tasks remain. It creates a fresh run; it never reopens the reviewed run.

## Verification and remaining gates

Local verification passes 187 targeted tests without failures or skips, including real PostgreSQL Google multi-root and Shopee import execution, Meta scope/job/evidence, task-linked consent, failed-only concurrent retry, carried successful receipts, revoked access, exhausted budgets, M1/M2/M3, Meta OAuth/configuration, pagination, durable warehouse execution, existing OAuth/backfill and activation regressions. TypeScript and ESLint pass (existing warnings remain). A production build passes.

Browser verification uses the explicitly named **M4 local review** workspace with synthetic completed/partial jobs and actual local warehouse rows. It checks Meta missing-account disclosure, retry/reconfirmation controls, blocked Finish, explicit deferral and usable-data review. Completing the browser flow records TikTok as ready, Meta as deferred, and the explicit deferred-provider omission in the completion event before console entry. The import stage keeps the earlier authorization/account choices visibly complete when recovery is needed. This is not evidence of live provider consent or report ingestion.

Remaining M4 work: live provider walkthroughs. TikTok and Meta each require an authorized account with reportable history before enabling that provider's onboarding path in a pilot. M5 deployment/cohort/operational gates remain separate.

## Google and Shopee increment

Google OAuth may link multiple persisted manager or standalone connections to one task. Live discovery resolves reportable leaves beneath each exact root; the disclosure identifies the connection and account. Existing-source reuse lets the user choose multiple Google connections explicitly, without adding every workspace source. Selections start empty. Each confirmation freezes normalized `{ key, connectionId, accountId }` targets alongside the displayed dates; legacy single-connection approvals remain readable. Selecting the same customer through two roots is rejected. Client assignment, concurrency checks, job items, warehouse filters and successful/failed receipts use exact connection/account pairs. Retrying one failed customer preserves successful customers on other roots.

The shared Google worker now expands manager roots before filtering selected leaves. Its internal item selection overrides stored selection preferences. It never queries unselected siblings, treats vanished selected leaves as failures, and cannot fall back to querying a selected manager after discovery fails. General Google discovery no longer fabricates a standalone customer from arbitrary 401/403 permission errors.

Shopee uses signed shop-info lookup to verify the token against the exact persisted shop ID. Mismatched bindings, inactive shops and malformed shop responses fail closed. A reused expired Shopee token that cannot prove shop access requires reconnect; shared import execution retains the existing token-refresh behavior. Missing-state callbacks are never implicitly linked to an agent task.

Shopee required coverage is daily orders. Catalog and Ads attempts remain separate, optional child outcomes: failure does not fail good orders or enter the required retry budget. Required order failure still fails readiness, even if Ads produced rows. Review reads only `shopee-orders-daily` / `day_orders` rows, displays orders and order totals with currency, and excludes Ads rows. Dates are UTC order-creation days. Totals include returned order statuses and are explicitly not settled revenue. Order ingestion preserves provider currency, rejects mixed/missing currencies within a single daily rollup, and avoids overlapping 14-day request boundaries. Ads availability is not claimed from an order preview.

Local PostgreSQL tests exercise multi-root Google confirmation/replay, duplicate-root selection rejection, failed-only recovery with carried success, and a real Shopee sync through the shared import code with optional catalog/Ads denial. Provider responses are mocked; credentials and all database rows are synthetic local fixtures. HTTP-level Google worker tests verify manager expansion, empty sibling exclusion and a vanished selected leaf. Browser review checks both Google currencies, Shopee order labels and the completion gate. These are local implementation checks, not live provider acceptance.

Final scoped recheck after retry isolation and control styling: 42 agent tests pass; ESLint reports zero errors (69 existing warnings); the optimized production build, including TypeScript validation, passes.

Browser completion in the synthetic **M4 Google & Shopee local review** workspace passes: Finish stays disabled until both ready previews are opened, then records completion and opens the console with the same workspace selected. A clean reload confirms completed setup is immutable and its imported data remains reviewable.

## Deferred-source continuation — 2026-10-01

The explicit `continue_deferred` action requires the completed run's initiator, current workspace write membership and a completed onboarding review. A deterministic continuation key and serializable transaction make repeat/concurrent clicks return one run. The new run preserves workspace and reporting client, creates only deferred-provider tasks, and records prior run/task identifiers in new events. Completed runs/tasks/events remain unchanged. Connection links, account offers, import approval, jobs and ready tasks are not copied. The user reconnects or explicitly reuses a connected source, discovers current accounts and confirms a new import.

Newest-run lookup is shared by setup creation/resume and the page bootstrap, so reload resumes the continuation rather than the first completed run. Replaying continuation does not unpause current work. Viewer, foreign initiator, foreign workspace, stale first submission and no-deferred-source requests fail closed. Continue later refreshes membership and hands off the same workspace to the console.

Live acceptance procedure and provider-specific evidence are in `AGENT_ONBOARDING_LIVE_ACCEPTANCE.md`; all live provider results remain pending.

Recovery now continues observing submitted jobs after a stalled lease or import-review attention state. Repeated stalled-job polls do not add events or versions, and a recovered job can become ready without another import. Failed-only recovery keeps previously successful account receipts.

Final continuation checks: 47 agent tests pass with no failures or skips; ESLint has zero errors (70 warnings in the current workspace); the optimized production build passes. Browser verification in synthetic **M4 local review** confirms fresh Meta-only continuation, same-workspace console handoff, saved pause, explicit resume and reload persistence. The Meta consent control remains disabled when provider authorization is unconfigured. These checks do not establish live provider acceptance.
