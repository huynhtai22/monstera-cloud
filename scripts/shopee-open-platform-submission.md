# Shopee Open Platform — resubmission copy (Monstera Cloud)

Use the blocks below in Shopee’s form fields. Replace `https://monsteracloud.com` if your production host differs.

## Redirect / callback URL (must match deployment)

Register **exactly** (no trailing slash on the origin unless Shopee requires it):

`https://monsteracloud.com/api/auth/shopee/callback`

Local testing (if Shopee allows multiple redirect URLs):

`http://localhost:3000/api/auth/shopee/callback`

Server env: `SHOPEE_REDIRECT_URI` optional override; default is `{NEXTAUTH_URL}/api/auth/shopee/callback`.

## Service / product description — **200 characters**

Monstera Cloud is a SaaS app: sellers OAuth Shopee, connect Google Sheets or Looker Studio, and run scheduled pipelines to sync store/order data for reporting and dashboards. https://monsteracloud.com

(Character count: 200.)

## Longer description (if the form has a larger “remarks” or “application purpose” field)

Monstera Cloud is a web application for e-commerce sellers and agencies. After signing in, users create a workspace and connect Shopee using the official Shopee Open Platform OAuth flow. They connect Google Sheets and/or Looker Studio as destinations and run scheduled pipelines so permitted Shopee store and order data sync into those tools for reporting and monitoring. We request only the API scopes required for the features we expose; credentials are encrypted at rest. We do not use Shopee data for unrelated advertising or resale of traffic.

## Which account to give Shopee reviewers

Use a **dedicated reviewer-only** account (not your personal founder login):

| Requirement | Why |
|---------------|-----|
| **Email + password** (or magic link if you enable it) | Shopee reviewers need a reproducible login without your 2FA device. |
| **`emailVerified` set** in your DB | So they are not blocked by OTP / verify-email steps. |
| **Plan: `starter` or `professional`** (recommended) | On Monstera, **free** users who sign in with `callbackUrl=/sources` can be redirected to **`/pricing`** first (`getPostLoginRedirectPath`). Paid (or enterprise) avoids that friction. OAuth **after** they are already logged in still returns to `/sources`, but first-time login is smoother on a paid test user. |

**How to create or reset that user (production DB):**

```bash
# Example: dedicated email, strong password, Professional plan
DATABASE_URL="…" \
SMOKE_TEST_EMAIL="marketplace-review@monsteracloud.com" \
SMOKE_TEST_PASSWORD="use-a-long-random-password-here" \
SMOKE_PLAN=professional \
npx tsx scripts/create-smoke-test-account.ts
```

Alternatively, run `scripts/create-reviewer-account.ts` once, then set that user’s `plan` to `starter` or `professional` in Prisma / Neon if it defaulted to `free`.

**Do not** hand out your Shopee seller password — reviewers use **their own** Shopee seller account when clicking **Authorize** in Shopee’s OAuth screen. You only share **Monstera** login.

---

## Reviewer / demo instructions (paste into Shopee form)

1. Open `https://monsteracloud.com/login` and sign in with the **test Monstera account** we emailed you (workspace is pre-created).
2. If the app opens **Pricing** first, open **Sources** from the left navigation (or go to `https://monsteracloud.com/sources`).
3. Click **Add data source** → **Shopee** → **Continue** / authenticate. Complete **Shopee OAuth** in Shopee’s page using **your Shopee seller test account**. You should land back on Monstera **Sources** with Shopee connected.
4. Optional: **Destinations** → connect **Google Sheets** or **Looker Studio**, then use **Sync** on the source or pipeline card.

**Support:** If login fails, use **Forgot password** on the same email (or ask us to reset the reviewer password once).

## What Monstera does with Shopee data (one sentence)

We read the Shopee data you authorize and deliver it to the **destination** (Google Sheets / Looker Studio) you connect in the same workspace, plus operational logs for sync health.

## Compliance / accuracy checklist before submit

- [ ] Redirect URL in Shopee console **matches** production `SHOPEE_REDIRECT_URI` / `NEXTAUTH_URL`.
- [ ] Copy describes **shipped** behavior (OAuth, workspaces, pipelines, Sheets/Looker); avoid claiming destinations you do not operate in production.
- [ ] Test seller can complete OAuth end-to-end on production.
- [ ] Privacy policy URL (if required) is live and mentions third-party marketplace connectors.
