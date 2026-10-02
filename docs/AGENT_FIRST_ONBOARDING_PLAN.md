# Agent-first implementation specification

## Decision and release boundary

**Implementation status (2026-10-01):** M1–M4 are implemented and verified locally, including TikTok, Meta, Google Ads, Shopee and deferred-source continuation. The production release adds an explicit pilot workspace cohort; empty production cohorts fail closed. Live provider acceptance remains pending and broader M5 rollout remains gated. See [live acceptance](./AGENT_ONBOARDING_LIVE_ACCEPTANCE.md) and [pilot release](./AGENT_ONBOARDING_PILOT_RELEASE.md).

Build the existing approved onboarding design as a real workflow, then reuse its coordinator and task records for a weekly client report workflow. The initial live vertical slice is **TikTok Ads** (`tiktok_business`), followed by Meta Ads, Google Ads, and Shopee where enabled and authorized. TikTok is a proposed implementation default, not a claim that deployment configuration or live credentials have been verified. A provider's live acceptance cannot pass without an authorized test account with reportable history.

The first release is complete when a new user can choose a role, connect a provider, confirm exactly which accounts to import, leave and return without losing progress, review real warehouse results, and enter the existing console. A second provider may remain blocked/deferred without preventing that review. An enabled but unvalidated provider must not be presented as already live-certified.

**Scope included:** two onboarding screens; six work categories; natural-language or direct connector selection; real OAuth; provider specialists; account/shop confirmation; plan-limited initial import; durable progress; bounded retry; partial completion; review; return/resume; existing connection reuse; mobile and reduced-motion behavior.

**Explicitly outside this release:** ad budget/campaign mutations; autonomous provider login; collecting passwords in chat; unsupported provider expansion; buyer-level attribution; automatic external report delivery; a redesign of every console screen; unrestricted agent browsing or shell/database tools. These exclusions keep the first release finishable and aligned with capabilities actually in the repo.

## Product decisions to use for implementation

| Decision | Selected behavior |
| --- | --- |
| Primary user | Agency operators and growth marketers are the initial reporting use case. The six role choices remain available; they change recommendations and wording, never permissions. |
| Categories | Business owner, Growth marketer, Agency / consultant, E-commerce seller, Operations / analyst, Other. Role selection can be skipped and edited later. |
| First route | `/onboarding`; authenticated, full-screen without console sidebar, and available on tenant hosts through the same agency routing pattern. Use a dedicated `(onboarding)` route group, agency wrapper/slug validation, and prefix registration. |
| Entry rule | Show setup after workspace resolution for new users/workspaces without usable source data. Existing activated workspaces retain their current home; they can launch setup deliberately. Viewers see guidance/direct read access and a request for a member to connect. |
| Existing workspace with multiple members | A run belongs to its initiating user and selected workspace. Members do not overwrite another operator's account choices; shared connection/job facts can be reused. |
| Defaults | TikTok first for the vertical slice. Initial window is the last seven days using existing date semantics, explicitly labeled with its boundaries. Offer 30 days only when both plan and execution policy permit it. |
| Agency/client identity | Show the selected workspace throughout setup. For agency users, select an existing client or explicitly choose workspace-only setup before client-specific work. A work category does not create a client or assign accounts automatically. |
| OAuth interaction | One consent redirect at a time. Once authorized, imports for separate sources can progress within backend limits. |
| Existing connection | Offer “Use connected accounts” and “Connect another account.” Revalidate health and authorized account scope before importing. |
| Questions | Ask only for missing scope or user-controlled choices. Do not repeatedly request permission for an already-confirmed import or bounded retry of the same scope. |
| Closing the page | Work already submitted continues. Reopening resumes the persisted run. Leaving setup is not represented as cancelling a provider job. |
| First result | A scoped data preview and clear source/account/date coverage. A preview is not labeled a verified client report. |
| Completion | Existing durable activation/review checks plus an explicit resolution of unfinished onboarding tasks: keep pending or defer. Show omissions; never quietly mark all providers complete. |
| Feature rollout | `ENABLE_AGENT_ONBOARDING`, default off; enable in preview and an explicitly enabled pilot workspace cohort before general availability. Gate API and route behavior consistently. |

## Exact user journey: happy path

Example: a growth marketer selects TikTok Ads and Meta Ads for workspace W.

| Screen/event | What the user sees or does | What the server does |
| --- | --- | --- |
| Role screen | Select Growth marketer; Continue | Saves work preference and creates/resumes the user's workspace-scoped onboarding run. |
| Coordinator question | “Which ad platforms do you use?” User selects TikTok Ads and Meta Ads or types their names. | Validates eligibility and creates two provider tasks. A model can interpret wording but cannot add an unconfirmed connector. |
| Task list | TikTok: Needs your approval. Meta: Needs your approval. | Persists tasks; no provider job is claimed or token exchange implied yet. |
| Connect TikTok | User clicks the task's Connect button. | Creates a task-linked, single-use OAuth attempt; validates user/workspace/provider; returns the existing provider authorization URL. |
| Provider screen | User signs in and grants access on TikTok. | Provider redirects back with a code and state. The provider hosts all passwords and two-factor steps. |
| Return to onboarding | “TikTok connected. Choose accounts.” | Validates/consumes the attempt; stores encrypted tokens; links callback connections; discovers authorized advertiser accounts; defers onboarding automatic backfill. |
| Account/window choice | Select advertiser A, deselect B, review the effective dates; click Import selected accounts. | Freezes the confirmed scope and revision, then submits a durable warehouse job exactly once. |
| Importing | TikTok task shows queued/importing/verification. User can now connect Meta. | Uses existing warehouse worker/leases. Status derives from job results, never animation time. |
| Meta consent and import | Same user-controlled sequence for Meta. | Meta adapter and account selection logic use the same workflow contract. |
| Results | Account A data preview, data-through date, currency/timezone and any missing coverage. | Queries warehouse rows constrained to the task's selected connections/accounts/window, evaluates outcome and verifies source evidence. |
| Review | User reviews included data and clicks Finish setup. | Calls the existing activation milestone service. Returns the real updated activation state, marks the run reviewed, and navigates to the existing console. |

