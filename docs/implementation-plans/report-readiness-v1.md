# Report Readiness v1 — local implementation plan

Base inspected: `b3058da` (includes Reports and client brief changes). Preserve the unrelated untracked `docs/connector-region-policy.md`. Do not deploy or contact providers.

1. Add a pure decision function plus a scoped PostgreSQL evidence loader. Reuse `resolveSourceHealthState`; inspect account health, per-item imports, endpoint outcomes, grouped metric dates/currency and client-linked destinations. Check every observed account, not only a provider's maximum date.
2. Add bounded, validated GET single-client/portfolio and POST evaluation endpoints. GET always evaluates the latest saved evidence; POST is read-only computation but follows member-or-higher action policy. No evaluation table: a snapshot would become stale without an invalidation system and does not fill missing evidence.
3. Use the same returned DTO for badges/expandable details on client cards and the selected-client Performance report. Preserve current reports and dispatch behavior; readiness is advisory, not a new export/dispatch gate.
4. Test decisions, query isolation, permissions, sanitization and browser states using the isolated local PostgreSQL harness. Run types, lint, tests, build and Playwright without inherited service credentials.

Safe defaults / evidence limits:

- Client source assignments define the required set for v1, including disconnected sources. No saved independent client/provider manifest exists; report this inferred scope as a warning. Empty assignments are SOURCE_MISSING. Workspace provider entitlements are NOT a client's required set.
- Evaluate the last seven completed UTC date labels by default; allow explicit inclusive windows of at most 90 days. UTC identifies stored warehouse dates, not the provider's reporting timezone.
- No normalized reporting-timezone field exists. Return TIMEZONE_UNKNOWN rather than decrypting credentials or guessing from locale/currency. Therefore current real datasets cannot become READY until that evidence is persisted in a later slice.
- Destination connections/pipelines are configuration, not client/window retrieval proof. Return DESTINATION_UNVERIFIED unless a definite configured destination failure is known. Do not treat API-key existence/usage or unrelated delivery as proof.
- Missing daily account rows are incomplete coverage; zero-activity days cannot be distinguished from absent ingestion yet. Surface this conservative limitation.
- Query limits must produce explicit uncertainty, never a green result from truncated evidence. No raw payloads, credentials, free-text provider errors or recipient addresses in the DTO.
