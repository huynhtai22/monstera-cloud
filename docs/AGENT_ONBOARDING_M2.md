# M2: onboarding interface and bounded coordinator

Implemented on 2026-09-30. The full-screen `/onboarding` route now uses M1's real persisted records. The role screen and connector conversation are part of the application, rather than the earlier simulated concept.

## Product behavior

- New visitors see a skippable welcome before choosing their role. An original source/workspace/reporting composition introduces the product with a short, staggered reveal. Existing profiles or saved runs bypass the intro. Neither welcome action writes profile or execution state; reduced motion shows the complete illustration immediately.
- Six work cards with persisted selection or deliberate skip. Role changes personalize the greeting and do not change permissions.
- Workspace selection is resolved against signed-in memberships. Agency routes validate the slug and membership and lock the workspace. A workspace with clients requires an explicit client or workspace-only choice before starting a run; the original run scope remains locked when resuming.
- First-time operators with an unanswered profile, no run, and no warehouse rows enter setup from the console after workspace resolution. Answered/skipped profiles, existing runs, activated workspaces and viewers retain the console. Existing users can deliberately open setup with the console's “Set up with Monstera” link.
- Connector chips and conversation use the same allowlisted provider identifiers. Explicit selection checks both the integration flag and workspace provider access. A provider batch commits atomically and duplicate selections reuse existing tasks.
- Conversation proposes agents and waits for confirmation. It never authorizes accounts, submits imports or declares success. Ambiguous/negative/unsupported requests ask the user to choose. Unavailable providers are omitted and disclosed.
- The current `classify_intent` model route is deterministic. M2 uses one bounded interpretation step and records zero cost in the reply metadata; it makes no external model call and works without an API key. Introducing a paid interpreter later must use the existing workspace AI policy/budget controls. Direct selection stays available independently of interpretation.
- Messages and replies commit together with ordered events. Replaying a message ID returns the original reply; changing its content is rejected. The client retains the identifier after a network failure, refreshes stale versions and prevents overlapping mutations.
- Stable keyed agent cards preserve expansion/focus during updates. A waiting source can be deferred and restored. “Continue later” pauses an existing run; resuming uses the same records. Completed runs return to the console without a restart.
- Snapshot polling follows real state: two seconds during active work, ten seconds while waiting, no polling on hidden pages, refresh on visibility/focus, and delivered event cursors for replay. Pending refreshes are serialized so a mutation cannot leave controls using an older version.
- Console-aligned charcoal surfaces, shared sans-serif/monospace font tokens, the existing `Logo` / `LogoMark`, an original geometric business icon set, local provider logos, and 160/240/480ms feedback/state/stage motion. Keyboard controls, visible focus, a 320px layout, reduced motion, and mobile stacking are implemented.

## Routes and boundaries

All agent routes and onboarding pages require `ENABLE_AGENT_ONBOARDING=1` and authentication. The flag remains off by default. The agency page additionally requires `AGENCY_HOST_ROUTING_ENABLED=1` and an authorized existing slug.

Added surfaces:

- `/onboarding` and `/agencies/[agencySlug]/onboarding`, in a separate `(onboarding)` group outside the console sidebar.
- `GET /api/agent/onboarding-entry?workspaceId=…` — scoped first-time entry decision.
- `POST /api/agent/runs/[runId]/messages` — bounded persisted conversation; proposals live in the reply's `structuredResponse.proposedActions`.
- `POST /api/agent/runs/[runId]/providers` — explicit eligible provider selection and updated snapshot.
- `POST /api/agent/runs/[runId]/actions` — version-checked pause/resume.
- `POST /api/agent/tasks/[taskId]/actions` — version-checked defer/restore. Execution retry is unavailable until M3.

No new database migration is needed beyond M1. The new UI requires M1's migration and generated Prisma Client. It does not alter the existing Sources OAuth flow or create activation/warehouse evidence from animation.

**M3 boundary:** provider connection buttons remain disabled and explain that connection setup is unavailable in this preview. Account discovery/selection, confirmation/import, real progress reconciliation, usable-data review and Finish setup require the TikTok vertical slice. There is no simulated authorization URL, import percentage, warehouse row count, or local completion award.