Do not show an import percentage until a denominator exists. When the worker only reports completed account/chunk counts, show “2 of 4 account imports” or a named stage. A decorative moving indicator must not pretend to measure bytes or rows.

## Exact failure and recovery behavior

| Condition | User-visible behavior | Persisted/execution behavior |
| --- | --- | --- |
| Authorization denied | “TikTok access wasn't approved.” Retry authorization or defer. | Task remains waiting with `authorization_denied`; no import is submitted. Map a provider error to a task only through a validated attempt/session association. |
| Consent abandoned / state expired | “Finish connecting TikTok” with a new Connect action. | Uncompleted attempt expires after the existing ten-minute boundary; do not reuse consumed/expired state. |
| Monstera sign-in expired at callback | Sign in again, then resume the task and restart consent if needed. | Never fall back to a guessed/default workspace. |
| Accessible accounts empty | Explain that no advertiser account was found and offer retry discovery/reconnect or defer. | `needs_attention/no_accounts`; no empty default selection is silently imported. |
| No account selected | Import button disabled; API rejects a crafted empty selection. | The server validates disclosed authorized IDs, not just the frontend checkbox state. |
| Provider or plan limit changes | Show revised effective dates and ask to confirm changed scope. | Invalidate the previous scope revision; do not import newly truncated/expanded dates silently. |
| Job already active | “Already importing” and the existing job link. | Attach to an exact-scope active job if authorized; otherwise queue under current concurrency rules. No duplicate connection work. |
| Transient provider error | Show retry/backoff and the source affected. | Use existing bounded job retries for the confirmed scope. The model does not run an unbounded retry loop. |
| Revoked token | Reconnect action; preserve existing warehouse history. | `needs_attention/reconnect_required`; do not claim a transient retry can restore consent. |
| Zero imported rows | “Connected, but no data was found for these accounts and dates.” | Offer a scope change or investigation. A successful HTTP response alone does not mark the task ready. |
| Partial import | Show successful and failed account targets and Retry failed accounts. | Retain successful data; use the existing partial-job retry behavior for failed targets. |
| Second provider blocked | “Review available data” plus explicit pending-source notice. | Finish with the first usable source after the user chooses keep pending or defer. Do not mark the blocked task ready. |
| User refreshes / switches workspace | Resume in the original workspace, or deliberately open a separate run for the new one. | Fetch by persisted run ID and validated membership; current browser store cannot retarget running work. |
| Permission revoked mid-run | Access-required state. | Recheck authorization before new work or persisted work resumes. Define already-started import continuation from existing worker policy; no new scope is granted. |
| Model unavailable/budget exhausted | Direct connector picker and task controls remain usable. | Deterministic workflows continue; model failure cannot erase or block a valid import. |

## Runtime architecture: components and boundaries

```text
Onboarding UI / future workspace agent
        |
        v
Authenticated agent API
        |
        v
Coordinator: resolve intent -> validate scope -> produce allowed next actions
        |
        +--> Provider specialist adapters (deterministic workflow services)
        |        +--> existing OAuth provider adapters
        |        +--> shared account discovery/selection services
        |        +--> shared durable warehouse job submission
        |
        +--> Scoped evidence/readiness queries
        |
        v
Postgres: runs, tasks, messages, events, confirmed scope, job references
        ^
        |
Existing warehouse workers -> import progress/results -> reconciliation service
        |
        v
UI polling: current task facts + new events -> state transitions and animation
```

Choose **one conversational coordinator and deterministic specialists** for release one. This is a deliberate execution design: each provider task has its own state, adapter, inputs, and outcome, but no separate unconstrained model is needed for token exchange or import. A model interprets free-text requests and explains structured outcomes; it cannot execute arbitrary provider calls.

Extract account selection and import submission into shared services used by both their existing authenticated routes and the new agent tools. Pass an authenticated actor/workspace context into services and reauthorize there. Do not make internal HTTP calls with fabricated user sessions. Keep existing encryption, token refresh, execution guards, leases, plan checks, and telemetry.

Use the currently configured model routing/budget layer for interpretation rather than adding a new model vendor. New onboarding tools are separately registered; the existing analyst classifier remains unchanged until the agent-home milestone. MVP limits: at most four provider tasks per onboarding run, one user message processed per run at a time, and at most three coordinator tool-planning steps per message. Exhaustion returns a deterministic next action, not an invented success. Costs are recorded against workspace AI policy.

## Database changes: proposed concrete records

The M1 records below are implemented with an additive migration and verified on an isolated local PostgreSQL database. Production has not been migrated. OAuth task linkage and confirmed scope/result contracts are implemented in M3 with a separate additive migration; production has not been migrated.

