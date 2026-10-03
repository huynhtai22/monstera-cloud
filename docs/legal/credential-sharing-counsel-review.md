# Credential-sharing clause — qualified review packet

Status: **engineering draft; not legal approval**.

The current Terms of Service says each human uses an individual account, while
workspace owners may authorize team members, service accounts, shared provider
connections, and integrations within subscription limits. Credible abuse can
be restricted, with notice and an opportunity to correct where reasonable.

## Product behavior counsel should validate

- Browser sessions are revocable and have plan-based concurrent allowances,
  including a temporary grace session; telemetry failures fail open.
- Passwords and bearer keys remain technically transferable. The product uses
  salted pseudonymous observations, rate limits, optional API-key IP pins, and
  owner-visible workspace-scoped device counts to identify abuse.
- API keys are workspace credentials for integrations, not paid human seats.
  Pins are optional because Google/Looker traffic does not originate from one
  stable office address.
- Monstera does not silently charge for a detected device and does not use
  telemetry as the sole basis for billing or irreversible suspension.
- Raw IP addresses and raw user agents are not stored in the seat-sharing
  evidence tables. Current retention target is 90 days.

## Questions requiring qualified Vietnam counsel

1. Is the individual-account restriction and workspace/integration exception
   sufficiently clear and enforceable for Vietnamese B2B customers?
2. What notice, cure period, appeal, and evidence disclosure are required
   before restriction or termination?
3. Does pseudonymous IP/device monitoring require additional privacy notice,
   consent, processor language, or cross-border-transfer disclosure?
4. Should service accounts and agency contractors be expressly licensed by
   plan, and how should shared client-owned provider credentials be treated?
5. Are the limitation, suspension, refund, and mandatory-rights provisions
   consistent with the intended paid pilot agreement?

Record counsel name/role, review date, revision, approved language, and next
review date in an access-controlled legal file. Do not mark this repository
document as approved.
