# Billing redesign — 4 September 2026

## Scope and release state

Local implementation only. No production deployment, database migration, real payment, credit, refund, or external message was performed.

## Implemented

- A compact, monochrome Plan & billing view with current plan, trial/access deadline, usage and read-only order history.
- A native modal dialog with keyboard dismissal/focus restoration and a payment review before checkout.
- One public catalog and shared plan cards for `/pricing` and workspace billing: Agency Pro and contact-sales Enterprise. Legacy Studio remains supported internally but is not offered for new purchase.
- Monthly/VND defaults. Agency Pro is 1,490,000 VND for 30 days and 14,900,000 VND for 365 days, sourced from the same configuration used by PayOS order creation.
- Existing public USD quotes remain $79 monthly or $64/month billed annually ($768/year), sales-only. USD selection never starts a VND order.
- English-first pricing with selectable Vietnamese. Both languages use the same numeric catalog.
- Public allowances come from the enforced plan configuration, not a second hardcoded feature list. Connections are distinguished from ad accounts.
- Billing reload errors pause plan changes. Switching workspaces resets the billing dialog/checkout state. Fetched billing state takes precedence over stale workspace props.
- The server rejects invalid billing cycles and requires ownership plus eligibility before creating an order. Legacy paid-tier changes, undated paid entitlements, suspended workspaces and subscriptions managed by another provider require review.
- PayOS checkout uses matching neutral dark surfaces, retaining a high-contrast white QR area.

## Existing payment behavior preserved

Verified PayOS payment extends access by 30/365 days from the later of payment time or the existing access deadline. No browser action activates paid access. The existing expiry job moves dated domestic-payment subscriptions and trials to Free without deleting their workspace or data. Legacy undated access is not expired by that job.

## Decision still required

The founder has not yet confirmed a proration/credit/refund policy. No such financial mechanism was introduced. Self-serve remains a manually approved prepaid bank transfer, not an automatic debit. A different paid-tier change requires billing review. Any new refund/tax policy needs qualified human review.

## Verification and preview

- Full unit suite: 540 passing, 35 database-dependent skips, 0 failures.
- Targeted billing/payment tests: amount parity, owner/workspace restrictions, legacy/provider safeguards, verified signatures, idempotency, renewal extension and underpayment handling.
- Typecheck passes; touched-file lint passes. Full lint has existing warnings and no errors.
- Desktop (1440px) and mobile (390px) browser checks cover trial/paid/Free/legacy/viewer states, monthly default, VND/USD amounts, Vietnamese parity, payment review, Escape/focus, and overflow. Browser checkout calls are intercepted, not sent to PayOS.
- Local UI fixture: `http://localhost:3000/demo/ui/billing`. Synthetic data only; disabled in production. Do not use its checkout with a real account.
- Re-run isolated browser checks with `node scripts/check-billing-ui.mjs` against a development server. It does not use the standard end-to-end database seeding setup.
- Public preview: `http://localhost:3000/pricing`.

## Release gate

Founder review of local UI and explicit deployment approval are required before production changes. Do not infer permission to add proration, auto-debit, refunds, additional tiers or a new billing provider.