| Record | Fields required for release one | Constraints/purpose |
| --- | --- | --- |
| `User` additions | `workCategory` nullable enum; `workContext` nullable bounded text; `workProfileAnsweredAt` nullable timestamp | Six enum values matching the screen. `answeredAt` can record a deliberate skip with null category. User can modify only their own preference. |
| `AgentRun` | `id`, `workspaceId`, `initiatorUserId`, nullable `clientId`, `kind`, `status`, `version`, nullable `resumeKey`, `lastEventSequence`, `createdAt`, `updatedAt`, nullable `reviewedAt` | MVP kind `onboarding`; later `weekly_report`/`analysis`/`source_recovery`. Unique `(workspaceId,resumeKey)` enforces a resumable active onboarding run per initiating user. The server reads completed runs before offering an explicit restart. |
| `AgentTask` | `id`, `workspaceId`, `runId`, `taskKey`, `type`, nullable `provider`, `state`, nullable `reasonCode`, `version`, `scopeRevision`, `requestedScope`, nullable `confirmedScope`, nullable `confirmedAt`, nullable `confirmedByUserId`, nullable `importJobId`, `result`, timestamps | Unique `(runId,taskKey)`, e.g. `connect:tiktok_business`. Validated JSON contracts for scopes/results. Changes require the expected version; no arbitrary model-supplied state transition. |
| `AgentTaskConnection` | `id`, `workspaceId`, `taskId`, `connectionId`, selected account IDs | Unique `(taskId,connectionId)`. Supports several Google connections from one callback. Revalidate that all references belong to the run workspace. |
| `AgentRunMessage` | `id`, `workspaceId`, `runId`, `messageKey`, `role`, bounded sanitized content, structured response, `createdAt` | Unique `(runId,messageKey)` provides retry-safe user/assistant messages. Structured response references real tasks, never tokens or arbitrary executable HTML. |
| `AgentRunEvent` | `id`, `workspaceId`, `runId`, nullable `taskId`, `sequence`, `type`, sanitized payload, `createdAt` | Unique `(runId,sequence)`. Allocate sequence with a transactional run counter; event creation and task state change commit together. |
| `OAuthAttempt` addition | nullable `agentTaskId` relation | Callback derives task identity from the attempt, then verifies workspace/provider/user. Browser return URLs are not authoritative. |

Register every new direct workspace-owned model in `TENANT_GUARDED_MODELS` and extend schema-coverage/isolation tests. Foreign keys alone cannot prove that task, connection, job, and run share the same workspace; enforce that in shared services and database constraints where practical. Add indexes for run-by-workspace/user/status, task-by-run/state, and event-by-run/sequence.

MVP stores confirmation on the task rather than introducing a separate generic approval engine. Every confirmation freezes provider, connection/account scope, dates, and revision. An import key is `onboarding:{taskId}:{scopeRevision}`. The warehouse's existing workspace-key uniqueness provides deduplication, supplemented by guarded task transitions. An account/date edit after confirmation creates a new unconfirmed revision; it does not mutate a running job's input.

## State machine and who may move it

| From | Trigger and authoritative evidence | To |
| --- | --- | --- |
| Task absent | User confirms provider choice; eligibility checked | `waiting_authorization` or `discovering_accounts` for a reused connection |
| `waiting_authorization` | Validated OAuth callback and persisted connection references | `discovering_accounts` |
| `discovering_accounts` | Authorized account/shop inventory persisted | `waiting_selection` |
| `waiting_selection` | User confirms scope; version/policy checks pass; job persisted | `queued` |
| `queued` | Warehouse job is claimed/running | `importing` |
| `importing` | Relevant job targets have terminal outcomes | `verifying` |
| `verifying` | Scoped warehouse evidence is usable for review | `ready` |
| Discovery/import/verification | Structured failure, empty, partial, or reconnect requirement | `needs_attention` with explicit reason |
| Waiting/needs-attention | User requests reconnect/retry and checks pass | Appropriate previous executable state |
| Waiting/needs-attention | User explicitly defers | `deferred` |

An import's active task cannot be silently deferred as if execution stopped. First show that work continues; defer future steps only. Partial results can contribute usable data even while a task remains `needs_attention`. Readiness of the first workspace preview and readiness of an exact client report are separately derived.

Run states: `in_progress`, `waiting_user`, `ready_to_review`, `completed`, `paused`. Pause means no new work is launched; already-submitted warehouse work follows its actual cancellation capability. A GET can reconcile task facts from associated jobs, but never launch new work. The worker or reconciliation layer writes version-checked transitions/events idempotently.

## API contracts to implement

All routes require a signed-in session. Run/task endpoints resolve workspace from the stored record, validate membership and initiator/delegation policy, and deny cross-workspace references. Mutation routes require the applicable existing member role. A viewer cannot launch connections/imports. Feature-off behavior is a consistent 404 for new endpoints.

