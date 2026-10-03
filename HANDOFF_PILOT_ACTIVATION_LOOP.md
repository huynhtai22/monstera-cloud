# Pilot Activation Loop — implementation handoff

Last updated: 2026-09-03 (Asia/Ho_Chi_Minh)

## Safety and repository state

- Working branch: `codex/pilot-activation-loop`
- Production has **not** been deployed from this work.
- No database migration was added.
- Before implementation, the three already-deployed landing-page files were committed separately as requested:
  - Commit: `15a8886 feat(marketing): launch agency pilot landing page`
  - Files: `src/app/page.tsx`, `src/components/MarketingNavbar.tsx`, `src/components/marketing/MarketingHomePage.tsx`
- Both local `main` and `codex/pilot-activation-loop` currently point at `15a8886`; `origin/main` is still `5fd6a81`.
- The activation-loop implementation after `15a8886` is currently **uncommitted**. Preserve the working tree; do not reset or restore it.
- `git diff --check` is clean.

## What is implemented

### Canonical activation state

New `src/lib/pilot-activation.ts` defines the approved public DTO and derives these durable states:

- `not_started` / `connect_source`
- `in_progress` / `import_data`
- `blocked` / `fix_source`
- `ready_to_review` / `review_dashboard`
- `activated` / `complete`

The calculation uses workspace status/expiry, source health, the latest import, recent warehouse rows, data-through date, and the durable dashboard-review audit event. URL parameters and browser storage are deliberately excluded.

Important behavior: one usable source plus at least one recent KPI row is sufficient to reach review. A broken secondary source remains an operational issue but does not prevent pilot activation.

### Dashboard onboarding

- `src/lib/dashboard-overview.ts`
  - Extends `DashboardOverviewDTO.workspace` with `status` and `subscriptionEndsAt`.
  - Adds `pilotActivation` to `/api/dashboard/summary` using database-derived facts.
- `src/components/dashboard/SetupWizard.tsx`
  - Replaced the old two-step wizard with the resumable three-step journey:
    1. Connect one enabled source.
    2. Import at least one metric row from the last seven days.
    3. Review Performance & Spend.
  - Shows current plan, trial end, days remaining, and the `1,490,000 VND/month` continuation price.
  - Shows recovery guidance for authorization failures, failed imports, partial imports, zero-row imports, and stale data.
  - After activation, Sheets, Looker Studio, and API/exports are optional delivery steps.
  - Dismissal is only offered after activation.
- `src/components/dashboard/DashboardHomePage.tsx`
  - Ignores old local dismissal state while onboarding is incomplete.
  - Marks the populated Performance & Spend panel with a stable anchor/ref.
  - Uses an `IntersectionObserver` at 50% visibility to record the dashboard review once, then refreshes the dashboard DTO.
  - Continues emitting a GTM event, while the database event remains the source of truth.

### Durable review milestone API

- New `src/lib/pilot-activation-store.ts`
  - Confirms server-side that at least one `CampaignMetric` row exists in the last seven days.
  - Creates an idempotent `AuditEvent` with action `onboarding.dashboard_reviewed`.
  - Uses a deterministic audit ID per workspace to prevent duplicate milestones.
- New `POST /api/workspaces/[id]/activation`
  - Requires an authenticated workspace member (`viewer` or higher).
  - Accepts only the exact body `{ "action": "dashboard_reviewed" }`.
  - Rejects extra browser-controlled fields.
  - Returns the refreshed activation state.

### One onboarding route

- `src/app/(app)/quickstart/page.tsx` now redirects to `/console`.
- The tenant route re-exports that page and therefore shares the redirect.
- `src/proxy.ts` now retires `/quickstart` before authentication, so anonymous, authenticated, and tenant-host traffic all converge on `/console` without keeping `/quickstart` as the login callback.
- The old quick-start implementation that initiated OAuth without `workspaceId` has been removed.

### Registration and offer safety

- Public pilot links in the marketing navbar, landing page, and pricing page now use `/register?offer=agency-pro-pilot`.
- The registration page uses that parameter only to display:
  - seven-day Agency Pro pilot;
  - no card required;
  - `1,490,000 VND/month` continuation price.
- The registration POST body remains `{ name, email, password, inviteToken }`; the offer query is never submitted as entitlement input.
- Existing server registration already creates non-whitelisted self-serve workspaces as `professional` + `PILOT` with `freePilotEndsAt()` (`FREE_PILOT_DAYS = 7`).

### Pricing and billing cleanup

- Public pricing remains monthly by default.
- Stale pricing metadata mentioning Free/Starter/Paddle was replaced with Agency Pro pilot/PayOS language.
- The public Agency Pro CTA carries the pilot messaging parameter.
- The PayOS self-serve order endpoint now accepts only `professional`; Starter and Enterprise cannot create self-serve PayOS orders.
- Legacy Starter limits/data remain in backend compatibility code, as required.

### Founder/operator view

- `GET /api/internal/pilot/workspaces?limit=50`
  - Operator-only.
  - Returns pilot owner, deadline/days remaining, milestone, recent rows, data-through date, blocking source, last progress time, and full activation state.
  - Sorts blocked/expired first, then incomplete, ready-to-review, and activated.
  - Derives state from workspaces, connections, metrics, latest imports, audit events, and paid orders.
