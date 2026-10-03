# Console access & payment flows (pre/post sign-in, pre/post payment)

This document defines **expected behavior** for authentication boundaries and paid upgrades. Pair with [`AUTH_SECURITY_JOURNEY.md`](./AUTH_SECURITY_JOURNEY.md) for identity and isolation rules.

---

## 1. Pre sign-in (anonymous)

| Area | Access |
|------|--------|
| Marketing, legal, showcase, `/pricing`, `/register`, `/login` | **Public** — no session cookie required. |
| `/api/auth/*` | NextAuth (OAuth callbacks, session). |
| `/api/checkout/*`, `/api/xendit/checkout` | **Not** for anonymous users — handlers return **401** without a valid session (see §4). |
| `/api/webhooks/paddle` | **Public POST** from Paddle IPs only — protected by **`Paddle-Signature`** (not for browsers). |

**Middleware** does **not** list `/pricing` or `/` — visitors can browse pricing without logging in.

---

## 2. Post sign-in (authenticated)

| Area | Access |
|------|--------|
| App routes: `/console`, `/overview`, `/settings`, `/meta-ads`, … | **Protected** — `src/middleware.ts` requires a valid JWT (`getToken`). Missing session → **302** to `/login?callbackUrl=…` (sanitized via `safe-callback-url`). |
| `/api/*` (data) | Session checked in each route handler (`getServerSession`); workspace actions require **membership**. |

**After login:** User lands on `callbackUrl` when safe, else default `/console`. Start (`free`) is a real trial workspace and is **not** bounced to `/pricing`. Entitlements still gate Looker, extra sources, and scheduled refresh in-product. Google OAuth uses **`/auth/continue`** to apply the same rule.

---

## 3. Sign out (pre vs post)

| Moment | Behavior |
|--------|----------|
| **Pre sign-out** | Session JWT valid → app routes and APIs work as in §2. |
| **Post sign-out** | Session cleared; next navigation to app routes → middleware redirects to **login**. |

**Implementation:** Sidebar `signOut({ callbackUrl: '/login' })` so the user always lands on the marketing login page, not an internal NextAuth URL.

---

## 4. Pre payment vs post payment

### Pre payment (initiating checkout)

- **Rule:** Only an **authenticated** user can create a hosted checkout or invoice tied to their account.
- **LemonSqueezy:** `POST /api/checkout/lemonsqueezy` requires `session.user.id` **and** `session.user.email`. Embeds `user_id` in checkout custom data for webhooks (`src/lib/lemonsqueezy.ts`).
- **Xendit:** `POST /api/xendit/checkout` requires the same session identity; `user_id` is stored in invoice **metadata** for webhook reconciliation.
- **Paddle Billing (default):** `CheckoutButton` calls `POST /api/checkout/paddle` unless `NEXT_PUBLIC_PAYMENT_PROVIDER=lemonsqueezy`. Server creates a Paddle **transaction** with catalog **price IDs**, embeds `user_id` in **`custom_data`**, and returns **`checkout.url`** ([transactions API](https://developer.paddle.com/api-reference/transactions/create-transaction)). Configure products/prices in Paddle to match Starter/Pro and monthly/annual (`PADDLE_PRICE_*` env vars). List prices must match what you show on `/pricing`; a **$0 / trial** checkout requires a **$0 or trial price** in Paddle wired to the same env slot—not something the app invents client-side.
- **UI:** `CheckoutButton` on `/pricing` calls the active checkout API; on **401** redirects to `/login?callbackUrl=…` so payment cannot proceed without a session.

### Post payment (provider → Monstera)

- **LemonSqueezy webhooks:** `POST /api/webhooks/lemonsqueezy` — rejects unsigned payloads (`verifyWebhookSignature`). Plan updates use **`user_id` from custom data** (or fallback rules) — **no** client can forge a valid signature.
- **Xendit webhooks:** `POST /api/xendit/webhook` — rejects requests without valid `x-callback-token`. Plan upgrade prefers **`metadata.user_id`** when present and matches payer email; avoids upgrading the wrong row by email alone.
- **Paddle webhooks:** `POST /api/webhooks/paddle` — rejects payloads with invalid **`Paddle-Signature`** (HMAC-SHA256 per [Paddle webhook signatures](https://developer.paddle.com/webhooks/signature-verification)). Provisions plans from **`transaction.completed`** / **`subscription.*`** using **`custom_data.user_id`** and catalog price → internal plan mapping. Subscribe to notification types in Paddle (**Developer Tools → Notifications**); see [webhooks overview](https://developer.paddle.com/webhooks/overview).

### Post payment (user browser)

- **LemonSqueezy** `redirect_url` → `/console` (configured in checkout API). User must still be **logged in** (same browser session) to view the app; middleware enforces JWT.
- **Xendit** `success_redirect_url` → `/console?payment=success`. Same requirement.

**Important:** “Payment going through” means **(a)** hosted payment page is only opened after a **server-authorized** checkout creation, and **(b)** **plan changes** in the database only occur via **verified webhooks**, not from query params on `/console`.

---

## 5. Developer checklist

- [ ] Never grant plan upgrades from **client-only** query params (e.g. `?plan=pro`) without a webhook or server verification.
- [ ] Checkout APIs: always `getServerSession` + `user.id` (and email where required).
- [ ] Webhooks: always verify provider signature / callback token before `prisma.user.update`.

---

*See also: `src/middleware.ts`, `src/lib/auth.ts`, `src/lib/paddle.ts`, `src/app/api/checkout/lemonsqueezy/route.ts`, `src/app/api/checkout/paddle/route.ts`, `src/app/api/xendit/checkout/route.ts`, `src/app/api/webhooks/lemonsqueezy/route.ts`, `src/app/api/webhooks/paddle/route.ts`, `src/app/api/xendit/webhook/route.ts`.*
