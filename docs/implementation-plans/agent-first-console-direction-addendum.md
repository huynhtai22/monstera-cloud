# Agent-first console: release direction and acceptance addendum

Date: 2026-10-01. Status: customer feedback incorporated into planning; no runtime enablement.

This addendum refines [the main plan](agent-first-console.md). It takes precedence where the older plan conflicts with the release scope, package sequence or acceptance status below. The agent currently closing C3 should finish that package and report evidence before beginning the next package. C4 and the minimum C5 interface form one subsequent acceptance journey. This document does not authorize deployment or production activation.

## 1. C3 implementation closure and acceptance record

C3 local implementation acceptance is **complete and verified** on commit `68fadf7366ab1ac967394868d1fe3b55c6ad9039` via clean-checkout verification on an isolated fresh PostgreSQL database. Live provider certification remains blocked pending live reportable accounts and is tracked as an open external gate.

| Required closure | Acceptance evidence | Status |
| --- | --- | --- |
| Preserve unknown TikTok conversion, attribution, revenue and availability definitions | Both single-row and bulk ingestion preserve unknown values (`undefined`/`null`). Verified definitions require explicit origin provenance (`provider_response`, `provider_request`, `account_configuration`). Evaluator rejects unverified provenance origins. No default manufacturing. | Verified in `sync-connection.ts`, `tiktok-business.ts`, `evidence.ts`, `sync-connection.test.ts`. |
| Test ingestion through evaluation | Provider-shaped fixtures enter `syncConnectionData` (single-row) and bulk ingestion, persist warehouse rows, and are evaluated through `buildCanonicalQualityEvidence`. Unknown or conflicting semantics block affected metrics; verified matching semantics pass. Unknown availability is never stamped final. | Verified in `src/lib/agent-console/ingestion-acceptance.pg.integration.test.ts` (all test cases passing on real PostgreSQL). |
| Reject disappearing data-through evidence | Missing or removed `lastDataThrough` rejects approval consumption (`evidence_freshness_unverified` / `evidence_missing`). All scoped connections must exist and pass canonical health checks. Test-clock behavior is strictly local. | Verified in `operations.ts` and `persistence.pg.integration.test.ts`. |
| Separate minimum conversion count from monetary CPA target | Independent `cpaFloor` validation enforces strict finite non-negative numbers, preserving fractional conversion semantics. Monetary CPA target never supplies denominator floor. Invalid configuration rejects immediately. | Verified in `rules/cpa.ts`, `evidence.ts`, and `rules.test.ts`. |

The closure report records commit `68fadf7366ab1ac967394868d1fe3b55c6ad9039`, migration IDs (`20261001000000`, `20261001010000`, `20261001020000` + prerequisite onboarding migrations), clean checkout test suite results (62/62 passing across 5 suites via `node scripts/run-test-suite.mjs src/lib/agent-console/contracts.test.ts src/lib/agent-console/monitor-evidence.test.ts src/lib/tenant-guard-schema.test.ts src/lib/tenant-guard.test.ts src/lib/agent-console/persistence.pg.integration.test.ts src/lib/agent-console/monitor-evidence.pg.integration.test.ts src/lib/agent-console/routes.pg.integration.test.ts`), intermittent failure not reproduced; cause unconfirmed (10 consecutive stress runs passed 590/590 assertions), typecheck (`npx tsc --noEmit`), lint (`npm run lint`), and build (`npm run build`). Local implementation acceptance does not enable live certification or production recovery.

## 2. First complete journey: “Keep my connected data healthy”

After C3 closure, deliver C4 execution alongside only the C5 interface necessary for this journey. Reuse the warehouse, import jobs and worker, analysis, scoped events, approvals and durable case foundation wherever they meet the contracts. Avoid a parallel import or recovery engine.

| Step | Required behavior | Acceptance proof |
| --- | --- | --- |
| Select and confirm | Customer chooses workspace, sources/accounts, cadence and permitted actions. Show a structured policy preview and require explicit approval. Saving a draft grants no execution authority. | Reload preserves the draft; worker cannot execute before approval. |
| Schedule and detect | Deployed dispatcher records due work and a worker performs a bounded scoped check. Detect a real persisted connection/import failure or incomplete outcome. | A controlled failure creates a persisted evaluation and one deduplicated actionable case, not a display-only simulation. |
| Explain | Console shows the affected scope, factual problem, evidence, blocker, allowed next action and history. | Customer can understand what happened and what they need to do without opening technical job screens. |
| Recover or reconnect | Revalidate policy, membership, account scope, source capability and evidence before an approved bounded recovery. Credentials requiring customer action produce a reconnect request. | Authorized import uses the existing durable job boundary; unauthorized recovery does not dispatch. Reconnect completion triggers verification. |
| Verify and close | Confirm job outcome plus actual restored health and required account/date coverage. Submission, OAuth success and partial import are insufficient. | Successful verification closes the case with evidence; failed or partial verification keeps it open. Manual resolution is separately labelled. |
| Pause and inspect | Customer can pause the responsibility and inspect checks, policy changes, actions and verification history. | No new side effect begins after pause commits and execution revalidation. Already-running work is disclosed and reconciled. Reload shows the same history. |