- `POST /api/internal/pilot/workspaces`
  - Operator-only.
  - New-workspace invitations are always server-controlled `pilot`; a browser-supplied plan is ignored.
  - Existing-workspace teammate invitations retain their legacy behavior.
- `src/app/(app)/pilot-admin/PilotProvisioningClient.tsx`
  - Adds the activation pipeline table.
  - Creates only seven-day pilot invitations.
  - Keeps PayOS order history read-only.
  - Removes the handcrafted QR generator, bank-transfer activation controls, old prices, plan picker, and manual-activation button.
  - Retains the existing mapping-copilot section.

### Preview fixtures and tests

- New local-only fixture page: `/demo/ui/pilot-activation`
- Source: `src/app/demo/ui/pilot-activation/page.tsx`
- Contains not-started, importing, blocked, ready-to-review, and activated states.
- It intentionally returns 404 when `NODE_ENV === "production"`.

New tests:

- `src/lib/pilot-activation.test.ts`
- `src/lib/pilot-activation-store.test.ts`
- `src/app/api/workspaces/activation-route.test.ts`
- `src/app/api/internal/pilot/workspaces/route.test.ts`
- `src/proxy.test.ts` has a new canonical quick-start redirect test.

## Verification already completed

Before the final two small edits (source-precedence refinement and edge quick-start redirect), these passed:

- `npm run typecheck`
- Targeted ESLint on every changed file, with zero warnings/errors
- `npm run build` (169 static pages; activation API route included)
- Targeted activation/billing/route tests: 43 passing
- Full `npm test`: 522 total, 487 passing, 35 skipped, 0 failing
  - The 35 skips are expected real-Postgres integration tests when no reachable `DATABASE_URL` is available.

Visual checks completed after implementation:

- Desktop fixture screenshot: all five states render correctly.
- Pixel 7 fixture screenshot: cards stack, actions remain visible, and no horizontal overflow was observed.
- Registration offer message appears after client hydration.
- `/quickstart` now resolves through the canonical `/console` authentication callback (`/login?callbackUrl=%2Fconsole`).

The last source-precedence and proxy changes still need the final automated rerun listed below.

## Exact steps to finish safely

1. Review the remaining diff without altering it:

   ```bash
   git status --short
   git diff --check
   git diff --stat
   git diff
   ```

2. Re-run verification after the final helper/proxy edits:

   ```bash
   npm run typecheck
   npm run lint:ci
   npm test
   npm run build
   ```

   `npm run lint -- --max-warnings 0` is not a useful repository-wide gate right now because the repository already contains roughly 50 unrelated warnings. `npm run lint:ci` is the configured project gate. Any changed-file warning should still be fixed.

3. Recheck the three core local flows:

   - `/register?offer=agency-pro-pilot` shows the pilot message, but the registration network body has no plan/duration/offer entitlement fields.
   - `/quickstart` and a tenant-host `/quickstart` land on `/console` (or login with `/console` as callback when signed out).
   - `/demo/ui/pilot-activation` still renders all five states at desktop and mobile widths.

4. If all checks pass, commit only the activation-loop working tree on `codex/pilot-activation-loop`, separate from landing commit `15a8886`. Suggested commit:

   ```text
   feat(onboarding): add durable pilot activation loop
   ```

5. Do **not** deploy automatically. Show the user the branch/commit and verification result first. Production promotion requires the user's explicit approval.

## Files currently modified or new

Modified:

- `src/app/(app)/pilot-admin/PilotProvisioningClient.tsx`
- `src/app/(app)/quickstart/page.tsx`
- `src/app/(auth)/register/page.tsx`
- `src/app/(marketing)/pricing/layout.tsx`
- `src/app/(marketing)/pricing/page.tsx`
- `src/app/api/internal/pilot/workspaces/route.ts`
- `src/app/api/payments/vietqr/create/route.ts`
- `src/components/MarketingNavbar.tsx`
- `src/components/dashboard/DashboardHomePage.tsx`
- `src/components/dashboard/SetupWizard.tsx`
- `src/components/marketing/MarketingHomePage.tsx`
- `src/lib/dashboard-overview.ts`
- `src/proxy.test.ts`
- `src/proxy.ts`

New:

- `src/app/api/internal/pilot/workspaces/route.test.ts`
- `src/app/api/workspaces/[id]/activation/route.ts`
- `src/app/api/workspaces/activation-route.test.ts`
- `src/app/demo/ui/pilot-activation/page.tsx`
- `src/lib/pilot-activation-store.test.ts`
- `src/lib/pilot-activation-store.ts`
- `src/lib/pilot-activation.test.ts`
- `src/lib/pilot-activation.ts`

This handoff file is also new and should be committed with the implementation unless the user prefers it kept out of the product commit.

## Remaining review notes

- The dashboard activation state intentionally depends on both a current seven-day metric row and the durable review event. If recent rows later age out without a refresh, the derived state can become blocked again; this matches the approved requirement that activation requires recent KPI rows plus review, but should be confirmed during product review.
- The fixture uses a fixed September 2026 trial date and is for layout/state QA only.
- The operator table currently queries all `PILOT` workspaces and applies `limit` after deriving/sorting them. This is appropriate for the current pilot scale; paginate or prefilter only when the fleet becomes materially larger.
- Do not remove existing Starter backend compatibility paths or legacy paid-workspace behavior as cleanup; the approved assumptions explicitly preserve existing Starter workspaces.
- Do not change PayOS activation authority: verified webhook handling remains the only subscription activation/extension path.
