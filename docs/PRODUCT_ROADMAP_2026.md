# Monstera Cloud product roadmap — 2026

**Authoritative product roadmap.** `priorities.md` and `roadmap.md` retain supporting engineering context and link here rather than competing with it.

## 1. Product position

**Target customer.** Small and midsized performance-marketing agencies and multi-brand teams in Southeast Asia managing multiple advertising accounts and recurring client reporting.

**Core problem.** Teams spend too much time proving whether reporting data arrived, is current, and is safe to deliver. A connector that says “connected” while a customer is stale, partially imported, or unavailable moves that burden back to the agency.

**Promise.** Monstera provides reporting-ready marketing data with visible operational truth: what is connected, what data is current, what failed, and what action is safe.

**Competitive wedge.** Reliable synchronization, explicit data health, multi-client operations, regional advertising and commerce depth, and practical recovery support—not the longest connector catalogue.

**Explicit non-goals.** Monstera is not yet a full BI dashboard builder, attribution platform, marketing-mix model, general warehouse, CDP, media-buying automation system, or generic AI chat product.

**Why this is defensible.** The codebase already has tenant guardrails, encrypted connections, retained history on disconnect, lease/fencing protection, warehouse normalization, Sources, Dashboard, Runs, Sheets, and Looker delivery surfaces. Focusing those foundations on correctness and recovery compounds across every agency account; shallow connectors do not.

## 2. North-star metric

### Weekly verified report-ready client datasets

A dataset counts only when its required sources are connected; the latest sync completed acceptably; freshness is within the applicable threshold; no unresolved partial or permanent failure exists; the required reporting dates exist; a configured destination can retrieve it; and currency plus reporting context are known.

The repository has pieces of this evidence (`Connection.lastSyncAt`, `lastError`, `CampaignMetric.MAX(date)`, import outcomes, destination connections), but does not yet record a durable report-ready event or all context in one query. Measurement therefore progresses in stages:

1. **Pilot:** operator checklist and reconciliation record per client dataset.
2. **Health foundation:** derive per-connection health and data coverage consistently.
3. **Reporting readiness:** persist a scoped readiness evaluation with the reporting window, destination, currency, and conversion semantics.

## 3. Supporting metrics

| Area | Metrics | Measurement posture |
| --- | --- | --- |
| Activation | Time to first connected account; first verified sync; first usable destination; onboarding completion | Existing connection, sync, and destination events can support a staged internal readout. |
| Reliability | Successful/partial sync rate; freshness compliance; automatic recovery rate; median recovery; duplicate-write rate; reconciliation pass rate | Outcomes and warehouse keys exist; durable reconciliation evidence and account health are next. |
| Commercial | Pilot-to-paid conversion; revenue per managed advertising account; gross margin per workspace; retention; managed-account expansion | Business reporting decision; do not add a tracking vendor merely for this roadmap. |
| Product usage | Weekly active agencies; client workspaces monitored; Needs Attention opened; recovery actions completed; reports marked ready | Events and readiness records should be added only when a pilot decision needs them. |

## 4. Now / Next / Later

### Phase 0 — Controlled-pilot foundation (**Now**)

**Goal:** prove Google Ads end-to-end as the first trusted-data connector, finish release gates, and recruit design partners.

| Feature / decision | User problem and target | Evidence and expected outcome | Dependencies / risk / maintenance | Gate and status |
| --- | --- | --- | --- | --- |
| Google Ads live validation | Agency operator needs a real, bounded report they can trust | Code supports OAuth, MCC discovery, bounded sync, retained history, structured errors, and a guarded seven-day certification evaluator | Still requires approved Google Ads API project access, an authorized live CID, a real import, native reconciliation, destination retrieval, and recovery proof | **Production validation pending.** Do not broaden exposure before a reconciled seven-day run and destination retrieval. |
| Controlled pilot checklist + reconciliation | Operator needs proof before delivery | Identical account, dates, scope, currency, timezone, and conversion semantics make variance explainable | Manual authorized validation; low ongoing cost | Required before claiming Google Ads controlled-pilot readiness. |
| Minimal shared health truth | Agency must distinguish pending, partial, stale, error, and fresh states | Shared resolver, data-through dates, retry/reconnect actions, and Dashboard/Operations/Sources health views are implemented. Scheduled work now uses durable idempotent jobs; cron reports terminal failures; alerts have a retryable PostgreSQL outbox. Production alert receipt and end-to-end customer recovery still need evidence. | Keep displayed state tied to durable sync and account-health evidence; no health claims based on OAuth connection alone. | **Code delivered; pilot acceptance pending.** |
| Five prospective design partners | Product needs external demand signals | Outreach belongs outside this repository | Commercial coordination | Identify before expanding scope; do not claim it is complete here. |

### Phase 1 — Operational Health Foundation (**Code delivered; acceptance next**)

**Goal:** every existing console surface communicates the same connection truth.

Delivered in code: centralized server-side health resolver; deterministic precedence; per-connection data-through date; Dashboard, Sources, source detail, client health, and Operations alignment; actionable attention items; automatic-retry versus user-action guidance; source-health filtering. **No new Health navigation page.**