## Verification

- Full production build and its TypeScript check pass with Next.js 16.3.3 / Node 22.23.2.
- ESLint passes for the changed services, application pages/components/hooks and routing tests.
- 53 targeted unit/integration tests pass, zero skipped, including 14 real-PostgreSQL persistence/isolation/entry tests. Coverage includes atomic provider batches, concurrent message/reply replay, permission and provider gates, stale mutations, recovery, bounded interpretation and authenticated agency rewrites.
- Three browser journeys pass against a production-mode local server: console entry through role/conversation/confirmation/reload/pause/resume/defer; 320px keyboard/direct selection with reduced motion; and agency slug/client scope persistence outside the console shell.
- Desktop and mobile screenshots were inspected. The production walkthrough uses synthetic local users and a disposable PostgreSQL database. External model credentials are absent; no provider account is authorized or imported.

Validation used an exact working-source copy outside iCloud with the existing lockfile/dependencies because workspace dependency reads stalled during M1. Production configuration and databases were not modified. Tests clean up their synthetic users/workspaces; the local verification servers are stopped afterward.

The brand refinement was additionally checked in the browser at desktop and 320px widths: both welcome actions open the role picker, keyboard role selection saves to source setup, and returning users restore their saved setup. Intro, role and source screens have no mobile horizontal overflow. Main and heading fonts resolve to the shared `--font-sans` token. Agent details use a 240ms height transition where supported; adding another source preserves the open agent. The intro reveals once, then settles. Onboarding ESLint and the full TypeScript check pass. The existing browser journeys were updated for the welcome title; the complete production browser suite was not rerun for this visual refinement.

To review locally, apply M1 to a disposable database, enable the feature flag, sign in to a workspace with the desired provider access, and open `/onboarding?workspaceId=…` or the console setup link. The opt-in browser suite is `tests/e2e/agent-onboarding.spec.ts`; it refuses fixture creation unless the repository's isolated E2E environment checks pass.

## Milestone 3 follow-up

[M3 execution](./AGENT_ONBOARDING_M3.md) now binds a TikTok task to a validated OAuth attempt, discovers authorized advertiser accounts, freezes explicitly selected accounts/dates, submits one durable warehouse job, reconciles actual outcomes and queries scoped warehouse evidence for review. Preparation remains separate from confirmed scope and actual job outcomes. Live provider acceptance remains a release gate.

## Intro and agent workspace refinement

The intro now presents an interactive three-scene workspace preview, using the shared brand logo and custom business icons. The setup conversation and source agents share one console workspace. Source cards, permission steps and agent status provide clearer hierarchy. Stage transitions, keyed card arrivals, height changes and conversation scrolling respect reduced motion; the intro reveal settles after entry and can be replayed. The accepted role picker remains unchanged.

All new intro/setup surfaces use neutral charcoal and gray colors. User-facing onboarding copy and new coordinator proposals use “agent”; existing persisted message history is retained. Updated browser journey assertions use the new labels. Onboarding/service ESLint, the full TypeScript check, and eight coordinator/contract tests pass. Earlier desktop/mobile checks covered the revised layout before this final palette/copy adjustment; a fresh visual capture was blocked by the browser URL policy on the existing error tab.

## Brand and reporting scope follow-up

The shared `LogoMark` now matches the geometric public logo, favicon and application brand exports; the extra leaf and diagonal strokes have been removed. Workspace/client selectors use charcoal native controls with contextual icons and visible scope explanations. A created run is retained in the workspace run map, reporting client is read from the saved snapshot, and workspace selection is encoded in the route so reload keeps the selection. Switching workspace clears the draft request. Single-workspace and agency selectors show a locked state. Agent capacity reflects enabled sources plus retained source tasks. Import completion and user review are separate stages.

Verification: 22 coordinator/contract/PostgreSQL tests pass with no skips; ESLint and full TypeScript pass. Live browser checks confirm explicit client selection before start, locked client after start, workspace switching/reload restoring the same scope, provider gating, and four distinct connection stages. The local synthetic scope review workspace is retained for visual review; no external account was connected.
