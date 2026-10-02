# Console release agenda — 2026-10-02

This record tracks implementation separately from live acceptance. The console shell from PR #200 is on main. PR #206 contains the Connected Data Health foundation, daily checking/recovery journey and production-component preview; its live enablement remains off.

## Current follow-up: saved monitoring setup

Customers can save selected sources/accounts without approving monitoring, return to the saved choices, edit them, and separately approve the policy. Save retries use one durable draft request identity. Updates validate workspace membership, current account grants and draft version, retain scope history, and never activate monitoring. Summary responses expose only the current scope revision; old choices cannot reappear as current coverage. Approval remains a separate owner/admin action through the existing confirmation endpoint.

Acceptance: isolated PostgreSQL tests exercise duplicate/concurrent saves, reload from server state, revisions, stale edits, membership/author restrictions, account grants, feature-disabled approval and the authenticated PATCH boundary. Synthetic browser checks cover draft selection, fresh consent, save without approval, failure retry, mobile layout and no live requests. Existing console browser and health-journey suites are regression checks. These are local implementation proofs.

## Remaining build order

1. Explicit onboarding handoff: carry the saved goal, run reference, workspace and confirmed account scope into the first useful result or a factual blocker, then offer this same saved monitoring draft. Do not infer ongoing authorization from OAuth or setup completion.
2. Responsibility/case inspection: customer-visible scope, policy revision and activity history, plus clear account-specific coverage and delayed-check states. Reuse stored events and evidence.
3. Guided setup A1: deterministic supported intents, reviewed English/Vietnamese help and adjudicated evaluation fixtures. Add bounded language interpretation only after those contracts are reviewed.
4. Pilot preparation: provider/cohort controls, operator acceptance record, pause/rollback rehearsal and measurement of useful findings, recovery and customer effort. Live certification and scheduler observation require authorized operator/account access.
5. Budget/CPA monitoring follows acceptance of the complete health journey. Revenue monitoring, report delivery and campaign/budget changes keep their separate semantics and authorization gates.

## Owner-run acceptance still required

One authorized live provider account and destination session; provider-versus-warehouse reconciliation and inspected rendered output; deployed scheduler/worker cadence and recovery rehearsal. Polar/PayOS production charging and payouts plus Paddle migration/customer communication remain paid-launch work. Local tests do not close those gates.
