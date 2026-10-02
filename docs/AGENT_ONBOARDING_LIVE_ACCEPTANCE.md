# Guided onboarding live acceptance

Prepared 2026-10-01. **Live validation is pending.** Local synthetic tests and UI walkthroughs do not certify provider access or actual report ingestion. Onboarding remains behind `ENABLE_AGENT_ONBOARDING`; this change does not deploy or enable it in production.

## Pilot prerequisites

Use a designated pilot workspace, an existing authorized user, and a configured provider app with the exact callback URL. The user performs provider consent through the product. Use deployment-managed secrets; do not paste credentials into chat or acceptance records. Pick accounts with activity in the disclosed import window. Workspace provider access and the plan must permit the requested dates.

## Evidence required for each provider

| Provider | Scope and data check | Additional gate |
| --- | --- | --- |
| TikTok Ads | Consent returns to the original workspace/task; current advertiser inventory appears; only checked advertisers import; actual campaign rows match the approved dates. | Verify durable report-task continuation and a failed-advertiser retry without reimporting successful advertisers. |
| Meta Ads | Current ad-account inventory uses canonical `act_…` IDs; selected accounts import; preview reads ad grain and keeps currencies separate. | Confirm consent denial/replay handling and failed-only account recovery. |
| Google Ads | Consent returns all eligible root connections; disclosure names each root and leaf; select leaves from two roots; imported rows match exact connection/customer pairs. | Verify manager IDs and unselected siblings are never report targets; revoke one leaf and confirm recovery does not widen consent. |
| Shopee | Signed shop lookup matches the connection's shop ID; order creation dates, order counts, order totals and currency match warehouse rows. | Run a shop without Ads access: usable orders can be reviewed, Ads coverage is not claimed, and order failures still block readiness. |

## Walkthrough

1. Record the commit, environment, workspace, provider, run/task/job IDs and selected reporting dates. Identify the reporting client when applicable. Record identifiers only in the appropriate internal acceptance record; exclude tokens, auth codes and raw credentials.
2. Complete provider consent as the authorized account user. Verify callback workspace/task binding, single-use attempt handling and account disclosure. Consent alone must not start the onboarding import.
3. Confirm an explicit account selection and dates. Check the persisted approval against actual job items; repeat the click or refresh and confirm no duplicate job. Check client assignments remain within the chosen client.
4. Compare preview totals with provider/warehouse data at the stated grain. Check currency separation and timezone disclosure. Empty results need an explanation, not ready status. Do not treat order totals as settled revenue or source coverage as a reconciled client report.
5. Exercise denial, an unavailable account, one partial failure and failed-only retry. Reload during work; ensure submitted jobs remain recoverable and the UI follows durable outcomes.
6. Review one usable source, explicitly defer an unfinished source, then finish. Confirm the console opens the same workspace. Return to onboarding and choose **Continue saved sources**: one new run contains deferred providers only, with no inherited consent links, import approval or job. Reload, pause and resume that run. Prior completed tasks, events, approvals and data remain unchanged.
7. Record pass/fail, evidence locations, limitations and follow-up owner. A provider remains pending until its live scope and data checks pass. M5 rollout requires deployment, cohort and operational gates separately.

## Current evidence

The local continuation checks cover concurrent replay, immutable completed history, no automatic import, original client scope, newest-run resume, paused replay, membership/initiator/tenant boundaries, stale versions and the no-deferred-sources case. Browser verification uses the synthetic **M4 local review** workspace. The local environment does not have provider consent configured; no live provider acceptance is claimed.

## Live attempt — 2026-10-01

Status: **blocked before consent**. A browser request to `https://monsteracloud.com/onboarding` returned the application's 404 page. This establishes that the live route was unavailable at the time of the attempt; it does not distinguish an undeployed route from a disabled feature flag. Screenshot: `onboarding-live-availability.png` in the current task's local evidence directory. The browser blocked navigation to the public `/api/integrations/config` endpoint, so its deployed configuration was not verified.

Local inspection found a cached production environment file with Google Ads, Meta and TikTok app credential entries, but credential presence does not establish deployed configuration, account authorization or working consent. Shopee has explicit test credential entries but no explicit live partner credential entries in that snapshot; its production configuration must be verified using the active environment rules before testing a live shop. No credential values were printed or copied into the validation runtime. No live account data was queried and no import was submitted.

The production deployment helper requires a clean checkout whose HEAD equals `origin/main`. The current checkout contains onboarding work and other active changes, so it cannot be deployed through that helper as it stands. Do not bypass this guard or bundle unrelated changes merely to make acceptance possible.

| Provider | Live acceptance result |
| --- | --- |
| TikTok Ads | Blocked: live onboarding unavailable; designated workspace/account scope pending. |
| Meta Ads | Blocked: live onboarding unavailable; designated workspace/account scope pending. |
| Google Ads | Blocked: live onboarding unavailable; designated workspace/account scope pending. |
| Shopee | Blocked: live onboarding unavailable; active live partner configuration and designated shop scope pending. |

To resume: prepare a reviewed onboarding release with its migrations, deploy it through the normal release path, and enable only the designated pilot cohort/providers. Identify the permitted workspace and accounts, then complete consent and the walkthrough above. All four providers remain pending; local tests cannot satisfy these live gates.