| Endpoint | Input | Output and behavior |
| --- | --- | --- |
| `PATCH /api/me/work-profile` | `{ category: enum|null, context?: string }` | Saved own-user profile and answer timestamp; max context length 500 characters. |
| `POST /api/agent/runs` | `{ kind: "onboarding", workspaceId, clientId?: string }` | `{ run, tasks, messages, created }`; 201 new / 200 resumed. Validates client ownership and returns current persisted state. |
| `GET /api/agent/runs/[runId]` | Optional `afterSequence` | `{ run, tasks, messages, events, lastSequence }`; bounded messages/events, reconciled job facts, no job launch. |
| `POST /api/agent/runs/[runId]/messages` | `{ messageId, text, expectedVersion }` | `{ message, reply, proposedActions, lastSequence }`; duplicate messageId reuses the committed reply; ambiguous source requests ask a question. Suggested actions are validated server-side before presentation. |
| `POST /api/agent/runs/[runId]/providers` | `{ providerIds, expectedVersion }` | Deduplicated eligible provider tasks. Selection is explicit even when proposed by conversation. |
| `POST /api/agent/tasks/[taskId]/authorize` | `{ expectedVersion }` | `{ authorizationUrl }` constructed through existing provider/attempt services. The browser navigates only after this user action. Reject another pending attempt for the same provider/session until expired or deliberately restarted. |
| `GET /api/agent/tasks/[taskId]/accounts` | None | Authorized inventory grouped by connection; provider-specific shop binding for marketplaces; existing cached discovery with an explicit refresh action if needed. |
| `POST /api/agent/tasks/[taskId]/confirm-import` | `{ expectedVersion, selections: [{ connectionId, accountIds }], since, until }` | Validates disclosed IDs, effective range, leases/policy; freezes scope and returns 202 `{ task, jobId, requestedRange, effectiveRange }`. Policy-adjusted input needing reconfirmation returns structured 409 with the proposed effective scope before creating a job. |
| `POST /api/agent/tasks/[taskId]/actions` | `{ expectedVersion, action: "retry"|"reconnect"|"defer" }` | Structured next state/required user action. Retry uses stored scope and existing partial-retry service; reconnect starts a new consent step. |
| `GET /api/agent/runs/[runId]/preview` | None | Selected-source/account data, coverage, freshness, currency/timezone, usable/blocked/deferred sources, and first-review eligibility. No unrelated workspace rows can falsely satisfy the run's preview. |
| `POST /api/agent/runs/[runId]/complete` | `{ expectedVersion, acknowledgedPendingTaskIds }` | Verifies actual usable preview, pending-task acknowledgment and durable activation milestone; records review and returns the console destination. Repeated completion is idempotent. |

Error envelope: `{ code, message, retryable, requiredAction?, currentVersion?, details? }`, with sanitized bounded details. Use 400 invalid inputs, 401 session missing, 403 access denied, 404 unknown/inaccessible entity, 409 stale revision/conflicting state/reconfirmation, 422 unsupported range/capability, and 429 concurrency/rate limit. Avoid leaking raw provider responses.

Poll run state every two seconds while work is active, back off to ten seconds when waiting for user/provider retry, and stop polling hidden pages; refresh on focus and OAuth return. These are UI defaults, not worker execution timers. Use ordered events to animate only new transitions. Streaming is a later optimization, not a release-one dependency.

## Frontend deliverables and interaction contracts

- `OnboardingExperience`: switches between role and agent stages, restores a run, and handles sign-in/tenant navigation.
- `WorkRolePicker`: six cards, neutral selected state, skip, and persisted preference.
- `SetupConversation`: role-aware greeting, connector chips/text input, structured questions/results, and a visible workspace/client context.
- `SpecialistTaskList` / `SpecialistTaskCard`: stable keyed cards, account choice, OAuth action, progress stage, outcome, failed-account retry, and preserved expanded details.
- `FirstDataReview`: exact selected-source preview, coverage/omissions, finish and continue-later behavior. Shopee order revenue and advertising metrics have distinct labels.
- `useAgentRun`: authenticated snapshot polling, optimistic control states with server conflict recovery, deduplicated messages/actions, and event-sequence tracking. Never awards completion locally.

Use the approved neutral charcoal/card design with the shared console sans-serif typography and existing console motion constants: 160ms feedback, 240ms state changes, 480ms stage/progress transitions. Honor reduced motion, keyboard navigation, and 320px width. Retain card DOM identities so job updates do not reset expansion, selection, or focus. A provider consent screen remains its own trusted external screen.

## File-level work packages and review sequence

Paths below are proposed new files unless labeled existing. Read installed Next.js guides before implementation, per AGENTS.md.

