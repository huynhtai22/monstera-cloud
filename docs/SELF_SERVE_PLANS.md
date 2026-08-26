# Self-serve plans: Start / Studio / Agency

Draft catalog for preview. **Not live billing.** Do not merge to main until Cẩm Tài approves going live. Do not change production Paddle prices, contact customers, or publish this as the marketing source of truth without that approval.

Internal plan ids stay `free` / `starter` / `professional` (plus existing `pilot` and `enterprise`). Display names are Start / Studio / Agency.

## Verdict

Implement **with corrections**. Destinations-included at $49 / $129 fits this codebase: there is no destination meter, no MAR, no per-connector Stripe price. Billing SoR is **Paddle** + `Workspace.plan` + `src/lib/plan-config.ts`. Do not add Stripe.

### Corrections vs the hypothesis

| Hypothesis | What the code actually does |
|---|---|
| Accounts per source | Unit is **workspace-total source `Connection` rows**, not leaf ads inside a BM/MCC. Studio = 6 connections (2×3). Agency = **15 per workspace**. |
| Unlimited seats | ACL is workspace-scoped and safe. Invites were uncapped; this PR enforces a **50-seat abuse ceiling**. |
| Hourly refresh on Agency | Hobby Vercel cron is nightly. Agency `scheduledRefresh: "hourly"` is **intent**; runtime is still nightly until an hourly worker exists. Free is skipped (`scheduledRefresh: "none"`). |
| 14-day free history | **Query clamp**, not warehouse TTL. Rows are not deleted. |
| Looker Studio → Data Studio (16 Apr 2026) | In-product name remains **Looker Studio™**. |
| $49 daily Google+Meta | Ad APIs are ~$0. Infra is likely ~$0.03–0.15/workspace + ~5% Paddle. Support labor is the unknown (`UNIT_ECONOMICS.md`). Cannot prove profit. |

Pilot and Enterprise ids are unchanged so existing invitation-only tenants are not silently dropped onto Start.

## Catalog (source of truth: `src/lib/plan-config.ts`)

| Rung | Id | Annual / MoM USD | Workspaces | Sources | Accounts / workspace | Refresh | Destinations |
|---|---|---|---|---|---|---|---|
| Start | `free` | $0 | 1 | 1 | 1 | On-demand | Sheets only |
| Studio | `starter` | $49 / $59 | 1 | 2 | 6 | Daily + on-demand | Warehouse + Sheets + Looker, no dest fee |
| Agency | `professional` | $129 / $149 | 3 | 4 | 15 | Hourly intent · nightly Hobby | Same dests + CSV/REST |

## How to verify on preview

New signups still default to `pilot` (invitation-only). To exercise rungs, set `Workspace.plan` in the preview database (or Prisma Studio) — never log customer data.

1. **Start (`free`)**  
   - Connect Sheets (Google JWT `/api/looker-studio`) → 200.  
   - Looker API-key GET `/api/looker-studio` → 403 `PLAN_LOOKER_BLOCKED`.  
   - Second source OAuth → redirect `error=plan_limit`.  
   - Nightly warehouse-refresh skips this workspace.

2. **Studio (`starter`)**  
   - Sheets JWT and Looker API-key both 200 from the same workspace.  
   - No destination upsell in Exports or Billing.  
   - 7th source connection → `PLAN_ACCOUNT_LIMIT`. Third platform → `PLAN_SOURCE_LIMIT`.

3. **Agency (`professional`)**  
   - 15th source connection allowed; 16th blocked.  
   - CSV `/api/export/rows` allowed.  
   - Owner can create up to 3 workspaces (`POST /api/workspaces`).

## Live cutover checklist (needs Cẩm Tài)

- [ ] Approve list prices and VND PPP amounts.
- [ ] Create **sandbox** Paddle products/prices for Studio and Agency (monthly + annual). Wire `PADDLE_PRICE_STARTER_*` and `PADDLE_PRICE_PROFESSIONAL_*` on preview only.
- [ ] After approval, create **live** Paddle prices. Do not reuse old $29/$79 ids.
- [ ] Grandfathering table (do **not** auto-migrate paid customers):

| Current `Workspace.plan` | Mapping | Notes |
|---|---|---|
| `pilot` | stay `pilot` unless they buy | Invitation tenants keep Pilot limits |
| `starter` (old $29 / 5 connections) | stay `starter` (new Studio limits) **only after written mapping** | Existing rows over the new cap of 6 are kept; next connect hits the cap |
| `professional` (old $79 / 20 connections) | stay `professional` **only after written mapping** | Cap 20 → 15; existing rows kept |
| `enterprise` | stay `enterprise` | Out of self-serve |
| `free` | Start | Already the trial |

- [ ] Flip `CheckoutButton` from “Request pilot access” to Paddle checkout **only** after live prices exist.
- [ ] Remove the “draft / not live billing” banners on `/pricing` and Settings → Billing.
- [ ] Confirm marketing homepage “Start free” still matches Start limits.
- [ ] Do not email customers, publish ads, or change certified provider routes.

## What this PR does not do

- Merge to `main`
- Mutate live Paddle/Stripe prices (Stripe checkout is already 404)
- Build a second billing system
- Delete warehouse rows for 14-day history
- Add hourly cron on Vercel Hobby
- Count leaf ads inside a BM/MCC (still one Connection row)
