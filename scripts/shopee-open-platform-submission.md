# Shopee Open Platform — Ads Service Go Live submission copy

This is the authoritative reviewer-facing copy for Monstera Cloud's **Shopee Ads Service** application. It describes only shipped functionality; it is not evidence of Shopee Go Live approval.

## Redirect URLs

Register this production callback exactly:

`https://monsteracloud.com/api/auth/callback?provider=shopee`

For a separate local/test app only, use:

`http://localhost:3000/api/auth/callback?provider=shopee`

Runtime builds `{NEXTAUTH_URL}/api/auth/callback?provider=shopee`. Do not register `/api/auth/shopee/callback`; that route is not implemented.

## Service description

Monstera Cloud connects a seller-authorized Shopee shop to discover non-PII campaign and product identities, retrieve permitted advertising performance, normalize it in a workspace warehouse, and export Shopee Campaigns reports to Google Sheets.

After Shopee OAuth, Monstera discovers Ads campaign identity and ad type, discovers product/item identity for reporting context, requests permitted advertising performance in bounded API windows, and exports the normalized warehouse data through a **Shopee Campaigns** report. It does not retrieve or store buyer names, delivery addresses, phone numbers, or other buyer PII. It does not fabricate impressions, clicks, spend, orders, revenue, or ROAS. If sandbox returns no performance metrics, Monstera shows an honest empty/unavailable result while retaining campaign identity.

Credentials are encrypted at rest. Sanitized source activity may retain endpoint outcomes and provider request IDs, never tokens, Partner Keys, HMAC signatures, request bodies, or authorization URLs containing secrets.

## Reviewer package

Provide separately through Shopee's secure credential field: the live URL `https://monsteracloud.com`, a dedicated Monstera reviewer username/password with no MFA, payment, or email-verification blocker, the reviewer workspace, and support contact. Do not put passwords, tokens, keys, signatures, or pre-authorized URLs in this document or recording.

## Reviewer walkthrough and recording

1. Sign in at `https://monsteracloud.com/login` with the dedicated reviewer account and open its workspace.
2. Open **Sources** and show that the Shopee connection is labelled **Shopee Sandbox**. Redact all secrets.
3. Click **Sync Now**. Use a real Shopee API synchronization—never pasted JSON or a manual database insert.
4. Open source activity and show the sanitized campaign-discovery result.
5. Open Warehouse and verify the known sandbox identity: shop `227420569`, region `VN`, campaign `210343`, ad type `manual`, labelled **Shopee Sandbox**. Known product IDs are `802005656`, `802005655`, and `844132207`.
6. Run **Sync Now** again and show exactly one campaign `210343` warehouse row, updated idempotently rather than duplicated.
7. Open the warehouse-backed Google Sheets **Shopee Campaigns** report. Show its **Shopee Sandbox** label and campaign identity. If no metrics were returned, show the honest empty/unavailable state rather than zeroes.

Attach three redacted screenshots: Sources/safe sync state, Warehouse campaign identity, and the Sheets report. Record the complete sequence above in one unedited video. Blur browser profiles, passwords, OAuth codes, tokens, Partner IDs/Keys, HMAC signatures, and secret-bearing URLs.

## Deployment declarations

- **Test redirect domain:** declare the actual registered test domain, or state that no separate public test redirect is available.
- **Live redirect domain:** `monsteracloud.com`.
- **IP addresses:** Vercel and Neon do not provide Monstera a dedicated static egress IP in the current architecture. Select **IP addresses unavailable / no dedicated static egress** if Shopee's form supports it; never invent IPs.

## Before submission

- [ ] Shopee Partner Center has the exact callback above.
- [ ] Sandbox uses only `SHOPEE_TEST_PARTNER_*`; production uses only `SHOPEE_LIVE_PARTNER_*`.
- [ ] Dedicated reviewer account/workspace, privacy policy, terms, retention/deletion explanation, non-PII declaration, and support contact are live and tested.
- [ ] The authenticated sandbox → warehouse → Google Sheets recording is attached.
- [ ] No production Ads Service access or approval is claimed before Shopee grants Go Live.
