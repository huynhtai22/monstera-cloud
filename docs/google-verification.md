# Google OAuth Verification Guide (Monstera Cloud)

This document prepares OAuth verification for Monstera's shared Google Cloud
project. The consent-screen scope list is project-wide; Apps Script manifests
retain only the scopes used by their individual add-ons.

---

## 1) Scope minimization audit (repo locations)

> Notes:
> - This list covers source files and docs in this repository (excluding generated `repomix-output*` snapshots).
> - “Scope string” includes direct Google scope URLs and identity scope declarations.

### A. Web app / server

| File | Location | Current scope/userinfo use | Purpose |
|---|---|---|---|
| `src/lib/auth.ts` | GoogleProvider `authorization.params.scope` | `openid email profile` | **Sign in with Google** for Monstera web app identity only. |
| `src/lib/google-ads.ts` | OAuth URL builder `searchParams.set('scope', ...)` | `https://www.googleapis.com/auth/adwords` | Google Ads OAuth consent for connecting Ads accounts. |
| `src/lib/google-access-token-email.ts` | `fetch('https://www.googleapis.com/oauth2/v3/userinfo')` | userinfo endpoint | Resolve email from Google access token. |
| `src/app/api/v1/sheets/auth/route.ts` | userinfo fetch | userinfo endpoint | Validate add-on bearer token and map Google email → Monstera user. |
| `src/app/api/v1/sheets/connections/route.ts` | userinfo fetch | userinfo endpoint | Validate add-on bearer token before listing connections. |
| `src/app/api/v1/sheets/query/route.ts` | userinfo fetch | userinfo endpoint | Validate add-on bearer token before query execution. |

### B. Add-on / Apps Script project files

| File | Location | Current scope/userinfo use | Purpose |
|---|---|---|---|
| `google-sheets-addon/appsscript.json` | `oauthScopes` | `openid`, `userinfo.email`, `spreadsheets.currentonly`, `script.external_request`, `script.container.ui` | Required scopes for Sheets editor add-on UI, outbound API calls, and identity token/email mapping. |
| `google-sheets-addon/Code.js` | scope comment block | same as above (documented) | Developer-facing scope checklist for the Sheets add-on code. |
| `scripts/looker-studio-connector/appsscript.json` | `oauthScopes` | `script.external_request`, `userinfo.email`, `openid` | Required scopes for Looker Studio connector auth + backend API calls. |
| `scripts/looker-studio-connector/Code.js` | OAuth2 `.setScope(...)` | `openid email` | OAuth flow to obtain ID token / identity for connector auth. |

### C. Support scripts / docs in repo (not app runtime OAuth)

| File | Location | Scope use | Purpose |
|---|---|---|---|
| `scripts/auth-gen.js` | `generateAuthUrl({ scope: [...] })` | `https://www.googleapis.com/auth/spreadsheets` | Local helper script for token generation. |
| `scripts/agency-auditor-sheets.js` | `new google.auth.GoogleAuth({ scopes: [...] })` | `https://www.googleapis.com/auth/spreadsheets` | Standalone script writing audit output to Sheets. |
| `.env.example` | Google Ads comments | mentions `https://www.googleapis.com/auth/adwords` | Environment reference for Google Ads OAuth setup. |
| `google-sheets-addon/MARKETPLACE-CHECKLIST.md` | checklist text | add-on scopes listed | Marketplace submission checklist text. |

---

## 2) Exact scopes in the shared GCP project

Use only:

1. `openid`
2. `userinfo.email` (requested as `email` in OAuth shorthand)
3. `userinfo.profile` (requested as `profile` in OAuth shorthand)
4. `https://www.googleapis.com/auth/adwords` (**only** for Google Ads connect flow)

The Sheets add-on manifest must not add Google Ads or profile scopes unless the
add-on itself begins requesting them.

### Google Sheets add-on scopes

- `openid`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/spreadsheets.currentonly`
- `https://www.googleapis.com/auth/script.external_request`
- `https://www.googleapis.com/auth/script.container.ui`

### Looker Studio connector scopes (Apps Script project)

- `openid`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/script.external_request`

---

## 3) Redirect URIs and URLs to register

## GCP A (Web app)

### Sign in with Google (NextAuth)

Register callback URI in OAuth client used by `GOOGLE_CLIENT_ID`:

- Local: `http://localhost:3000/api/auth/callback/google`
- Production: `https://monsteracloud.com/api/auth/callback/google`

### Google Ads connect

OAuth client/env:
- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`

Register callback URI in OAuth client used by `GOOGLE_ADS_CLIENT_ID`:

- Local: `http://localhost:3000/api/auth/callback?provider=google_ads`
- Production: `https://monsteracloud.com/api/auth/callback?provider=google_ads`

Do not register `/api/auth/google-ads/callback`; it is a retired endpoint.

## Apps Script projects

For each Apps Script project (Sheets add-on and Looker Studio connector), register its Apps Script OAuth / callback URLs exactly as shown in that script project’s deployment/connector auth settings.

---

## 4) Environment variables and client IDs used

