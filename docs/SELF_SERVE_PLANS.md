# Self-serve plans: Start / Studio / Agency

Draft catalog for preview. **Not live billing.** Do not merge to main until Cẩm Tài approves going live. Do not change production Paddle prices, contact customers, or publish this as the marketing source of truth without that approval.

Internal plan ids stay `free` / `starter` / `professional` (plus existing `pilot` and `enterprise`). Display names are Start / Studio / Agency.

## Verdict

Implement **with corrections**. Destinations-included at $49 / $129 fits this codebase: there is no destination meter, no MAR, no per-connector Stripe price. Billing SoR is **two existing gates**, selected by geo — not a third system:

- **USD → Paddle** (`src/lib/paddle.ts`, `PADDLE_PRICE_*`, `Workspace.subscriptionProvider = "paddle"`)
- **VND → PayOS hosted checkout + SePay webhook** into VietQR orders (`src/lib/payos.ts`, `src/lib/vietqr-gateway.ts`, `Workspace.subscriptionProvider = "vietqr_domestic"`)

Never send VN to Paddle. Never send USD to PayOS/SePay. Do not add Stripe.

### Corrections vs the hypothesis

| Hypothesis | What the code actually does |
|---|---|
| Accounts per source | Unit is **workspace-total source `Connection` rows**, not leaf ads inside a BM/MCC. Studio = 6 connections (2×3). Agency = **15 per workspace**. |
| Unlimited seats | ACL is workspace-scoped and safe. Invites were uncapped; this PR enforces a **50-seat abuse ceiling**. |
| Hourly refresh on Agency | Hobby Vercel cron is nightly. `scheduledRefresh` may stay `"hourly"` as **internal intent**. **User-visible copy is Daily + on-demand.** Do not advertise Hourly. |
| 14-day free history | **Query clamp / lookback**, not warehouse TTL. Rows are not deleted. Copy: 14-day lookback / query history. |
| Looker Studio → Data Studio (16 Apr 2026) | In-product name remains **Looker Studio™**. |
| $49 daily Google+Meta | Ad APIs are ~$0. Infra is likely ~$0.03–0.15/workspace + ~5% Paddle. Support labor is the unknown (`UNIT_ECONOMICS.md`). Cannot prove profit. |

Pilot and Enterprise ids are unchanged so existing invitation-only tenants are not silently dropped onto Start.

## Catalog (source of truth: `src/lib/plan-config.ts`)

| Rung | Id | Annual / MoM USD | Workspaces | Sources | Accounts / workspace | Refresh | Destinations |
|---|---|---|---|---|---|---|---|
| Start | `free` | $0 | 1 | 1 | 1 | On-demand | Sheets only |
| Studio | `starter` | $49 / $59 | 1 | 2 | 6 | Daily + on-demand | Warehouse + Sheets + Looker, no dest fee |
| Agency | `professional` | $129 / $149 | 3 | 4 | 15 | Daily + on-demand | Same dests + CSV/REST |

## How to verify on preview

Fresh signup / register creates `Workspace.plan = "free"` (Start). Pilot remains **invite-only** (`invitation.plan`) plus `PRO_WHITELIST_EMAILS` → professional. To exercise Studio/Agency on preview, set `Workspace.plan` in the preview database — never log customer data.

`GET /api/geo` (x-vercel-ip-country / cf-ipcountry, VN → VND else USD; accept-language fallback) drives `/pricing` and Billing currency. VN sees VND PPP and the PayOS/VietQR gate. Everyone else sees USD and Paddle. Public checkout stays **Request pilot access**.

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

Do **not** flip `CheckoutButton` to Paddle-only. Cutover is two gates, selected by geo (`invoiceCurrency`). `CheckoutButton` already has `invoiceCurrency?: "VND" | "USD"` — keep it.

### USD (Paddle)

- [ ] Approve USD list prices ($49/$59 Studio, $129/$149 Agency).
- [ ] Create **sandbox** Paddle products/prices for Studio and Agency (monthly + annual). Wire `PADDLE_PRICE_STARTER_*` and `PADDLE_PRICE_PROFESSIONAL_*` on preview only.
- [ ] After approval, create **live** Paddle prices. Do not reuse old $29/$79 ids.
- [ ] Never attach Paddle `pri_` ids to VND visitors. Never charge Paddle in đồng.

### VND (PayOS + SePay / VietQR)

- [ ] Approve VND PPP amounts in `PLAN_PRICING` (`vndMonthly` / `vndAnnualMonthly`). `createVietQrOrder` uses those only — never `usdMonthly`.
- [ ] Confirm PayOS sandbox + SePay webhook (`/api/webhooks/payos`, `/api/webhooks/sepay`) on preview.
- [ ] After approval, confirm live PayOS/SePay. Do not create or change live catalog items from this PR.
- [ ] Never send USD visitors to PayOS. Never charge PayOS in dollars. `Workspace.subscriptionProvider = "vietqr_domestic"`.

### Shared

| Current `Workspace.plan` | Mapping | Notes |
|---|---|---|
| `pilot` | stay `pilot` unless they buy | Invitation tenants keep Pilot limits |
| `starter` (old $29 / 5 connections) | stay `starter` (new Studio limits) **only after written mapping** | Existing rows over the new cap of 6 are kept; next connect hits the cap |
| `professional` (old $79 / 20 connections) | stay `professional` **only after written mapping** | Cap 20 → 15; existing rows kept |
| `enterprise` | stay `enterprise` | Out of self-serve |
| `free` | Start | Default for new signups |

- [ ] Enable self-serve charge **only** after both USD Paddle prices and VND PayOS amounts exist. `CheckoutButton` then uses `invoiceCurrency` to pick the gate (`getCheckoutApiPath`). Until then it stays Request pilot access → `/support?pilot=1`.
- [ ] Remove the “draft / not live billing” banners on `/pricing` and Settings → Billing.
- [ ] Confirm marketing homepage “Start free” matches Start (`Workspace.plan = free` on signup).
- [ ] Do not email customers, publish ads, or change certified provider routes.

## What this PR does not do

- Merge to `main`
- Mutate live Paddle or PayOS/SePay prices (Stripe checkout is already 404)
- Collapse USD and VND into one gate, or invent a third billing system
- Delete warehouse rows for 14-day lookback
- Advertise hourly refresh (Hobby is nightly)
- Count leaf ads inside a BM/MCC (still one Connection row)
