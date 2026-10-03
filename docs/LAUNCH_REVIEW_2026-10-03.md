# First-phase launch review — 2026-10-03

Recommendation: proceed with a narrow, assisted Vietnam pilot for connectors that pass live acceptance. Do not advertise a paid self-serve, SEA-wide or worldwide service as verified yet. This review does not enable billing, broaden onboarding rollout, change provider permissions or run payments/imports.

## Evidence boundaries

Production was verified serving release `78955b4d51e3fdcd394a5b4c99efefd5666c5939`. Its public `/api/integrations/config` returned Meta Ads, Google Ads, TikTok Business and Shopee true; TikTok Shop, Lazada, Amazon and Shopify false. These are UI/connect flags, not provider approvals. Main CI passed 453 Node tests and 81 browser checks on each desktop/mobile project; the opt-in guided onboarding suite is skipped without `ENABLE_AGENT_ONBOARDING=1`, so those totals do not certify a live onboarding journey.

## Polar: integration exists locally, paid launch is blocked

The owner's original iCloud checkout contains `src/lib/polar-billing.ts`, `/api/checkout/polar`, `/api/webhooks/polar`, the Polar dependency and USD checkout routing. The shipped main release contains none of those Polar files and still routes its dormant USD checkout helper to Paddle. Both public CheckoutButton versions send users to pilot support instead of charging. No billing code was copied between checkouts.

The local Polar implementation has useful safeguards: production flag/environment gates, workspace authorization, rejection of conflicting existing billing providers, product matching, signed SDK webhooks and subscription lifecycle handling. This is implementation evidence only. Seller eligibility, configured products/prices, workspace entitlements, webhook delivery/replay, cancellation/revocation, and an actual payment/payout have not been verified against production.

The code grants `professional` for two configured Pro product IDs; it does not prove every public plan is purchasable. Before paid cutover: release the settled Polar code in its own reviewed change; verify the final catalog against advertised prices and plan limits; verify checkout → signed webhook → correct workspace entitlement; verify cancellation/recovery/revocation and replay behavior; record production seller/payout verification; retain a supported migration/communication path for existing Paddle workspaces. Do not enable charging merely because environment variable names exist.

Polar lists Vietnam as a supported seller country via Stripe Connect Express. That establishes eligibility in principle, not approval of this merchant account or a successful payout. Source: https://polar.sh/docs/merchant-of-record/supported-countries

## Connector geography: capability differs from approval

| Connector | Current production/code evidence | Defensible launch claim |
| --- | --- | --- |
| Meta Ads | Connect flag enabled; global Graph API; account currencies/timezones come from provider data. No current app-review dashboard evidence inspected. | Authorized accounts after scoped live acceptance; SEA/worldwide access not certified. |
| Google Ads | Connect flag enabled; global `googleads.googleapis.com/v23`. Approval of the Google Cloud project owning the OAuth client, permissible use and OAuth publishing state not inspected. | Confirm production access in Google Cloud → Google Ads API Overview for the OAuth client's project, OAuth external-user eligibility, and a real account query. |
| TikTok Ads | Connect flag enabled; global Business API. Approved app scopes and advertiser authorization not independently inspected. | Advertiser-authorized reporting after live acceptance; no blanket regional certification. |
| Shopee | Connect flag enabled; OAuth and Ads policy enforce authoritative `VN` region; production/test keys strictly separated. Orders and Ads are separate capabilities. | Vietnam only; do not promise Ads coverage from successful order import. |
| Lazada / TikTok Shop | Production config disabled. Country routing/review work cannot be inferred from a global hostname. | Exclude from initial ads and launch promises. |

Google access levels control production-account access and permitted API operations: https://developers.google.com/google-ads/api/docs/api-policy/access-levels
TikTok requires advertiser authorization: https://business-api.tiktok.com/gateway/docs/index?doc_id=1738373141733378
TikTok Shop reviews target markets separately: https://partner.tiktokshop.com/docv2/page/app-review-process

Before geographic expansion, record each provider's approval/scopes/production mode, test a non-app-role customer where applicable, and reconcile one authorized account in each advertised market against provider totals for identical dates, currency, timezone and conversion context. Endpoint geography and Monstera workspace location cannot substitute for this evidence.

