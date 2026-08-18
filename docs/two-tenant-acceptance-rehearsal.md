# Two-Tenant Browser Acceptance Rehearsal

**Target:** Monstera Cloud Agency Pilot  
**Purpose:** Pre-invitation operational rehearsal verifying cross-workspace data isolation, RBAC role floors, and mutation fencing across real browser sessions.

---

## 1. Preparation & Seeding

Ensure the local dev server or preview deployment is running with a connected database:

```bash
# Seed the two pilot workspaces and test accounts
npm run seed-two-tenant-rehearsal
```

### Seeded Credentials & Workspaces

| Workspace | Slug | Role | Email | Password | Seeded Connection |
|---|---|---|---|---|---|
| **Alpha Agency** | `alpha-agency` | Owner | `alice@alpha-agency.test` | `Pilot_Alpha_2026!` | `Alpha Meta Ads Main` (`act_alpha_meta_1001`) |
| **Alpha Agency** | `alpha-agency` | Viewer | `charlie@alpha-agency.test` | `Pilot_Alpha_2026!` | N/A (Read-only member) |
| **Beta Media** | `beta-media` | Owner | `bob@beta-media.test` | `Pilot_Beta_2026!` | `Beta Google Ads Primary` (`customers/beta_gads_2002`) |

---

## 2. Rehearsal Protocol (Multi-Window Setup)

Open three separate private/incognito browser windows:
- **Window A (Tenant A Owner):** Sign in as `alice@alpha-agency.test`.
- **Window B (Tenant B Owner):** Sign in as `bob@beta-media.test`.
- **Window C (Tenant A Viewer):** Sign in as `charlie@alpha-agency.test`.

---

## 3. Acceptance Verification Matrix

### Section 1: Data Explorer & Warehouse Isolation

| # | Action | Expected Result | Status |
|---|---|---|---|
| **1.1** | In **Window A (Alice)**, navigate to `/explorer`. | Displays `Alpha Summer Campaign` & `Alpha Retargeting` under Meta Ads. No Google Ads or Beta metrics visible. | ☐ PASS |
| **1.2** | In **Window B (Bob)**, navigate to `/explorer`. | Displays `Beta Search LeadGen` under Google Ads. No Meta Ads or Alpha metrics visible. | ☐ PASS |
| **1.3** | In **Window B (Bob)**, copy Alice's workspace query URL `GET /api/metrics/query?workspaceId=<Alpha_ID>` directly into the browser/terminal with Bob's cookie. | Returns **403 Forbidden** (Caller does not belong to Alpha Agency). | ☐ PASS |

---

### Section 2: Connection Management & Mutation Fencing

| # | Action | Expected Result | Status |
|---|---|---|---|
| **2.1** | In **Window A (Alice)**, navigate to `/console`. Note the connection ID for `Alpha Meta Ads Main`. | Connection is listed under **Connected Sources**. | ☐ PASS |
| **2.2** | In **Window B (Bob)**, navigate to `/console`. | `Alpha Meta Ads Main` is **not visible**. Only Beta connections appear. | ☐ PASS |
| **2.3** | In **Window B (Bob)**, attempt a direct API call to delete or trigger sync on Alice's connection ID (`POST /api/connections/<Alpha_Connection_ID>/sync`). | Returns **404 Not Found** or **403 Forbidden**; Alice's connection sync timestamp remains unchanged. | ☐ PASS |

---

### Section 3: RBAC Privilege Floor (Owner vs Viewer)

| # | Action | Expected Result | Status |
|---|---|---|---|
| **3.1** | In **Window C (Charlie - Viewer)**, navigate to `/internal-templates`. | Gallery of applicable dashboard templates is viewable. | ☐ PASS |
| **3.2** | In **Window C (Charlie - Viewer)**, attempt to create/instantiate a shared dashboard template (`POST /api/dashboard-templates`). | Button is disabled or action returns **403 Forbidden** (`INSUFFICIENT_ROLE`). | ☐ PASS |
| **3.3** | In **Window C (Charlie - Viewer)**, attempt to delete a connection or create a new API key. | Mutation fails with **403 Forbidden**; only Owners/Admins can manage credentials. | ☐ PASS |

---

### Section 4: API Key Isolation & Looker Extraction

| # | Action | Expected Result | Status |
|---|---|---|---|
| **4.1** | In **Window A (Alice)**, navigate to `/settings` → **API Keys** and generate a new key (`alpha-key-1`). | One-time secret is displayed. Alpha Agency key list updates. | ☐ PASS |
| **4.2** | Execute terminal curl using Alice's key against Looker Studio route: `curl -H "Authorization: Bearer <ALPHA_KEY>" "http://localhost:3000/api/looker-studio?startDate=2026-08-01&endDate=2026-08-05"` | Returns HTTP 200 containing only Alpha Meta Ads rows (`act_alpha_meta_1001`). Zero Beta data. | ☐ PASS |
| **4.3** | In **Window B (Bob)**, navigate to `/settings` → **API Keys**. | Bob sees only Beta keys. Alice's `alpha-key-1` is completely absent. | ☐ PASS |
| **4.4** | In **Window B (Bob)**, attempt to revoke Alice's API key ID via `DELETE /api/settings/api-keys`. | Request fails with **404 Not Found** (scoped by Bob's workspace); Alice's key remains valid. | ☐ PASS |

---

## 4. Operational Sign-Off

| Milestone | Sign-Off Date | Operator | Verdict |
|---|---|---|---|
| Two-Tenant Browser Acceptance Rehearsal | `________________` | `________________` | ☐ Approved for Agency Pilot |
