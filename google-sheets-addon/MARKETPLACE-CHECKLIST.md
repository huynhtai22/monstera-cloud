# Google Workspace Marketplace — remediation checklist

Use this after a rejection or before first submission. Console steps must be done in the **same** Google Cloud project linked to the Apps Script project (**Project Settings → Google Cloud Platform project**).

**References**

- [Giving proper attribution (branding)](https://developers.google.com/workspace/marketplace/terms/branding#giving_proper_attribution)
- [Google trademark list](https://about.google.com/brand-resource-center/trademark-list/)
- [API legal attribution](https://about.google.com/brand-resource-center/guidance/apis/#legal-attribution)
- [OAuth verification FAQ](https://support.google.com/cloud/answer/7454865)
- [Apps Script client verification](https://developers.google.com/apps-script/guides/client-verification#requesting_verification)
- [Marketplace vs OAuth consent screen](https://developers.google.com/workspace/marketplace/configure-oauth-consent-screen#differs)
- [Core user features (Sheets)](http://www.google.com/apps/intl/en/terms/user_features.html)

---

## Phase 1 — Trademarks (Marketplace SDK listing)

In **Google Workspace Marketplace SDK** (and any in-console listing text), for every Google product name use **™** as required, e.g. **Google Sheets™**, **Google Workspace™**, **Google Drive™** if mentioned.

Add this **footnote** to the **detailed / long description** (verbatim or equivalent):

> *Google Sheets™ and Google Workspace™ are trademarks of Google LLC.*

Cross-check wording against the trademark list and API attribution guidance above.

**Repo alignment:** Marketing and legal pages use **Google Sheets™** where the product is named; the add-on sidebar uses **Google Sheets™** in user-facing copy.

---

## Phase 2 — OAuth scope parity (three places, identical)

Canonical list is `oauthScopes` in `**appsscript.json`** in this folder. Copy these **exact** URLs (byte-for-byte, no extra scopes) into:

1. **Apps Script** — Project Settings → **OAuth consent** / **Overview** → Project OAuth Scopes (refresh by saving a **new deployment** after manifest changes).
2. **Google Cloud Console** — APIs & Services → **OAuth consent screen** → Scopes.
3. **Google Workspace Marketplace SDK** — App configuration → OAuth scopes (or equivalent).

### Scopes to paste (5)

```
https://www.googleapis.com/auth/spreadsheets.currentonly
https://www.googleapis.com/auth/script.external_request
https://www.googleapis.com/auth/script.container.ui
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/script.scriptapp
```

### Same GCP project

- In **APIs & Services → Library**, enable **Google Sheets API** on the project linked to the script.

### If reviewers still cite “default scopes only”

Email **[oauth-feedback@google.com](mailto:oauth-feedback@google.com)** with screenshots: Sheets API enabled, scope list in consent screen, and cite core user features (Sheets).

---

## Phase 3 — OAuth verification (blocking)

Complete **before** resubmitting the Marketplace listing.

1. **OAuth consent screen:** App domain, authorized domains, privacy policy URL, support email, and **all** scopes listed.
2. For each sensitive/restricted scope, add clear **justifications** (examples):
  - **spreadsheets.currentonly** — Read/write the **current** spreadsheet to write connector output the user requests.
  - **userinfo.email** — Map Google identity to the Monstera Cloud account and subscription.
  - **script.external_request** — Call Monstera backend APIs.
  - **script.container.ui** — Sidebar UI in Sheets.
  - **script.scriptapp** — Runtime / OAuth token access for the add-on.
3. **Submit for verification**; complete any demo/video steps.
4. Watch for mail from `**api-oauth-dev-verification-reply+...@google.com`** and reply promptly.

**Do not** resubmit Marketplace until verification is approved for this OAuth client/project.

---

## Phase 4 — Website / public surface audit

Until the listing is **approved**:

- Do **not** publish clickable links to **Google Workspace Marketplace**, **workspace.google.com/marketplace**, or **Chrome Web Store** install pages for this app.
- Prefer CTAs such as “Sign up at Monstera” or “Your admin can deploy the add-on” without linking to an unpublished listing.
- Avoid vague **“coming soon”** install language that implies a live Marketplace app.

**Repo scan (this codebase):** No `marketplace.google.com` / `workspace.google.com/marketplace` URLs were found under `monstera-cloud/src`. Re-check **production** deploys, DNS-hosted pages, and any GitHub README linked from the consent screen.

---

## Phase 5 — Resubmit Marketplace + deployment version

1. Confirm **OAuth verification** is complete.
2. Update Marketplace listing (trademarks, screenshots if needed), **Apps Script project key**, and **deployment version** to match the latest **Deploy → New deployment**.
3. Submit **Marketplace** review again.

---

## Suggested order

1. Phase 1 (SDK listing text)
2. Phase 2 (scopes + Sheets API)
3. Phase 3 (verification)
4. Phase 4 (site / README / external pages)
5. Phase 5 (resubmit)

