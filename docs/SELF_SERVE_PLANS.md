# Self-serve plans: Start / Studio / Agency

**Approved catalog (2026-08-27, Cẩm Tài). Billing is not live.** Public checkout stays Request pilot access until both USD Paddle prices and VND PayOS amounts exist. Do not merge to main as a live-charge cutover. Do not change production Paddle or PayOS prices, email customers, or publish ads from this PR.

Internal plan ids stay `free` / `starter` / `professional` (plus existing `pilot` and `enterprise`). Display names are Start / Studio / Agency.

## Locked catalog

Source of truth: `src/lib/plan-config.ts`. Destinations are included on paid rungs. No $19 clone. No Stripe.

| Rung | Id | Annual / MoM USD | Workspaces | Sources | Connections / workspace | Refresh (UI) | Destinations |
|---|---|---|---|---|---|---|---|
| Start | `free` | $0 | 1 | 1 | 1 | On-demand | Sheets only |
| Studio | `starter` | $49 / $59 | 1 | 2 | 6 | Daily + on-demand | Warehouse + Sheets + Looker, no dest fee |
| Agency | `professional` | $129 / $149 | 3 | 4 | 15 | Daily + on-demand | Same dests + CSV/REST |

- Start is the **public signup default**. 14-day lookback is a **query clamp**, not warehouse TTL. Rows are not deleted.
- Unlimited seats on Studio/Agency: copy says unlimited; enforcement is a **50-seat** abuse cap.
- Agency `scheduledRefresh` may stay `"hourly"` as **internal intent**. User-visible copy is Daily + on-demand. Hobby cron is nightly.
- Account unit is **workspace-total source `Connection` rows**, not leaf ads inside a BM/MCC.
- Looker Studio™ remains the in-product name (Google rebranded it Data Studio on 16 Apr 2026).
- Pilot remains **invite-only** (`invitation.plan`). `PRO_WHITELIST_EMAILS` → Agency (`professional`). Enterprise stays out of self-serve.

## Two billing gates (never mix)

Selected by `GET /api/geo` (`x-vercel-ip-country` / `cf-ipcountry`, VN → VND else USD; accept-language fallback). `/pricing` and Billing use that currency.

- **USD → Paddle** (`src/lib/paddle.ts`, `PADDLE_PRICE_STARTER_*` / `PADDLE_PRICE_PROFESSIONAL_*`, `Workspace.subscriptionProvider = "paddle"`). Never charge Paddle in đồng. Never send VN to Paddle.
- **VND → PayOS hosted checkout + SePay webhook** into VietQR orders (`src/lib/payos.ts`, `src/lib/vietqr-gateway.ts` uses `PLAN_PRICING` `vndMonthly` / `vndAnnualMonthly` only, `Workspace.subscriptionProvider = "vietqr_domestic"`). Never charge PayOS in dollars. Never send USD to PayOS/SePay.

`CheckoutButton` keeps `invoiceCurrency?: "VND" | "USD"` and still routes to `/support?pilot=1`. It does **not** charge.

## How to verify on preview

Fresh signup / register creates `Workspace.plan = "free"`. To exercise Studio/Agency, set `Workspace.plan` in the preview database — never log customer data.

1. **Start (`free`)** — Sheets JWT `/api/looker-studio` → 200. Looker API-key → 403 `PLAN_LOOKER_BLOCKED`. Second source OAuth → `error=plan_limit`. Nightly warehouse-refresh skipped.
2. **Studio (`starter`)** — Sheets JWT and Looker API-key both 200. No destination upsell. 7th connection or 3rd platform → limit.
3. **Agency (`professional`)** — 15 connections/workspace; CSV `/api/export/rows` allowed; up to 3 owned workspaces. UI says Daily, not Hourly.

## Live cutover (do not do in this PR)

Do **not** flip `CheckoutButton` to charge until **both** gates exist. Do not flip it to Paddle-only.

### 1) USD — Paddle (sandbox, then live)

- [ ] Create **sandbox** Paddle products/prices for Studio and Agency (monthly + annual). Wire `PADDLE_PRICE_STARTER_*` and `PADDLE_PRICE_PROFESSIONAL_*` on preview only.
- [ ] After a separate live-price approval, create **live** Paddle prices. Do not reuse old $29/$79 ids.
- [ ] Never attach Paddle `pri_` ids to VND visitors.

### 2) VND — PayOS + SePay / VietQR (sandbox, then live)

- [ ] Confirm PayOS sandbox + SePay webhook (`/api/webhooks/payos`, `/api/webhooks/sepay`) on preview. Amounts from `PLAN_PRICING` VND only.
- [ ] After a separate live-price approval, confirm live PayOS/SePay. Do not create or change live catalog items from this PR.
- [ ] Never send USD visitors to PayOS.

### Shared (after both sandbox catalogs work)

| Current `Workspace.plan` | Mapping | Notes |
|---|---|---|
| `pilot` | stay `pilot` unless they buy | Invitation tenants keep Pilot limits |
| `starter` (old $29 / 5 connections) | stay `starter` **only after written mapping** | Existing rows over the new cap of 6 are kept; next connect hits the cap |
| `professional` (old $79 / 20 connections) | stay `professional` **only after written mapping** | Cap 20 → 15; existing rows kept |
| `enterprise` | stay `enterprise` | Out of self-serve |
| `free` | Start | Default for new signups |

- [ ] Enable self-serve charge **only** after both USD Paddle prices and VND PayOS amounts exist. Then `CheckoutButton` uses `invoiceCurrency` → `getCheckoutApiPath`. Until then: Request pilot access → `/support?pilot=1`.
- [ ] Confirm marketing homepage “Start free” matches Start.
- [ ] Do not email customers, publish ads, or change certified provider routes.

## What this PR does not do

- Merge to `main` as live billing
- Mutate live Paddle or PayOS/SePay prices
- Flip `CheckoutButton` to charge
- Collapse USD and VND into one gate, or invent a third billing system
- Delete warehouse rows for 14-day lookback
- Advertise hourly refresh
