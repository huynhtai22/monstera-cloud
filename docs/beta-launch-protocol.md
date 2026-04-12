# Beta launch protocol — user zero, then 20 testers

Use this to **fact-check** (does the product match what we claim?), **bug-check** (does it break?), and **decide** (ship, fix, or pause).  
Run **Phase 1** yourself before anyone else. Re-run **Phase 4** on whatever cadence you commit to (e.g. every other release, or every Monday).

---

## How to read the columns


| Label       | Meaning                                                         |
| ----------- | --------------------------------------------------------------- |
| **Factual** | Objective: URL works, copy matches behavior, data is correct.   |
| **Bug**     | Something errors, hangs, or corrupts state.                     |
| **UX**      | Confusing, slow, or wrong affordance — not necessarily a crash. |


Every row should end with **Pass** / **Fail** / **N/A** and a **one-line note** (and screenshot or ticket ID if Fail).

---

## Phase 0 — Pre-flight (once per environment you care about)

Do this before calling yourself “user zero.”

- **Smoke script** — Run the click + `curl` checklist in `[docs/smoke-script.md](./smoke-script.md)` (~15 min). All required steps must **PASS** before invites.
- **Deploy target** — Production URL is the one testers will use; note git SHA or Vercel deployment ID.
- **Secrets & config** — Auth, DB, OAuth apps, API keys for integrations exist in **this** environment (not only local).
- **Legal / product** — Privacy policy and terms URLs load; support or contact path exists.
- **Observability** — You know where logs go (e.g. Vercel) and can find errors in under 2 minutes.
- **Rollback** — You know how to revert to last good deploy if Phase 1 finds a blocker.

**Exit:** All checked, or list **blockers** and stop — do not invite testers.

---

## Phase 1 — You are user zero (first full pass)

**Rules**

1. Use a **clean context**: incognito, or a test email that has never seen the app (or reset account if safe).
2. Do **not** fix mid-flow the first time; **write down** every friction point, then fix in batch.
3. Timebox: **60–90 minutes** for core path; integrations get extra blocks below.

### 1.1 Account & access (Factual + Bug)


| #   | Step                                         | Factual check                            | Bug check                    |
| --- | -------------------------------------------- | ---------------------------------------- | ---------------------------- |
| 1   | Open marketing home                          | Loads, no console errors on first paint  | No infinite spinners         |
| 2   | Register (or invite-only flow if applicable) | Email/terms match reality                | Error messages actionable    |
| 3   | Login / logout / login again                 | Session behaves as documented            | No stuck redirect loops      |
| 4   | Password reset (if offered)                  | Email arrives, link works on prod domain | Token expiry handled clearly |


### 1.2 Core product loop (the “job” users hired you for)

Adapt rows to your app; **replace italic** with your real nouns.


| #   | Step                                                               | Factual check                                   | Bug check                          |
| --- | ------------------------------------------------------------------ | ----------------------------------------------- | ---------------------------------- |
| 5   | Land in main app (e.g. console)                                    | Empty state or data matches **this** user       | Navigation works                   |
| 6   | Create / connect primary **thing** (e.g. source, client, pipeline) | What you save is what reload shows              | No silent failure                  |
| 7   | Trigger sync or import (if any)                                    | Progress or completion is visible               | Failures show reason               |
| 8   | View results (e.g. metrics, table, export)                         | Numbers plausible; timezone/currency consistent | Sorting, filters, pagination       |
| 9   | Destructive action (delete / disconnect)                           | Confirm dialog; item actually gone              | No orphan data if you promise none |


### 1.3 Integrations & API surfaces (if in scope for beta)


| #   | Surface                           | Factual check                         | Bug check                |
| --- | --------------------------------- | ------------------------------------- | ------------------------ |
| 10  | Each OAuth integration            | Callback URL matches prod env         | Revoke + reconnect works |
| 11  | API keys / Looker / Sheets add-on | Docs URL and behavior match           | 401/403 messages clear   |
| 12  | Rate limits or quotas             | Documented limits honored or messaged | No opaque 500s           |


