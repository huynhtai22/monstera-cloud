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

## Reviewer / demo instructions

1. Open `https://monsteracloud.com/login` and sign in with the test account you provide (ensure the account can open **Sources** on your plan tier).
2. Open **Sources**.
3. Click **Add data source** (or equivalent), choose **Shopee**, and complete **Shopee OAuth** until the app returns to Monstera with a connected source.
4. Optional: under **Destinations**, connect **Google Sheets** or follow in-app guidance for **Looker Studio**, then run or wait for a **sync** from the source card or pipeline.

## What Monstera does with Shopee data (one sentence)

We read the Shopee data you authorize and deliver it to the **destination** (Google Sheets / Looker Studio) you connect in the same workspace, plus operational logs for sync health.

## Compliance / accuracy checklist before submit

- [ ] Redirect URL in Shopee console **matches** production `SHOPEE_REDIRECT_URI` / `NEXTAUTH_URL`.
- [ ] Copy describes **shipped** behavior (OAuth, workspaces, pipelines, Sheets/Looker); avoid claiming destinations you do not operate in production.
- [ ] Test seller can complete OAuth end-to-end on production.
- [ ] Privacy policy URL (if required) is live and mentions third-party marketplace connectors.
