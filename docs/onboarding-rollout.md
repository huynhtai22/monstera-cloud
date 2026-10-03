# Guided workspace setup rollout

## Release scope

Keep the Aurora pilot enabled while shipping the permanent Settings → Workspace → Workspace setup entry and Add another source for completed setups. A follow-up keeps its original workspace and reporting client, creates no connection or import automatically, and requires fresh account/date approval. Completed runs remain immutable. Repeated clicks resume the same follow-up, including a paused one.

The Settings entry remains visible outside the pilot, explains availability, and links to existing source management. Viewers can inspect setup but cannot create a follow-up or authorize connections.

## Stage 1 — Aurora acceptance

Owner: product owner and release engineer. Test a new account, an existing account, a viewer, a paused run, and a completed run with and without deferred sources. Verify Settings uses the selected workspace, agency links preserve the tenant, double-clicks cannot create duplicate follow-ups, and connection consent and warehouse import approval remain separate.

Gate: all automated authorization and continuation tests pass; manual journeys show no dead ends, incorrect workspace, false data-ready state, or new imports without explicit approval. Resolve Aurora's zero-row import by reviewing actual account activity and dates; do not label an empty result a completed first result.

## Stage 2 — invited cohort

Add 5–10 explicitly invited workspace IDs to AGENT_ONBOARDING_WORKSPACE_IDS; keep ENABLE_AGENT_ONBOARDING=1. Do not clear the allowlist: an empty production allowlist disables access. Existing customers keep their console and opt into setup through Settings; do not reset profiles or prior setup runs.

Observe at least seven days and 20 started setups. Review existing run/task events and warehouse jobs daily: setup starts, first approved import, verified-data readiness, completed review, pauses/deferred sources, authorization failures, import failures, and time to first verified result. Separate no-activity/zero-row outcomes from system failures.

Gate: zero tenant-isolation or consent incidents, zero duplicate imports caused by follow-up entry, at least 90% of attempted authorizations succeed excluding user cancellation, and at least 80% of approved imports from accounts with confirmed activity reach a verified result. Investigate every blocking failure before expanding. These are proposed release gates, not current measured performance.

## Stage 3 — new-workspace rollout

Before expansion, implement and test an explicit enrollment mechanism for newly created workspaces, independent of automatic-entry eligibility. Current production access is an exact workspace allowlist and does not automatically enroll registrations. Start with a small cohort, then increase only after the Stage 2 gates pass. Keep established accounts on voluntary entry; profile completion, existing runs, warehouse rows, and viewer role must continue suppressing automatic redirects.

Require tested signup → workspace creation → enrollment → console entry for password and Google sign-in, invited members, and agency hosts. Record rollout enrollment so it can be audited and reversed. No new OAuth scopes or agent permissions are part of rollout.

## Stage 4 — general availability

Introduce an explicit, tested all-workspaces rollout mode before general availability; do not reinterpret an empty allowlist. Expand through 10%, 25%, then 100% of new workspaces, holding each step until sufficient real setup attempts meet the gates. Retain permanent voluntary entry for existing customers and support assisted recovery.

## Rollback and support

Remove affected workspace IDs from the allowlist to stop new onboarding access, or set ENABLE_AGENT_ONBOARDING=0 for a full stop. Preserve profiles, runs, connections, and warehouse data. Existing Sources and Data explorer remain available. Disabling onboarding does not cancel approved imports already running; inspect the warehouse queue separately. Confirm Settings shows its source-management fallback after the change.

For each support incident capture workspace/run/task identifiers, provider, failed stage and timestamp; do not collect passwords or access tokens. Escalate tenant-scope, authorization, or unexpected-import incidents immediately and halt cohort expansion.
