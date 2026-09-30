# Onboarding pilot release — 2026-10-01

Release scope: role selection, charcoal introduction, source-agent setup, task-linked provider consent, explicit account/date approvals, durable imports, evidence review, failed-only recovery and deferred-source continuation. This release is integrated with the latest main startup and reporting behavior. Pricing, billing and the separate agent-console foundation are excluded.

## Pilot access

Workspace: **Monstera Onboarding Pilot**, ID `monstera-onboarding-pilot-20261001`, slug `onboarding-pilot-20261001`. Its owner matches the authenticated Git identity in the existing production User table. No other user's workspace is selected. The pilot inherits that owner's existing professional plan within its workspace limit. Existing connections and client warehouse data are not copied into it.

Production requires `ENABLE_AGENT_ONBOARDING=1` and an explicit `AGENT_ONBOARDING_WORKSPACE_IDS` allowlist. The initial allowlist contains only this workspace. Page choices, run/task operations, task-linked OAuth and profile endpoints enforce pilot membership. The console hides the setup link when its active workspace is outside the cohort. An empty cohort denies all production workspaces; ordinary Sources remains available.

## Checks before deployment

155 targeted agent, OAuth, scope, recovery, import and route checks passed; 62 provider/tenant/import regression checks passed. The explicit production rollout test passed again after its TypeScript repair. ESLint reports zero errors (69 existing warnings), and the optimized production build passes. All committed migrations apply successfully to a fresh local PostgreSQL database. Additive production migrations are the onboarding foundation and OAuth task linkage; no destructive reset or schema push is used.

## Rollback and acceptance

Disable `ENABLE_AGENT_ONBOARDING` and redeploy the last known release, or remove the pilot ID from the cohort and redeploy. Keep the additive schema and existing run history. Submitted import jobs retain ordinary durable-worker behavior. Do not drop the new tables as a feature rollback.

Deployment availability is separate from live provider acceptance. No provider is certified until consent, exact account/date scope and actual imported data pass `AGENT_ONBOARDING_LIVE_ACCEPTANCE.md`. Shopee requires valid credentials for the selected environment; absent explicit live partner credentials must not be worked around with generic aliases or test keys.
