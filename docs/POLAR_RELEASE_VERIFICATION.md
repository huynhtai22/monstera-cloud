# Polar release verification

This release adds disabled USD Polar checkout and signed subscription-webhook routes. VND PayOS and existing Paddle subscriptions remain unchanged. Public checkout continues to request pilot access; this document is not production payment certification.

## Safeguards

- Checkout requires workspace-owner authorization, configured monthly/annual product IDs, webhook secret, and the production billing flag. Production rejects sandbox configuration.
- A durable workspace checkout intent is committed before creating the external checkout. Concurrent requests reuse the same open checkout. Confirmed payments cannot start another checkout while entitlement delivery is pending.
- A timeout or ambiguous creation failure leaves the intent blocked for operator review. Do not clear it and retry blindly: locate the attempt in Polar using its `checkout_attempt` metadata, verify the workspace/customer/product and payment state, and reconcile the existing checkout. Replacement is allowed only after the provider confirms failed/expired status.
- Signed lifecycle events reconcile the current provider subscription under subscription/workspace locks. Revocation is durable; replayed activation cannot restore a revoked subscription. Different workspaces, products, providers, and suspended workspaces cannot gain access through those events.
- Provider failures return retryable webhook errors. Customer secrets and raw provider error bodies are not logged.

## Required production acceptance

1. Confirm the catalog price and first-purchase spending cap. Configure approved production product IDs and secrets through the deployment's secure settings. Register the signed webhook endpoint and keep public charging disabled until acceptance.
2. Purchase once through the product as a designated workspace owner. Record checkout, order, subscription, webhook delivery, and workspace entitlement references without recording card details or tokens.
3. Verify exactly that workspace receives the agreed entitlement; a second workspace stays unchanged. Repeat the webhook and confirm no duplicate entitlement or purchase. Verify scheduled cancellation, payment recovery, and revocation against provider state.
4. Verify refund handling and actual payout settlement separately. An approved seller, verified identity, or connected payout account alone does not prove money movement.
5. Complete a real customer reporting journey: consent, selected account/date import, comparison with native provider totals, rendered destination inspection, then delivery receipt and readiness. An empty import is not zero-activity evidence.
6. Activate only the verified pilot scope, with its agreed refresh policy and an observed operational run. No global capacity or paid-launch claim follows from synthetic tests.

## Evidence boundary at preparation

The seller dashboard showed organization approval, verified identity, and a connected payout account. Its active catalog contained no products. No production payment or payout was performed. The designated live reporting import returned zero rows; provider access and the Sheets add-on installation remained outstanding. No spreadsheet output or pilot acceptance was certified.

Automated coverage uses disposable PostgreSQL and synthetic provider responses. It verifies lifecycle replay, tenant binding, checkout concurrency, ambiguous failures, expiry, and signature/configuration gates; it does not replace the production acceptance above.