Acceptance gate: a pilot operator demonstrates locating and recovering each stale, partial, error, disconnected, and unknown source, confirms automatic retry pickup, and receives the configured alert. Until that evidence exists, code delivery does not count as operational acceptance. A dedicated Health Center is reconsidered only when pilot evidence shows Dashboard and Sources are insufficient at multi-client scale.

### Phase 2 — Agency Operations

**Goal:** manage multiple clients without external operations spreadsheets.

Potential deliverables: client portfolio, cross-client summary, authorized roles, reusable onboarding, issue ownership, reporting deadlines, and weekly digest. Entry gate: repeated pilot evidence that existing workspace/source views cannot support the agency’s account volume. Exit gate: operators can assign and clear priority issues across client workspaces.

### Phase 3 — Data Trust

Local implementation: [Report Readiness](./REPORT_READINESS.md) derives scoped client/window evidence in Clients and Reports. The additive [persisted-evidence slice](./REPORT_READINESS_EVIDENCE.md) supplies account timezone/currency, explicit provider/destination requirements and authenticated retrieval receipts. Real READY requires all checks to pass; source reconciliation, expected-account completeness and live destination acceptance still require operator certification.

**Goal:** detect incomplete or inaccurate reporting before client delivery.

Potential deliverables: provider reconciliation, freshness policies, quality rules, schema-change detection, per-account quarantine, lineage, and reporting-readiness checks. Entry gate: validation evidence identifies recurring classes of mismatch. Exit gate: report readiness is attributable to a bounded, inspectable evaluation.

### Phase 4 — Reporting Delivery

**Goal:** reduce time from connection to client-ready reporting.

Potential deliverables: Sheets and Looker templates, canonical fields, explicit conversion semantics, naming/categorization, and BigQuery only if validated. Gate: do not claim blended cross-channel metrics until currency and metric semantics are defined.

### Phase 5 — Regional Advantage

**Goal:** deepen connector coverage where regional teams have genuine unmet needs.

Sequence only after customer validation: Shopee depth, TikTok Ads, Lazada, TikTok Shop, regional currency/time-zone support, Vietnamese and regional documentation. Gate: no connector without confirmed pilot demand and an ownership/maintenance plan.

| Feature / decision | User problem and target | Evidence and expected outcome | Dependencies / risk / maintenance | Gate and status |
| --- | --- | --- | --- | --- |
| TikTok GMV Max reporting (Shop-scoped) | SEA ecommerce advertisers need store/product/livestream GMV Max, not only standard TikTok campaign ROAS | PR #126 sandbox catalog only; no store_id; live call skipped | TikTok Shop store_id + sandbox/live advertiser token as env, not in repo. Ownership/maintenance plan. Confirmed pilot demand (existing Phase 5 gate) | **Blocked — no Shop store_id.** Do not merge #126 to main. Do not advertise GMV Max as a certified route. Reopen only when a store_id exists and the harness records works / 403 / empty from a real call. |

### Phase 6 — Governed Intelligence (**Later**)

**Goal:** provide read-only, evidence-linked insight on verified data.

Potential deliverables: performance briefs, governed MCP tools, Signal Desk, human-approved operational actions. Gate: AI must surface freshness, currency, attribution, and completeness context; it must not present a conclusion as trustworthy when those are unknown.

## 5. Phase gates

- Do not broaden Google Ads exposure before bounded reconciliation and destination retrieval pass.
- Do not create a Health Center before multi-client pilot demand demonstrates that existing surfaces fail.
- Do not add connectors without confirmed pilot demand, a provider-access path, and a maintenance owner.
- Do not build AI analysis before data-health context is available.
- Do not advertise blended cross-channel reporting before currency and metric semantics are explicit.
- Do not move beyond controlled pilot based only on CI; require real-account, real-destination, and operator recovery evidence.
- Do not merge TikTok GMV Max (PR #126) or advertise it until a TikTok Shop store_id proves the report endpoint.

## 6. Prioritization model

\[
\text{Priority}=\frac{\text{Customer frequency}\times\text{Pain severity}\times\text{Willingness to pay}\times\text{Strategic differentiation}}{\text{Build cost}\times\text{Maintenance risk}}
\]

Every proposed feature must record: user problem, target user, evidence, expected outcome, success metric, dependencies, risk, maintenance cost, status, and decision gate. The Phase 0 table is the active application of this model: Google controlled validation and truthful health score highest because they are frequent, painful, revenue-relevant, differentiated, and bounded by existing foundations.

## 7. Explicit exclusions

Do not build yet: hundreds of shallow connectors; a full BI dashboard builder; full attribution; marketing-mix modeling; automated media buying; a general-purpose warehouse; a CDP; white-label portals without validated demand; AI answers without evidence and freshness context; automatic budget changes; or broad enterprise capabilities without signed demand.

## Current evidence and release posture

Google Ads is **code verified — live validation pending**. The deployed connector uses OAuth and the access level of the Google Cloud project that owns its OAuth client; code verification does not prove OAuth, MCC behavior, correct production configuration, metric completeness, tenant safety in a live flow, Sheets delivery, Looker delivery, or controlled-pilot readiness. The detailed evidence procedure is in [google-ads-basic-access.md](./google-ads-basic-access.md).

TikTok GMV Max remains sandbox-only on unmerged #126. No store_id or live certification has been recorded.