| Milestone / reviewable change | Files and concrete changes | Gate before the next milestone |
| --- | --- | --- |
| **M1: persistence and state machine** | Extend existing `prisma/schema.prisma`; create additive migration; add `src/lib/agent/runs.ts`, `tasks.ts`, `events.ts`, `contracts.ts`, `scope.ts`; register models in existing `src/lib/tenant-guard.ts`; profile and run APIs. | Concurrent run creation yields one active run; stale transitions rejected; replay-safe events; real-Postgres isolation tests pass. |
| **M2: real onboarding UI and coordinator** | Add `src/app/(onboarding)/layout.tsx`, `onboarding/page.tsx`, and `agencies/[agencySlug]/onboarding/page.tsx` with agency slug validation; `src/components/onboarding/*`, `src/hooks/use-agent-run.ts`; new agent routes; `src/lib/agent/coordinator.ts` and `tools.ts`; extend existing `src/lib/agency-host.ts`, `src/lib/page-access-policy.ts` tests and `src/proxy.ts` integration coverage. Root providers/session behavior remain available; the console AppLayout/sidebar does not wrap this full-screen group. | Role survives reload; natural-language and direct selection agree; model outage falls back to controls; no simulated success statuses in the real route. |
| **M3: TikTok vertical slice** | Extend existing OAuth attempt/connect/callback services; add `src/lib/agent/specialists/tiktok.ts`; extract `src/lib/connection-account-service.ts` and `warehouse-import-submission.ts` from existing route logic; add callback/task linkage and onboarding backfill deferral. | One real authorized TikTok account is discovered, explicitly selected, imported once, queried, reviewed, and completed; ordinary Sources connect/reconnect still works. |
| **M4: multi-source and recovery** | Add Meta, Google, Shopee specialist adapters using existing clients; task-connection mapping; partial results/retry; continue-with-usable-data; warehouse outcome reconciliation. | Independent tasks resume after reload; Google multi-connection scope works; Shopee Ads unavailable does not falsely fail successful order ingestion; failed targets retry without duplicating successful data. |
| **M5: pilot release gate** | Agent feature flags/cohort controls, sanitized traces, task/event metrics, acceptance recording, operator recovery instructions. | Full e2e and tenant tests pass; a real provider walkthrough is recorded; deployed build/schema verified; enable only the reviewed provider/cohort. |

Planning allowance for M1–M5: approximately **8–14 engineering days** for one engineer familiar with this repo. This is a scoping estimate, not a date commitment. Provider approvals, test-account access, deployment permissions, and certification can add calendar time independently. Each milestone produces a separately reviewable change rather than one large agent rewrite.

## Release-one test and demonstration checklist

| Acceptance case | Pass evidence |
| --- | --- |
| New user role and skip | Stored preference/skip survives logout/reload; work category never changes membership permissions. |
| Tenant-host entry | `/onboarding` resolves to the correct agency workspace, requires authentication, and resumes there after provider return. |
| Real authorization | Provider-hosted consent; task-associated single-use attempt; encrypted connection; no tokens in message/event/browser responses. |
| OAuth failure boundaries | Expired, replayed, wrong-user/provider/workspace, missing state/cookie, session expiry, and provider denial produce the specified recovery state. |
| Selection boundaries | Only disclosed accounts can be selected; foreign connection/account identifiers rejected; changing scope requires a new revision. |
| No pre-selection import | Onboarding callback creates no backfill job; confirmation creates exactly one job; existing non-onboarding backfill behavior remains covered. |
| Job execution | Duplicate clicks attach once; leases protect concurrency; active job survives browser close; progress and data come from actual job/warehouse evidence. |
| Recovery | Provider outage, zero rows, partial rows, revoked token, bounded retry exhaustion, and failed-account retry match the recovery table. |
| Multi-source | TikTok success plus Meta denial can reach scoped review after acknowledgment; Meta never appears as imported. |
| Completion | Selected scope has usable warehouse evidence, first review is persisted, and repeated finish action is harmless. Unrelated existing rows cannot make an empty selected task appear successful. |
| Accessibility/visual | Full keyboard flow, focus retained during task updates, reduced-motion mode, 320px and desktop layouts, no script errors. |
| Regression | Existing Sources setup, reconnect, callback backfill, warehouse import/query, and activation behavior remain covered. |

Demo recording sequence: fresh account -> role choice -> TikTok consent -> two discovered accounts, one selected -> confirmed dates -> real import -> refresh while importing -> recovered task -> first data review -> console. Second recording: TikTok succeeds, Meta authorization denied, continue with TikTok, and reconnect Meta later. Show actual job identifiers and sanitized warehouse evidence outside the product UI for review. Synthetic e2e tests and live provider evidence are separate release artifacts.

## Agent-first expansion: next shipped workflow, not a collection of chatbots

After onboarding, ship **“Prepare this client's weekly report”** as the first agent-home workflow. It proves agent value using existing reporting capabilities and exposes exactly where user intervention is needed.

| Step | Agent action | User-facing result |
| --- | --- | --- |
| 1. Resolve scope | Ask for a client only if none is selected; show the exact seven-day report window. | “Weekly report for Client A, dates X–Y.” The client must belong to the workspace. |
| 2. Inspect readiness | Use existing client requirements, assignments, source health, window coverage, currency/timezone and destination evidence. | A concrete checklist of what is ready and what blocks the report. |
| 3. Repair eligible data gaps | Propose a bounded import for missing authorized accounts; execute once scope is authorized. Request reconnect only when necessary. | Source specialist tasks tied to the report run; no unexplained “working” message. |
| 4. Generate draft | Call the shared service behind `POST /api/reports/blueprint`, which already generates an immutable weekly snapshot. | Saved draft/report preview with figures derived from warehouse data, explicit scope and evidence links. |
| 5. Review | User opens the draft and approves the exact current snapshot through existing approval semantics. | Approved snapshot identity and clear outstanding prerequisites. A changed/stale snapshot invalidates approval. |
| 6. Deliver, only if authorized | Use the existing delivery service after showing the destination and concrete report. | Delivery receipt/outcome if eligible; otherwise explain the exact blocked gate. Sending is not assumed from drafting or snapshot approval. |

MVP prompts for agent home: “What needs attention?”, “Connect another source”, “Compare campaign spend for this client”, and “Prepare this client's weekly report”. They route to the same run/task model. Do not create a model per navigation page.