Gate C6 budget/CPA expansion on acceptance of this complete journey. C4 backend completion and C5 screen completion alone do not satisfy it. Revenue monitoring and external report delivery remain later packages.

## 3. Explicit onboarding handoff

Persist and carry the selected goal, workspace, confirmed accounts and onboarding run reference into the first useful analysis. The analysis uses verified available data, states blockers and limitations, and keeps business goals visible. If analysis cannot run, show the specific blocker rather than treating connection success as a useful result.

Offer a draft ongoing responsibility after the first result. The customer chooses and confirms accounts, cadence, retry limits and permitted actions. Summarize what can run automatically, what requires approval or reconnect, and how to pause. Persist the confirmed scope and authorization revisions.

OAuth consent authorizes connection access. Onboarding completion records onboarding outcome. Neither silently authorizes scheduled checks, ongoing analysis or recovery. Changes to workspace, accounts, cadence or permissions must use the applicable explicit confirmation and policy-revision rules. The customer may finish onboarding without enabling an ongoing agent.

## 4. UI must show operational truth

Show last successful check, data-through coverage, next scheduled check, active blockers, last attempted check and delayed status. For multiple accounts, disclose partial coverage and the affected scope rather than presenting a misleading single healthy date. Use explicit unknown states when evidence is absent.

| State | Meaning |
| --- | --- |
| Connected | Provider access is established; imports and verification may still be pending. |
| Imported | Warehouse job persisted an outcome, including disclosed partial or failed targets. |
| Verified | Scoped health and required coverage passed a recorded verification. |
| Monitoring active | Explicit responsibility authorization is active and the deployed dispatcher/worker supports its displayed cadence. |

Approval, worker availability and check freshness remain separately visible. When the scheduler is unavailable or overdue, show delayed/unavailable status, last successful work and the customer's next option; do not imply an all-clear state. Paused status overrides the monitoring-active label.

Daily cadence is the initial default subject to deployed capacity verification. Do not advertise continuous or more frequent monitoring based only on local tests, an enabled flag or a queued job. Show the actual supported cadence and next due time. Reuse the main plan's measured scheduling targets; they are evaluation targets, not guarantees of provider freshness.

## 5. Failure acceptance before pilot enablement

| Failure exercise | Required outcome |
| --- | --- |
| Duplicate dispatch, replay or simultaneous workers | One logical operation/case and no duplicate side effect; idempotency conflicts reject. |
| Crash before/after submission, lost or expired lease | Durable reconciliation identifies existing work; stale worker cannot write; unknown outcome is reconciled before retry. |
| Expired/revoked authorization or membership loss | New execution blocks; evidence and history explain why. |
| Changed account scope or cross-workspace identifiers | Old approval cannot authorize new scope; API, worker, jobs and events preserve tenant isolation. |
| Stale evidence, correction or missing data-through | Revalidation blocks misleading conclusions or execution; current evidence is required. |
| Partial import or failed sibling account/date | Case remains open for uncovered targets; a narrow retry cannot falsely resolve the original incident. |
| Scheduler outage and restored dispatch | UI shows delay; recovery uses deduplicated bounded catch-up; missed checks are not reported as successful. |
| Pause with queued/in-flight work | No newly authorized side effect after pause; already-running work remains inspectable and reconciled. |

Prove these against real service boundaries and authenticated browser journeys using isolated failure injection, then rehearse the deployed scheduler/worker. Before a customer pilot, certify one provider against authorized live accounts and verify the complete journey. Report synthetic and live results separately. The release gate permits no unresolved unauthorized action, cross-workspace access, duplicate side effect or false verified resolution.

## 6. Rollout and customer value

Keep onboarding availability separate from ongoing-agent enablement. Use separate monitoring/recovery, provider and cohort controls. Begin with one certified provider and a small opt-in cohort bounded by measured worker capacity; the original five-workspace/20-responsibility ceiling remains a proposed maximum, not an automatic entitlement. Start in shadow/assisted operation before enabling saved-policy recovery. Pause and rollback must be rehearsed.

