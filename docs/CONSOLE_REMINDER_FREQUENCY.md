# Console feature reminder frequency

Automatic display is opt-in for deployment: apply migration `20261003000000_console_reminder_frequency`, regenerate Prisma, deploy, then set `ENABLE_CONSOLE_FEATURE_REMINDERS=1`. Leave it unset to keep manual Page guide replay only. Disabling the flag preserves exposure history.

The `console-introduction` campaign is shown at most once per signed-in user, across workspaces, tabs and devices. Closing, Not now, and Done all stop future automatic introductions. Manual replay from Page guide remains available and does not consume the automatic campaign budget. Minor design/copy edits must retain the campaign ID.

Automatic messages share a rolling 14-day cooldown and a one-message cap per authenticated login session (the stable NextAuth session ID; reloads do not reset it). The introduction is subject to both caps. Database history, not localStorage, is authoritative. A row lock prevents simultaneous tabs/devices claiming multiple messages. Delivery is conservatively reserved before returning: a lost response or interrupted navigation may suppress that message, never retry it repeatedly. Database/auth failures silently suppress reminders, leaving the console functional.

The production trigger lives only in the successfully loaded dashboard. It waits for the startup handoff, a healthy operational status, no refresh/error/reconnection, a visible browser tab, no other dialog/alert and no focused form entry. It checks again after the server responds. Consent, source selection, imports, checkout and error recovery routes never trigger automatic reminders. An unfinished/paused onboarding run blocks server eligibility even if the user already answered their work profile. Reviewed completion allows it; activated legacy workspaces and invited viewers retain a supported entry path.

`src/lib/console-feature-campaigns.ts` is the explicit campaign registry. Only the introduction ships enabled. Future announcements require a distinct message ID, real benefit copy, relevant highlights, allowed membership roles, allowed plans, a start date and an expiry date. Do not enable an announcement until those users can actually use the feature. Retain past campaign IDs and history. Promotions should use dismissible cards by default, not this automatic modal.

Verification before production enablement:

1. Run the frequency unit suite and PostgreSQL concurrency suite against an isolated migrated test database.
2. Sign in as a new test customer, complete/review setup, reach a healthy loaded dashboard: one introduction.
3. Dismiss it; reload, reopen the console in another tab/device, and switch workspaces: no repeat. Page guide manual replay still works.
4. A paused setup, importing/error state, another dialog, focused input or hidden tab must delay automatic display.
5. Test a future eligible announcement with time-controlled fixtures: unavailable role/plan/expired campaigns do not appear; new sessions still obey the 14-day cap.

This implements display frequency. The existing preview remains an intentional always-open design demo and never writes customer history. Exposure reservations are not feature adoption analytics; clicks alone do not certify onboarding, import success or destination output.
