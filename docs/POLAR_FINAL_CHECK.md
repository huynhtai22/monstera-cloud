# Polar webhook and product entitlement final check

Status: **not executed against live Polar**. The integration exists in the owner's original iCloud checkout; the reviewed main release does not yet contain Polar routes. Public checkout remains pilot access. Do not configure a production cutover until the integration is reviewed and deployed. Owner's provider direction remains Polar for new USD customers, PayOS/VietQR for VND, and preservation of existing Paddle customers.

## 1. Prepare an isolated sandbox

Deploy the Polar change to a separate test environment. Use two test workspaces: A will subscribe; B must remain unchanged. Use an authorized owner/admin and product login. Never paste keys into this checklist or send customer tokens to agents.

Configure ENABLE_POLAR_BILLING, POLAR_SERVER=sandbox, POLAR_ACCESS_TOKEN, POLAR_WEBHOOK_SECRET, POLAR_PRODUCT_ID_PRO_MONTHLY and POLAR_PRODUCT_ID_PRO_ANNUAL. Use credentials and product IDs from the same sandbox organization. The local implementation intentionally rejects sandbox checkout in production. Configure an HTTPS webhook endpoint at `/api/webhooks/polar` on the test deployment.

Check monthly/annual price, currency, billing interval and advertised limits against the actual configured products. Current code maps those two product IDs to `professional`; this is not evidence that every advertised tier is sold. Test each interval separately.

## 2. Trace checkout to actual access

1. Start checkout from workspace A as its admin. Confirm externalCustomerId and metadata workspace_id identify A, and the selected product matches the requested cycle.
2. Complete the sandbox purchase. Record the checkout, subscription and webhook event IDs in a private evidence log.
3. In Polar's webhook delivery log, confirm the signed subscription.active event reaches the intended endpoint and succeeds. A success redirect alone is insufficient.
4. Inspect server state: A must have subscriptionProvider=polar, the exact subscription ID, professional plan, ACTIVE state and the expected paid-through date. B must retain its prior state.
5. Refresh/login again and perform a real plan-gated product action permitted by Professional. Also test a limit boundary so the effective connection/workspace/seat/history/export entitlement matches the offer. A changed badge alone is insufficient.

## 3. Exercise failures and lifecycle

| Case | Required result / contract to prove |
| --- | --- |
| Subscription created / incomplete checkout | No paid entitlement merely from creation. |
| Invalid signature | Request rejected; both workspaces unchanged. |
| Unknown product ID | No paid entitlement. |
| Cross-workspace metadata / conflicting provider | No tenant crossover or overwrite of existing Paddle billing. |
| Replay of the same signed event | Stable final entitlement; no duplicated side effects. |
| Cancel at period end | Access follows paid-through contract; cancellation is not immediate revocation. |
| Past due | Verify the documented grace/access policy matches local retain-access behavior. |
| Uncancel / renewal | Correct subscription and paid-through date restored. |
| Revoked | Paid entitlement removed for the matching Polar subscription only. |
| Older active/update delivered after revoked | Must not incorrectly regrant access; block release if it does. |
| Refund | Verify explicit refund/access policy; do not assume a refund automatically triggers revocation. |
| Webhook temporarily unavailable | Redelivery restores correct final state without manual plan editing. |

The current local code has a concrete replay risk: `revokePolarSubscription()` clears subscriptionProvider/subscriptionId, while `activatePolarSubscription()` accepts a workspace with subscriptionProvider=null. A delayed, previously valid active/trialing payload for the revoked subscription therefore passes that eligibility condition and can grant Professional again. This is a code-path finding, not a live incident. **Fix and regression-test this before paid release.** Preserve durable subscription/event state and reject stale transitions, or verify authoritative current subscription state before granting; also protect the check/update from concurrent delivery. Confirm cancellation, past-due, refund and expiry semantics with the final customer contract.

## 4. Production paid-launch gate

After sandbox passes and the reviewed integration is deployed: confirm the Polar seller account is approved, production products/prices and signed endpoint are configured, and USD checkout actually routes to Polar. Have the authorized owner perform the agreed real purchase and inspect the production event → workspace entitlement → product action chain. Confirm settlement/payout separately in Polar; a successful charge does not prove payout. Record a rollback/support path and Paddle migration/customer communication before moving existing subscribers.

Vietnam appears on [Polar's supported seller-country list](https://polar.sh/docs/merchant-of-record/supported-countries). This is eligibility in principle; it does not certify this merchant's approval, buyer-country coverage, or payout.

## Evidence to fill in

| Check | Expected | Observed / reference | Pass / fail / not run |
| --- | --- | --- | --- |
| Deployment / environment | Reviewed Polar code, sandbox or production identified | | |
| Catalog monthly / annual | Price and Professional limits match offer | | |
| Signed active event | Delivered successfully to exact endpoint | | |
| Workspace A / B | A granted, B unchanged | | |
| Product action / limit | Server enforces advertised entitlement | | |
| Replay / invalid signature | Stable state / rejected alteration | | |
| Cancel / renew / past due / revoke | Contract-consistent final access | | |
| Reordered active after revoke | No incorrect regrant | | |
| Production charge / settlement / payout | Independently observed, each recorded | | |

Keep full evidence private. Share only sanitized IDs/statuses and results; exclude keys, payment details and customer personal information. Any unexecuted case stays **not run**.