Production activation requires `ENABLE_AGENT_CONSOLE=1` for the authenticated console APIs, `ENABLE_AGENT_CONSOLE_MONITORING=1` and `ENABLE_AGENT_CONSOLE_WORKER=1` in the application, and a non-empty `AGENT_CONSOLE_WORKSPACE_IDS` allowlist. The pilot-cron workflow runs the dedicated 15-minute dispatcher only when its matching `ENABLE_AGENT_CONSOLE_MONITORING` and `ENABLE_AGENT_CONSOLE_WORKER` repository variables are both `1`; configure the scoped `CRON_SECRET_AGENT_CONSOLE` in both the application and GitHub Actions. Keep these values off until the cohort, worker capacity, and live-provider gate are approved. Outside the production allowlist, customers cannot confirm or resume a responsibility and the dispatcher will not evaluate its data.

| Measure | Definition |
| --- | --- |
| Time to first useful result | Time from onboarding goal selection to the first verified goal-relevant analysis or actionable finding; report blocked/abandoned journeys separately. Also track connection and authorization milestones. |
| Useful versus noisy findings | Human-reviewed unique actionable findings divided by all reviewed findings; disclose sample size, repeats, false positives and synthetic versus live origin. |
| Recovery success | Eligible attempted recovery incidents verified restored divided by eligible attempted incidents; distinguish customer reconnect, automatic recovery, partial outcomes and still-open cases. |
| Customer effort saved | Observed active customer time and required interactions for the journey compared with the same manual task baseline. Report sample size and collection method; do not infer time saved from case count. |

Track scheduling reliability, verification latency and unresolved-case age alongside customer value. Expand only after the main plan's trust, usefulness and scheduling gates pass for the actual provider/cohort/build. Campaign/budget writes and external report delivery remain outside this first release and disabled.

## 7. Updated delivery sequence

1. Close C3 with a reproducible evidence bundle and explicit local/live limitations.
2. Build and accept the C4 plus minimum C5 connected-data-health journey, including onboarding handoff and failure handling.
3. Certify one provider and run the C7 health pilot with measured value and independent enablement controls.
4. Expand C5 where observed customer needs justify it; add C6 budget/CPA monitoring behind separate acceptance and capability gates.
5. Consider C8 revenue/reporting only after its semantics and delivery contracts pass. Business writes require their own future authorization design.

This changes the first pilot's scope and sequence, not the trust requirements of later packages. Re-estimate effort after C3 closure and vertical-slice discovery rather than treating the original aggregate allowance as a release date.

## 8. Guided assistant integration

The [guided onboarding assistant execution plan](onboarding-guided-assistant.md) is a separate A1–A5 workstream integrated into the customer flow. Begin A1 behavior, reviewed help and bilingual acceptance fixtures while C3 closes. Do not introduce a model before those contracts are ready. Assistant delivery does not alter C3 acceptance or the C4 plus minimum C5 journey gate.

The combined flow is:

1. Customer selects a goal and workspace in onboarding.
2. English/Vietnamese assistant explains source choices, access and actual progress using sanitized bounded context and server facts.
3. Server validates proposed action cards; customer confirms through existing source, OAuth, account/date, import or recovery APIs.
4. Existing warehouse and analysis services produce a verified first useful result or an explicit blocker. Setup chat links to that result; it does not invent financial analysis.
5. Customer may continue saved setup or review a draft ongoing responsibility carrying the goal, workspace and confirmed accounts.
6. Customer separately confirms ongoing accounts, supported cadence and permitted actions before C4 execution can begin. C5 shows the resulting responsibility, cases and history.

Pause/resume setup cards act only on the onboarding run. Ongoing responsibility pause/resume uses its own authenticated controls and policy semantics. OAuth consent, onboarding completion, assistant messages and assistant cohort membership never activate ongoing monitoring or recovery.

Reuse owned run scope, durable assistant requests, saved setup state and existing action APIs; do not create a second responsibility model, recurring scheduler, import engine or competing source-health vocabulary. Share connected/imported/verified/monitoring-active definitions, stale-state handling, reviewed help and action-card conventions. Model output never establishes health, verification or permission.

Assistant acceptance is independent: at least 60 adjudicated English/Vietnamese cases, at least 95% supported-intent accuracy, zero unauthorized actions or fabricated completion, plus duplicate-request, permission, timeout/fallback, keyboard/IME, mobile, reload and reduced-motion tests. A4 proves message → validated proposal → customer confirmation → actual persisted outcome → verification. Report fixture, sandbox and live results separately.

Use independent assistant flag/cohort controls (`ENABLE_ONBOARDING_LLM`, `ONBOARDING_LLM_WORKSPACE_IDS`) alongside onboarding and ongoing-agent controls. Assistant rollback restores deterministic help/direct controls without removing runs, approvals or ongoing responsibilities. Ongoing-agent rollback preserves setup availability. Pilot metrics for the assistant cover usefulness, intent/factual accuracy, latency, fallback and cost; the health pilot separately measures recovery, findings and customer effort. A5 cannot certify provider monitoring or authorize the C7 health pilot.