## Onboarding: suitable for a controlled pilot, broad rollout pending

The implemented journey includes role selection, explicit provider consent, account/date approval, durable jobs, failure recovery, review of actual nonempty warehouse previews and deferred-source continuation. `first-result.ts` only accepts ready tasks with confirmed scope, a matching revision/provider/window, verified nonempty data and usable accounts. These are appropriate first-phase safeguards.

Production code requires `ENABLE_AGENT_ONBOARDING=1` and an explicit `AGENT_ONBOARDING_WORKSPACE_IDS` cohort; an empty production cohort denies access. A historical pilot document does not prove current deployed flags or access for new customers. Existing live-acceptance records still say pending. Source consent or a successful server receipt does not establish reconciled destination output.

Acceptance before calling onboarding launch-ready: a new pilot customer registers/logs in, lands in the intended workspace, authorizes a provider, selects account/date scope, completes import, reviews actual rows, handles one partial failure without widening scope, reloads/resumes, and reaches the same workspace console. For reporting/export promises, independently compare the rendered destination with the warehouse and provider view. Record time to first usable result and assistance required. Use `AGENT_ONBOARDING_LIVE_ACCEPTANCE.md` for the concrete walkthrough.

## Ads recommendation

Small Vietnam pilot-acquisition ads can honestly invite customers to request assisted access once an operator can complete the supported connector journey. Avoid paid self-serve, all-SEA/all-world, all-platform and guaranteed-refresh claims until their specific gates pass. No ads were published in this review.

## Follow-up: 3–5 customer pilot and capacity

Owner supplied “3–5”; interpreted as customers, not accounts, countries or refresh runs. Those other dimensions remain unspecified. A customer count alone cannot certify quota headroom. Existing connector resilience and workload benchmarks cover synthetic retries, concurrency and fairness; they exclude actual provider latency/quotas, database throughput and deployed worker capacity.

Google's September 30, 2026 documentation assigns access to the **Google Cloud project**: Explorer permits 2,880 production operations per sliding 24 hours, Basic 15,000, and Standard removes that daily cap but retains system/service rate limits. Do not use the retired developer-token header as the approval check. [Current Google access policy](https://developers.google.com/google-ads/api/docs/api-policy/access-levels).

For each enabled provider, collect approved scopes/access mode, authorized account count, measured calls per import (including discovery, pagination, polling and retries), quota usage, import duration, oldest queue age and failure/retry counts. Estimate daily calls as accounts × imports per day × measured calls per import, plus discovery and recovery work. Run all pilot workspaces concurrently and replay one failure; confirm no cross-workspace output, duplicate warehouse rows, starvation or scope widening. Record deployed worker/cron executions, rather than deriving a refresh promise from configuration.

Decision: worldwide API hostnames do not prove approval to onboard external users worldwide. Meta/Google/TikTok require account authorization and current app/project approval evidence; Shopee remains VN-only in this release. No provider dashboards, live imports, production quota measurements or payments were inspected in this follow-up. Global paid launch remains unverified; a 3–5-customer assisted pilot can proceed only for individually accepted connectors and markets.

## Follow-up onboarding refinement

First overview now includes actual scoped warehouse sample rows, rejects previews with missing rows or unapproved accounts/dates, withholds amounts when currency is unknown, and exposes a reporting-readiness next step for the reporting goal. Review still means warehouse output review, not independent provider reconciliation or successful destination delivery. Authenticated members outside the invited cohort get a source-management path; no automatic cohort enrollment or import is enabled. The real-customer acceptance record remains required.

Follow-up validation: production build and type checking passed; focused first-result tests 4/4 and synthetic workload benchmark tests 12/12 passed; opt-in PostgreSQL-backed onboarding browser suite 10/10 passed across desktop/mobile with an explicit disposable workspace cohort. These are local fixture results, not live provider capacity or customer acceptance. CI now opts into that cohort to keep guided setup covered without changing deployed rollout flags.

Polar code-path finding: revocation clears the billing provider/subscription ID, but activation accepts a null billing provider. An older active payload can therefore become eligible again after revocation. This replay/order risk must be fixed and regression-tested before paid release; no live incident was observed. See `POLAR_FINAL_CHECK.md`.
