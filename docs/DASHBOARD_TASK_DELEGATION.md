# Dashboard task delegation

The dashboard is the entry point for returning customers to prepare reporting data. This first increment uses the existing saved onboarding runs, provider consent, confirmed account/date scopes, import worker, and warehouse review. It does not create a parallel onboarding flow.

## Customer journey

- New customers keep the existing signup → workspace → desired outcome → consent and client/account scope → approved import → warehouse review → dashboard journey.
- Returning customers choose a reporting outcome and client in the dashboard, optionally add context, and save a task. The task is visible beneath the composer. **Continue task** opens the same run in guided setup, where source access and accounts/dates are approved.
- Reloading and reopening the console reads the saved run. Paused work stays paused. A new task is available only after the latest setup is completed, and starts without copied source/import approvals.
- Reports contains links to these reporting recipes. Settings → Workspace explains task permissions and links to workspace roles and existing source management.

## What the native cards show

`MonsteraTaskCard` is an owned disclosure component, inspired by the expandable task/status pattern documented at [Planes Tool Call Card](https://useplanes.com/components/tool-call-card). No gated Planes source, registry component, license or new runtime dependency is used.

The card shows a provider, actual state, approved account count, date window, and recorded import counters. Running glyphs animate only for discovery/import/verification work. Paused setup stops decorative activity while acknowledging that imports already started may still run. Completion requires a ready state, verified warehouse result, and positive row count. It never equates import completion with provider reconciliation, complete reporting coverage or inspected destination output. Those remain separate checks in Reports and the live reporting runbook.

Expansion uses a CSS grid height transition with opacity; reduced motion disables both. Buttons support keyboard expansion and announce status changes. Shared theme tokens and canonical provider marks cover both themes. Mobile controls stack without horizontal scrolling.

## Persistence and permissions

`GET /api/agent/delegation?workspaceId=…` reads only the authenticated user's latest onboarding run and that workspace's clients. `POST` stores a validated goal, client choice and optional context atomically. It records intent only; it cannot connect accounts, enqueue imports or write reports.

Each POST has a unique request ID. Replays return the same run; changed replay content conflicts. Serializable transactions prevent two different requests from creating parallel active runs. Active and paused work must be resumed rather than overwritten. The client must belong to the workspace; a viewer cannot create work. Run reads remain private to the initiating user. UI cache and component state are partitioned by both user and workspace.

Existing `ENABLE_AGENT_ONBOARDING` and `AGENT_ONBOARDING_WORKSPACE_IDS` gates remain unchanged. Production with an empty cohort stays closed. This change does not enable agents globally or certify production provider access, delivery, monitoring cadence, billing or payout operation.

## Current boundary

The optional text field records reporting context. It is not an unrestricted natural-language executor. The three recipes set existing goals and lead into the supported setup/import flow; they do not promise generated analyses or automatically written client reports. Broader orchestration requires a separately reviewed execution contract.

The console demo uses explicitly labeled synthetic snapshots and blocks writes. A demo card is not live task or delivery evidence.

## Verification

The database suite checks same-request replay, competing-request races, changed replay rejection, preserved active/paused tasks, fresh post-completion runs, rollout gates, viewer restrictions, foreign client rejection and peer/tenant read isolation. Browser coverage exercises dashboard intent → guided setup → source selection → pause → dashboard, with reload, fixed client scope, desktop/mobile layout and keyboard expansion. Existing onboarding tests retain consent and warehouse-review coverage; live provider output verification remains separate.