Proposed next route: `/agent`, with a contextual agent drawer on Sources, Data explorer, and Reports. Header always shows workspace, client (or explicitly workspace-wide), and window. The home presents a conversation plus active tasks/results. Existing console navigation stays available; the agent is the default path for accomplishing a goal and the pages are the inspection/editing surfaces.

## Follow-on milestones, exact tools, and release gates

| Increment | Concrete deliverable | Existing code reused / new tool contract | Acceptance gate | Planning allowance |
| --- | --- | --- | --- | --- |
| **A1: agent home** | `/agent`, workspace/client/window context, resume runs, task drawer and activity history. | Run APIs from onboarding; `get_source_health`, `get_reporting_readiness`; new server-authorized `list_clients`. | The same source task is visible/resumable from onboarding, home and Sources; changing a page filter never retargets a running task. | 2–4 days |
| **A2: evidence-based questions** | Scoped campaign comparisons and source-health answers, with data links and precise windows. | Existing `query_metrics`, warehouse query, performance report services; add typed comparison arguments for two explicit windows. | Figures match deterministic queries; mixed currency/timezone caveats are shown; unsupported identity/attribution requests remain outside the tool envelope. | 2–4 days |
| **A3: weekly report workflow** | The six-step workflow above; readiness, source repair tasks, immutable report draft, review/approval, explicit delivery action. | `report-blueprint.ts`, `report-approval.ts`, `report-delivery.ts`; tools `inspect_client_readiness`, `prepare_weekly_report`, `get_report_preview`, `approve_report`, `deliver_report`. | Draft can be generated/reopened from a run; exact snapshot approval and currentness hold; external delivery occurs only through applicable explicit authorization and readiness gates. | 4–6 days |
| **A4: bounded recovery** | “Fix this stale source” with diagnosis, retry progress, reconnect when required, and persisted outcome. | Existing source health, import lease/retry and account-health services; tools `diagnose_source`, `retry_failed_targets`, `request_reconnect`. | A known transient failure recovers once; expired consent presents reconnect; retries obey budgets/limits and cannot loop forever. | 2–3 days |
| **A5: recurring client work** | User saves weekly report/freshness policies; scheduled occurrences create visible runs and notify on action/completion/failure. | Existing report schedules, occurrence deduplication, dispatch/delivery services. New policy records specify scope, timezone, schedule and authorization boundaries. | Repeated cron calls create one occurrence; user can pause; a saved policy never expands to new accounts/recipients without authorization; notification meaning is explicit. | 3–5 days |

These are incremental engineering estimates, conditional on approved earlier milestones and existing provider/report eligibility. Validate the scheduling execution path before offering a cadence; the current deeper analyst queue's nightly timing must never be advertised as instant execution.

## Operating policies and success measurements

Default permission matrix: read scoped data/health without repeat prompts; draft internal artifacts on request; execute an explicitly confirmed import/retry within the stored scope; user performs OAuth consent; user authorizes external delivery through an exact result or a saved policy. Model-generated text cannot serve as an approval record. Current ad-budget writes remain disabled.

Record run ID, task ID, actor, scope revision, tool, job/evidence reference, transition, latency, retry count, model usage/cost and sanitized error. Never log provider tokens/passwords. Set operator alerts for prolonged queued/running jobs using existing lease/health behavior, not arbitrary frontend timers. Define task/event/message retention in the migration/operating review before rollout.

Pilot measures: role-to-source-choice conversion; consent return success; account-confirmation-to-import success; time to first usable data excluding time waiting on user; resume success after refresh; partial/zero-row rates; first-review completion; successful weekly draft/approval/delivery counts; and cost per completed run. Establish a pilot baseline before committing to numerical improvement targets.

## Dependencies and decisions remaining

Implementation defaults above are selected so work can start without reopening routine design choices. The actual blocking external dependencies are: an enabled TikTok app and authorized test advertiser with historical data; a pilot workspace/plan; database migration/deployment access; and a permitted live validation window. Use existing deployment-managed secrets, never ask for tokens in chat. Meta/Google/Shopee rollout each needs its own provider evidence and approval status.

Before A3 delivery, choose the intended destination/recipient through the existing product controls and verify its delivery prerequisites. Before A5, agree on timezone/cadence and saved authorization policy. These decisions are needed at those milestones, not prerequisites for building onboarding persistence and the UI now.

## Appendix: previous source audit and implementation context

Date: 2026-09-30

## Outcome and current boundary

New users identify their work, choose sources through a setup conversation, approve provider access, confirm accounts and an import window, and review their first usable data. One coordinator delegates provider-specific work and presents durable progress. Existing Sources, Data explorer, Reports, and Settings remain available for inspection and direct control.

The approved interactive concept demonstrates the experience with simulated data. This document records a source-reviewed implementation plan; the onboarding coordinator, specialist tools, and dedicated onboarding route are not implemented by this document. Live provider authorization and import still need separate end-to-end validation.

## Existing foundation and flow corrections

