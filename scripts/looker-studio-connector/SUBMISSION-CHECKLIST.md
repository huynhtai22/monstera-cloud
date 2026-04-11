# Looker Studio Community Connector — Google submission form

Use this for the **Looker Studio (Data Studio) Community Connector** review form, not the Google Workspace Marketplace add-on flow.

The form often ends with two optional/required free-text fields. Here is what they mean and what to paste for **Monstera Cloud**.

---

## 1) Exception for `urlFetchWhitelist` or `template` (max ~2000 chars)

**When Google asks this:** Your `appsscript.json` may omit `urlFetchWhitelist` and/or `template`. Reviewers want a short explanation.

**What to say (accurate for this connector):**

- Outbound calls use `UrlFetchApp` only to your production API host (`https://monsteracloud.com`) to fetch reporting data the user requested.
- The connector uses **KEY** auth; the user pastes a workspace API key. No arbitrary third-party URLs are fetched.
- If you did not use a `template` property, state that the connector does not rely on a template manifest.

**Suggested paste (edit URLs if yours differ):**

> This community connector uses UrlFetch only to call the Monstera Cloud API at `https://monsteracloud.com` (e.g. `/api/looker-studio`) over HTTPS. Requests are authenticated with a user-provided workspace API key; the connector does not fetch arbitrary third-party URLs. We did not add a `template` property because the connector does not use a template-based manifest workflow. If a `urlFetchWhitelist` is required for approval, we can add an explicit whitelist limited to `https://monsteracloud.com/*`.

---

## 2) Additional comments

**When Google asks this:** Extra context for reviewers—what changed, demo video link, support URL, etc.

**Suggested paste (customize):**

> **Connector:** Monstera Cloud — unified campaign metrics (Meta Ads, Google Ads, TikTok Business) for Looker Studio.  
> **Auth:** API key (workspace key from Monstera Cloud Settings).  
> **Support:** https://monsteracloud.com/support  
> **Demo video (if applicable):** https://monsteracloud.com/showcase/your-demo.mp4  
> **Recent updates:** [e.g. platform filter aligned to `meta_ads` / `google_ads` / `tiktok_business`; date parsing for Looker Studio date ranges; CPM field added.]

---

## Repo alignment

- Connector code: `scripts/looker-studio-connector/Code.js`
- Manifest: `scripts/looker-studio-connector/appsscript.json` (`dataStudio` block)
- Backend: `src/app/api/looker-studio/route.ts`

**Dry run before you record the community screencast:** follow `MOCKUP-TEST.md` in this folder (rehearsal steps + `curl` smoke test).
