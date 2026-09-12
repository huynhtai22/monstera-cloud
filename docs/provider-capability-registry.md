# Provider Capability Registry V1

The provider capability registry is a pure TypeScript policy data set for deciding whether a provider reporting request is compatible with known provider limits. V1 is intentionally disconnected from routes, UI, databases, credentials, and provider clients.

## Contract

`src/lib/provider-capabilities` exports an immutable, versioned registry plus deterministic lookup, effective-date, listing, and request-evaluation functions. Evaluation requires an explicit `asOf` date, so the same request and registry version always produce the same result. Results use stable reason codes and static, control-character-sanitized operator guidance.

Each record identifies the provider, report surface and type, provider-native capability ID, lifecycle, effective date, optional replacement, optional lookback limit, supported report granularities, attribution restrictions, severity, operator explanation, source reference, and registry version.

V1 contains only verified Meta Ads Insights limitations. Google Ads and TikTok Ads were deliberately not inferred from field mappings or transport code; they should be added only after their lifecycle and limit claims have authoritative references.

## Adding a connector without changing consumers

1. Add provider/report literal values to `types.ts`.
2. Add immutable records to `registry.ts`, including an authoritative provider source and the date it was checked.
3. If a capability changes over time, append a record with a later `effectiveDate`; do not rewrite history.
4. Bump `PROVIDER_CAPABILITY_REGISTRY_VERSION` for any data or contract change.
5. Add boundary tests for the effective date and any lookback, granularity, replacement, or attribution rule.

Consumers continue calling `lookupProviderCapability`, `listProviderCapabilities`, or `evaluateCapabilityRequest`; they do not need provider-specific branches. A future split into per-provider data modules can preserve the same exported API by concatenating and freezing those modules in `registry.ts`.

## Integration proposal (not implemented)

Before a report route calls a provider, a later integration task can translate its validated request body into `CapabilityRequest`, reject error-severity reasons, and log reason codes without logging raw operator input. That integration should be performed independently because the current Meta report route is outside Task B and may overlap parallel feature work.