| Existing capability | Implementation implication |
| --- | --- |
| `src/app/api/auth/connect/route.ts` authenticates the user, checks workspace/provider access, and creates an OAuth attempt | Reuse the provider adapter and access checks. Add a server-validated relation to the onboarding task. |
| `src/lib/oauth-attempt.ts` binds a short-lived, single-use state token to user, workspace, and provider | Preserve this boundary. Browser query parameters and model output must not select the callback's workspace. |
| `src/app/api/auth/callback/route.ts` stores encrypted credentials and redirects to `/sources/setup` | For a validated onboarding attempt, resume its task on a fixed internal onboarding route. Ordinary connect/reconnect behavior retains its existing entry points. |
| The OAuth callback already calls `enqueueOauthWarehouseBackfill` | For onboarding-linked attempts, defer initial import until account selection and the effective window are confirmed. This requires an explicit branch, not merely a new redirect. Avoid creating both a callback backfill and an onboarding import for the same action. |
| A provider callback can create multiple connections, particularly Google Ads | A specialist task must reference a set of resulting connection IDs and reconcile the user's selected account scope across that set. Do not assume one provider means one connection. |
| `/api/connections/[id]/accounts` discovers and validates advertising account selection | Use shared service logic behind this route. Marketplace shop identity is provider-specific; do not assume the ads account-list endpoint supports Shopee. |
| `/api/data-explorer/warehouse/import-batch` supports durable jobs, idempotency, plan limits, and concurrency limits | Submit confirmed onboarding imports through the existing job machinery. Report the returned effective range and queued state accurately. |
| `/api/data-explorer/warehouse/jobs/[id]` exposes permission-checked progress | Poll these jobs initially. Streaming can be added later; it must present the same persisted facts. |
| `src/lib/pilot-activation.ts` allows one usable source with recent data to reach review | Do not require every selected specialist to finish. Let users explicitly defer blocked sources and review available data with visible scope and omissions. |
| The current analyst uses typed tools; its deeper jobs run nightly | Reuse tool contracts and evidence, not the nightly execution schedule for interactive setup. A conversational planning/model layer is new work. |

OAuth consent only connects the source; it does not prove successful import or report readiness. An empty import is a legitimate result to explain and investigate, not a fabricated success. A first dashboard review is also distinct from a complete, reconciled client report or live connector certification.

## Proposed end-to-end flow

1. Authenticate into Monstera and resolve a workspace the user can access. Ask users with several workspaces which to set up; preserve that choice through external redirects.
2. Ask about their work. Save the answer as an editable user preference, separate from membership/administrative permissions. Allow skipping this question.
3. Create or resume a workspace-scoped onboarding session. The coordinator asks which sources to connect, using deployment configuration and workspace entitlements to show supported choices.
4. Create one provider specialist task per chosen source. Reuse existing authorized connections when appropriate and ask which accounts to include. Adding another account remains possible.
5. A user-initiated Connect action creates an OAuth attempt linked to its specialist task. Validate the user, session, workspace, provider, and current task state on the server. Prevent overlapping attempts for the same provider in this session; current fallback cookies are named per provider.
6. The provider hosts sign-in, two-factor authentication, and consent. Monstera never requests these credentials in chat.
7. On callback, validate and consume the OAuth attempt; recheck workspace permission; exchange the code and store encrypted tokens through existing services. Link all resulting connections to the task. Resume onboarding through a fixed route compatible with tenant-host routing.
8. The specialist discovers allowed accounts or the authorized shop. The user confirms account scope and an effective date window after provider and plan limits are applied. No import executes on the onboarding callback before this confirmation.
9. Persist an import action keyed to the confirmed task revision, account scope, and window. Repeated clicks, page reloads, and worker retries attach to the existing job rather than creating duplicate work. A changed scope creates a new revision, not an accidental replay.
10. Run the existing durable warehouse job, respecting provider/connection leases, rate limits, workspace concurrency, and retry rules. Specialists progress independently within those limits.
11. Check persisted import outcomes, recent rows, source freshness, and relevant quality evidence. Surface queued, partial, empty, blocked, and failed outcomes distinctly. Do not use an elapsed animation timer to award readiness.
12. Offer the first review when usable data exists. Explain which sources, accounts, dates, currencies, and timezones are included. Allow explicitly deferring unresolved sources. Complete onboarding from durable review/activation facts while retaining pending tasks in the workspace activity view.

Refresh, returning from OAuth, sign-in expiry, or reopening the app must resume the same session. A denied or expired authorization leaves the task waiting for the user. A retriable provider failure permits a bounded retry; revoked permissions require a reconnect. Stopping setup prevents new work from being launched and reports honestly whether an existing import can still be stopped.

## Proposed persisted records and execution contract

- User work preference: selected category and optional context, editable independently of access roles.
- Onboarding session: authenticated initiator, workspace, preferences/context snapshot, selected providers, session state, and review/defer outcome.
- Specialist task: provider, session, current state, OAuth attempt relation, resulting connection IDs, selected accounts, requested/effective range, confirmed revision, import job references, sanitized outcome, and timestamps.
- Ordered task events: stable task ID and sequence, state change, user action needed, and evidence reference. The interface consumes these facts after reload; transient visual animation is not persisted as business state.
- Action record: actor, authorized scope, tool, confirmed parameters, idempotency key, execution status, and outcome. Policy checks occur at execution time, including after queued work resumes.

Suggested specialist states: `waiting_authorization`, `discovering_accounts`, `waiting_selection`, `queued`, `importing`, `verifying`, `ready`, `needs_attention`, and `deferred`. Required user actions and retryable errors have distinct structured reasons. State transitions are validated server-side and guarded against stale updates.