### 1.4 Edge cases (short, high yield)

- **Mobile width** — Usable or honest “desktop recommended.”
- **Slow network** — Throttle in DevTools; no broken blank screens.
- **Double submit** — Double-click pay/connect/save; no duplicate rows if forbidden.
- **Permission** — Second workspace or member role: sees only what they should.

**Phase 1 exit criteria**

- **P0** (cannot test / data loss / security): **zero** open items.
- **P1** (broken core loop): either fixed or **explicitly** out of beta scope with tester communication.
- Everything else: logged with **P2/P3** for after beta.

---

## Phase 2 — Cross-check matrix (every time you “verify” a build)

Use this table to avoid only clicking the happy path.


| Dimension             | Question                                              | Pass if                                          |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| **Claims vs reality** | Does marketing/settings copy match what the app does? | No contradictions you’d be embarrassed to defend |
| **Data integrity**    | After refresh, new tab, re-login — same state?        | Yes, unless eventual consistency is documented   |
| **Auth boundaries**   | Logged-out user cannot hit app APIs                   | 401/redirect, not data leak                      |
| **Errors**            | Unplug network / wrong input                          | User sees **what to do next**                    |
| **Performance**       | Core screens interactive in < ~3s on normal wifi      | Otherwise note for UX feedback                   |


---

## Phase 3 — Twenty-user beta (process, not just access)

### Before invites

- **Scope statement** — One paragraph: what to test, what is **not** ready, how long you need them (e.g. 2 weeks).
- **Channel** — Single place for bugs (form, GitHub Discussions, Slack, etc.); **one** schema for reports.
- **Feedback template** (ask every tester to paste):

```text
1) What you tried:
2) What you expected:
3) What happened (include screenshot if UI):
4) Browser + device:
5) Roughly when (timezone):
```

### During beta

- **Daily (you):** Triage new items → label **P0 / P1 / P2 / UX**.
- **Weekly:** Re-run **Phase 2** on the **current** production deploy after any release.
- **Don’t** debate taste in chat; **capture** and batch UX themes after N≥5 similar notes.

### After beta

- Thank-you + what changed (even “not yet”).
- Archive feedback with dates (spreadsheet or issues).

---

## Phase 4 — “Every other time” hygiene (pick a cadence and stick to it)

Pick **A** or **B** weeks (or “every other deploy”):


| Cadence                   | Focus                                                                                 | Output                     |
| ------------------------- | ------------------------------------------------------------------------------------- | -------------------------- |
| **A week / odd deploys**  | **Factual + regression** — Phase 0 + Phase 2 + `[smoke-script.md](./smoke-script.md)` | Short log: Pass/Fail table |
| **B week / even deploys** | **Bug hunt + UX** — Phase 1 subset (new features only) + exploratory 30 min           | List of P0–P2              |


If you skip B weeks, you’ll only ever **confirm** old paths, not **stress** new ones.

---

## Decision rubric (when you’re unsure whether to invite more testers)


| Situation                         | Action                                                    |
| --------------------------------- | --------------------------------------------------------- |
| P0 > 0                            | Stop invites; fix; re-run Phase 1                         |
| P1 in core loop                   | Invite only if testers are warned; fix in parallel        |
| Only P2/UX                        | Invite; collect signal                                    |
| You cannot reproduce a tester bug | Schedule 15 min screen share or ask for HAR / exact steps |


---

## Optional: Monstera-oriented quick index

Map your real routes here so Phase 1 stays fast:


| Area             | Route or feature                              | Last verified (date) |
| ---------------- | --------------------------------------------- | -------------------- |
| Marketing        | `/`                                           |                      |
| Auth             | `/login`, `/register`                         |                      |
| App shell        | `/console`, `/settings`                       |                      |
| Integrations     | (list)                                        |                      |
| Looker connector | `/looker-studio`, `/api/looker-studio?ping=1` |                      |
| Support / legal  | `/support`, `/legal/...`                      |                      |


---

*Version: 1.0 — tighten this file after your first full run; delete rows that don’t apply.*