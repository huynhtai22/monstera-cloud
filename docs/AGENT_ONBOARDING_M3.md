# M3: TikTok connection, import and review

Implemented locally on 2026-09-30. The feature remains disabled by default; deployment and live TikTok acceptance have not been performed.

## Product assessment and hardening

The two-stage onboarding fits Monstera's reporting product: an optional work preference followed by source setup that leads to usable data. The role is a personalization preference, never an access level. Existing users can resume or leave; existing connections can be reused. Workspace and original client remain explicit and fixed for the run.

The execution stage now asks only for the decisions the operator must make: provider consent, advertisers, reporting dates, and review. Account selection starts empty. Other selected providers are retained with an honest Sources handoff; they are not described as automated or certified. Pending sources must be explicitly deferred before finishing. Pause prevents new setup work and explains that submitted imports continue.

Hardened boundaries include task-linked single-use consent, membership and initiator checks, revalidation after network calls, current advertiser access, client-assignment conflicts, current assignment checks before preview/completion, complete calendar dates, plan limits without silent truncation, serialized workspace import submission, atomic scope/job/assignment writes, deterministic idempotency, bounded transaction retry, and credential-free responses. No provider login or consent is performed by the agent.

## Execution flow

1. An explicit Connect action creates a ten-minute OAuth attempt bound to the signed-in user, workspace, provider and task. It replaces older pending onboarding consent in that workspace/provider. Credentials are handled by the existing OAuth adapter and encrypted connection storage.
2. The callback consumes that attempt and rechecks the task. TikTok's `auth_code` is supported. Denial or failure returns to the original onboarding workspace with a safe task reason. Ordinary Sources connect/reconnect retain their existing backfill path.
3. An onboarding callback links the resulting connection and schedules live advertiser discovery. It returns before automatic backfill; no import has been approved yet. Existing-source reuse follows the same live discovery boundary.
4. The operator selects authorized advertiser IDs and dates. The default is seven complete reporting dates ending yesterday; input permits at most 30 complete days subject to execution and plan policy. Discovery is repeated before confirmation; an inaccessible ID is rejected.
5. One serializable transaction freezes a scope revision, updates the encrypted advertiser inventory used by existing Sources/worker services, validates or creates explicit client assignments, creates the durable warehouse job and records events. Same-scope replay returns that job. A changed scope cannot borrow prior approval. External dispatch occurs only after commit.
6. The existing durable worker owns leases, bounded retries, reporting ingestion and terminal job results. Snapshot reads reconcile facts; they never launch a job or award progress from animation time.
7. Completed jobs require successful results for every selected account, nonzero imported rows and actual warehouse evidence. Zero-row, failed and partial jobs remain `needs_attention`. Explicit scope recovery retains prior job evidence and requires a new confirmation/revision; deferred failed imports can be restored. Data explorer remains available for investigation.
8. Preview reads exactly the confirmed workspace, connection, advertisers and reporting dates at campaign grain. Totals use all matching rows, with a separate bounded sample. Currencies remain separate; missing account rows and unverified timezone are disclosed. This is source coverage, not a reconciled client report.
9. Review enables Finish setup in the UI. The server independently checks usable scoped evidence, resolution of every task and the existing recent-KPI activation rule. It records the activation review and completes the run together, then returns to the existing console. The handoff refreshes the membership cache and keeps the selected workspace active; the shared session guard also runs on onboarding to prevent an account change from inheriting prior workspace selection.

## Implemented endpoints

- Existing `/api/auth/connect` accepts `agentTaskId`; existing `/api/auth/callback` derives task scope from the stored attempt.
- `GET /api/agent/tasks/[taskId]/connections`: safe existing-source choices.
- `POST /api/agent/tasks/[taskId]/actions`: versioned defer, restore, reuse, discovery and explicit scope recovery.
- `POST /api/agent/tasks/[taskId]/confirm-scope`: account/date confirmation and atomic job submission.
- `GET /api/agent/tasks/[taskId]/preview`: scoped warehouse evidence.
- Existing run snapshot reconciles job outcomes. Run actions accept `finish` with the expected version.

All agent endpoints require authentication and the onboarding flag. The OAuth linkage migration is additive: `20260930120000_oauth_attempt_agent_task_linkage` follows M1's foundation migration. No production schema was changed during this work.

## Verification and release gate

Local PostgreSQL tests exercise real persisted jobs, assignments, events, consent attempts and warehouse evidence. Provider discovery is replaced with a synthetic response in these tests; tokens never contact TikTok. Regression coverage includes M1/M2 persistence, existing OAuth workspace preservation and backfill, TikTok OAuth parsing, activation storage and warehouse lease/idempotency behavior. Browser review uses an explicitly named local fixture and actual local warehouse rows, not live imported TikTok data.

Before enabling a pilot, an authorized TikTok test account with reportable history must pass provider consent, live advertiser discovery, explicit selection, one durable import, warehouse evidence, review and console entry. Repeat with denial, revoked access and a return after closing the page. Verify ordinary Sources connect/reconnect in the deployment environment. Verification passed: 85 targeted tests, with no failures or skips, ESLint (no errors; existing warnings remain), full TypeScript and an optimized production build. Browser checks confirmed empty-default account selection, date controls, exact local data coverage, disabled Finish before review, explicit completion with one activation record, and console navigation. The data review layout has no horizontal overflow at approximately 320 CSS pixels. Local checks do not certify this live acceptance criterion. Meta, Google Ads and marketplace execution remain later provider work; broader recovery/telemetry and pilot rollout remain M4/M5.