Start with a focused onboarding workflow and persisted sessions/tasks. Do not send arbitrary new job types to the existing worker, which currently executes analyst turns. Reuse warehouse workers for imports. Extract shared business services for tools rather than having a worker impersonate a browser session or duplicate authenticated HTTP handlers.

## Coordinator and specialist responsibilities

The coordinator interprets intent, asks necessary questions, proposes an explicit scope, routes actions to allowed tools, and explains results. It cannot declare a connection/import successful without server evidence.

Specialists are focused provider workflows around existing adapters. They need not each run a separate language model. Use deterministic services for OAuth, account selection, imports, and verification; use a model when interpretation or explanation benefits from it. This reduces cost and makes recovery predictable.

Tools receive authenticated actor, workspace, optional client scope, session/task identity, and validated arguments. They use credentials only inside trusted server services. Model-facing output contains connection identifiers, sanitized status, allowed account metadata, and evidence; no raw tokens, secrets, or broad database/network access.

Suggested initial tools: list eligible providers/connections; begin provider authorization; discover accounts; save confirmed selection; submit initial import; inspect import/task status; inspect source health; and retrieve a scoped first-report preview. User-initiated consent and account confirmation are recorded actions in the workflow.

## Implementation order and acceptance gates

1. Implement user preference, durable onboarding sessions/tasks, route gating/resume behavior, and the approved two-stage UI with server-derived task status.
2. Wire one enabled advertising provider through the full journey, including callback/task linkage, deferred onboarding backfill, selection, idempotent durable import, and return from OAuth. Choose the provider whose app configuration and authorized test account are available; configuration flags alone do not establish live certification.
3. Validate denial, expired/replayed state, session expiry, permission changes, cross-workspace identifiers, multi-connection callbacks, duplicate submissions, empty/partial imports, reload/resume, and account/date changes. Verify actual provider authorization and warehouse data separately from simulated UI tests.
4. Add other enabled providers and independent task progress. Respect limits rather than promising unlimited parallel work. Keep source-specific authorization/discovery behavior, particularly Shopee shops and Ads API availability.
5. Validate partial onboarding completion and first-report scope. Persist the actual review and leave unresolved connectors actionable afterward.

No production deployment or provider credentials are changed by this plan. Repository connector readiness records and live certification gates remain applicable.

## Make Monstera agent-first after onboarding

The shared foundation is: **intent -> scoped plan -> allowed tools -> durable execution -> evidence -> user-visible outcome**. Put this workflow across the existing product rather than creating a separate conversational data store.

| Product increment | User experience | Foundation reused |
| --- | --- | --- |
| Workspace agent home | “What needs attention?” and contextual actions to refresh data or review a report | Persistent coordinator, workspace/client context, source-health tools, task activity |
| Data questions | “Compare this client's campaign spend week over week” | Scoped metric queries, reporting readiness, explicit window/timezone/currency, evidence-backed summaries |
| Report preparation | “Prepare this client's weekly report” produces a reviewable report and explains missing prerequisites | Current report generation, requirements, readiness, approval and delivery services |
| Data recovery | “Fix this stale source” diagnoses it and performs authorized bounded retries or presents reconnect | Source health, existing sync jobs, error taxonomy, specialist task recovery |
| Recurring work | User configures a weekly report or freshness check and sees each run's result | Durable schedules, stored scope, execution policy, activity history and meaningful notifications |

Recommended order: onboarding -> workspace agent home and read-only questions -> report drafting -> bounded recovery -> user-configured recurring workflows. Start with the agency/client reporting loop already supported by Monstera.

The agent appears throughout Sources, Data explorer, and Reports with the page's selected workspace/client/window as explicit context. A common activity view shows what is happening, which input is needed, outcomes, and links to the underlying data. Keep direct controls available for users who want to inspect or adjust the same work.

For external delivery, publication, or spending changes, show the concrete result and require the applicable user authorization or saved policy. Ad-budget writes are currently outside the analyst tool envelope and are not part of this roadmap increment. Internal reads, drafts, and specifically authorized bounded actions should not repeatedly ask for confirmation.

Use existing AI budgets and feature controls, limit model turns/retries, and record tool latency and sanitized failures. Track time to first usable data, successful resume after OAuth, initial import outcomes, user actions per setup, report-review completion, and cost per successful workflow. Measure real provider outcomes independently from frontend task animations.

## Review evidence

The source review covered OAuth entry/callback/state binding, callback backfill scheduling, account selection, durable import submission/status, pilot activation, analyst tools, and the current nightly worker. Existing focused tests passed: **50 tests, 0 failures**, across `oauth-workspace-preservation.test.ts`, `connection-account-selection.test.ts`, `pilot-activation.test.ts`, and `warehouse-import-job.test.ts`. Coverage includes state replay/provider/user mismatch, selected account validation, activation with one usable source, job idempotency, lease fencing, tenant scope, and bounded/partial retries. These mocked/unit checks do not prove live provider access, production configuration, or the proposed new coordinator.

### M4 provider increment — 2026-09-30

Implemented Google multi-connection leaf selection with exact connection/account approvals, shared-worker selection enforcement and failed-only retry across roots. Implemented Shopee signed shop verification and daily order review separated from optional catalog/Ads outcomes. Existing TikTok and Meta paths retain their scope and recovery contracts. See `AGENT_ONBOARDING_M4.md`. A fresh guided continuation for deferred sources is implemented. Live provider walkthroughs remain outstanding; M5 rollout stays gated.