## Web app

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` → NextAuth Google sign-in.
- `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET` → Google Ads OAuth code exchange.
- `GOOGLE_ADS_DEVELOPER_TOKEN` → Google Ads API access after OAuth.
- `GOOGLE_ADS_MCC_ID` (optional) → manager account context used in reporting.

## Token audience validation (backend hardening)

- `GOOGLE_ID_TOKEN_AUDIENCES` (comma-separated) is the preferred allowlist for accepted Google ID token audiences.
- If not set, fallback audiences are read from: `GOOGLE_CLIENT_ID`, `GOOGLE_ADS_CLIENT_ID`, `LOOKER_OAUTH_CLIENT_ID`, `GOOGLE_ADDON_CLIENT_ID`.

## Add-ons / connector

- `LOOKER_OAUTH_CLIENT_ID` / `LOOKER_OAUTH_CLIENT_SECRET` (Script Properties) for Looker connector OAuth.
- `GOOGLE_ADDON_CLIENT_ID` can be included in backend ID-token audience allowlist for add-on issued tokens.

---

## 5) Revoke and re-consent test steps

Use this whenever changing scopes or testing consent-screen updates:

1. In Google Account permissions (`myaccount.google.com` → Security → Third-party access), remove the Monstera app entry for the target project/client.
2. If testing NextAuth sign-in, sign out of Monstera.
3. Re-run the exact flow:
   - Web login and/or Google Ads connect.
   - Open add-on/connector and authorize again.
4. Confirm consent screen only lists expected scopes for that project.
5. Confirm flow still succeeds and data loads.

---

## 6) Plain-English data access summary

## Web app + Google Ads

- We ask for your Google email/profile only to identify your account and sign you in.
- If you connect Google Ads, we request Google Ads scope to read ad performance data that you explicitly connect.
- We do not request Google Drive or Google Sheets scopes in web sign-in.

## Sheets + Looker add-ons

- Sheets add-on scopes are used to show add-on UI in Sheets, call Monstera APIs, and write requested report output into the current spreadsheet.
- Looker connector scopes are used to authorize the connector and fetch Monstera data for dashboards.
- We use Google identity email to map the Google user to an existing Monstera account.

---

## 7) Copy-paste consent screen justifications

Paste these in OAuth consent-screen scope justification fields and verification forms.

## GCP A justification (identity + Google Ads)

```text
Monstera Cloud uses Google OAuth for user authentication and optional Google Ads account connection.

openid / userinfo.email / userinfo.profile:
These scopes are used only to sign users in, identify their account by verified email, and create/manage their Monstera session. We do not access Google Drive or Google Sheets data in this flow.

https://www.googleapis.com/auth/adwords:
This scope is requested only when a user explicitly chooses to connect Google Ads. We use it to read advertising performance data (for example impressions, clicks, spend, conversions) from accounts the user authorizes, so the user can view and export cross-platform reporting inside Monstera Cloud.
```

## GCP B justification (Sheets + Looker add-ons)

```text
Monstera Cloud provides Google Workspace add-ons/connectors (Google Sheets add-on and Looker Studio connector) that require Apps Script scopes to operate in-product.

Sheets add-on scopes:
- spreadsheets.currentonly: write requested report output into the active spreadsheet chosen by the user.
- script.container.ui: render the add-on UI/actions inside Google Sheets.
- script.external_request: call Monstera Cloud backend APIs to fetch connected ad-platform metrics.
- openid + userinfo.email: issue and validate a Google identity token, then map the Google user to an existing Monstera account.

Looker Studio connector scopes:
- openid + userinfo.email: authenticate connector users and map identity to Monstera workspace access.
- script.external_request: fetch report data from Monstera APIs.

We request only the minimum scopes needed for these add-on/connector flows.
```

### Where to paste justifications

- Google Cloud Console → **APIs & Services** → **OAuth consent screen** → **Scopes** section (per scope justification notes).
- Google verification submission form fields asking why each sensitive/restricted scope is required.

---

## 8) Demo video scripts for verification

## Video 1: GCP A (Web sign-in + Google Ads connect)

1. Start on Monstera login page and show URL/domain.
2. Click “Sign in with Google”.
3. On consent screen, zoom to requested scopes and show only identity scopes (openid/email/profile).
4. Complete sign-in and show successful authenticated app landing page.
5. Navigate to Sources/Integrations and click Connect Google Ads.
6. On Google Ads consent screen, show `https://www.googleapis.com/auth/adwords` scope.
7. Complete authorization and return to Monstera.
8. Show connected Google Ads source and a report/query screen that displays Ads metrics.
9. Briefly explain that data is used for reporting dashboards/exports only.

## Video 2: GCP B (Sheets add-on + Looker connector)

### Part A — Sheets add-on
1. Open a Google Sheet and launch Monstera Cloud add-on.
2. Show add-on authorization prompt and listed add-on scopes.
3. Complete auth and open add-on sidebar.
4. Select a source/date range and run data pull.
5. Show data written into the current sheet.
6. Explain that scope usage is limited to add-on UI + current-sheet write + API fetch.

### Part B — Looker Studio connector
1. Open Looker Studio and add Monstera connector.
2. Trigger OAuth authorization for the connector.
3. Show requested identity/app-script scopes.
4. Finish authorization and connect data.
5. Display a report using returned fields/metrics.
6. Explain that scopes are only for connector authentication and API fetch.
