# Provider Capability Registry V1

The provider capability registry is a pure TypeScript policy data set for deciding whether a provider reporting request is compatible with verified provider limits. V1 is intentionally disconnected from routes, UI, databases, credentials, and provider clients. It makes no database, network, environment, or server-only imports, so a client can safely import its deterministic helpers.

## Contract

`src/lib/provider-capabilities` exports an immutable, versioned default registry and pure APIs:

- `lookupProviderCapability` selects one deterministic record.
- `isCapabilityEffective` evaluates inclusive UTC lifecycle dates.
- `evaluateCapabilityRequest` returns `compatible`, `findings`, stable reason codes, and affected fields. `reasons` remains a deprecated V1 alias for callers already using it.
- `evaluateAttributionWindows` evaluates attribution rules without requiring a complete request evaluation.
- `getAffectedFields` derives a sorted immutable field list from findings.
- `createProviderCapabilityRegistry` creates an isolated evaluator from caller-owned records.

Evaluation requires an explicit `asOf` date, so the same request and registry version always produce the same result. Guidance is static, control-character-sanitized, and capped at 280 characters; untrusted request strings are never interpolated into guidance.

Each record identifies the provider, report surface and type, provider-native capability ID, lifecycle, effective date, optional replacement, optional lookback limit, supported report granularities, attribution restrictions, severity, operator explanation, source reference, and registry version. The default registry and all returned data are deep-frozen. Custom input is cloned before it is frozen, so custom registries never mutate their input, each other, or the default registry.

## Matching and lifecycle selection

Capability identifiers use **exact** matching unless a record explicitly sets `identifierMatch: "prefix"`. A prefix rule matches only strings that start with its declared prefix. If exact and prefix records both match, the exact record wins. Among otherwise equal records, evaluation selects the latest entry effective on `asOf`, then sorts by record ID; it filters future records before selection, so a future retirement cannot shadow the current rule.

Records must provide an ISO UTC calendar effective date. A request before the first effective record remains unaffected by a future lifecycle record; an unrecognized identifier still produces `UNKNOWN_CAPABILITY`.

The same selection machinery resolves each surface's **report rule** — the `standard_totals` report capability — before its attribution restrictions apply. Only records effective on the evaluation date compete, exact matches win over declared prefixes, and the latest effective record wins ties by record ID. The winning record supplies the active attribution policy for the surface: older records remain historical evidence, restrictions are never accumulated across superseded lifecycle versions, and a newer current record with an empty restriction list lifts restrictions an older one declared. A record whose effective date is in the future has no effect before that date.

## Severity and attribution

`error` findings make `compatible` false. `warning` and `info` findings remain compatible and are intended for caller presentation or telemetry; consumers must read `findings`, rather than treating advisory guidance as rejection.

Attribution restrictions can declare `allowedWindows`, `unavailableWindows`, and `forbiddenCombinations`. The evaluator distinguishes unknown, retired/unavailable, and forbidden combination cases with stable reason codes. The default Meta policy recognizes the source-backed one-day view-through window and marks seven-day and 28-day view-through windows unavailable. It also carries both verified hourly Insights breakdown restrictions and only the documented restricted unique-count fields. Unsubstantiated broad report-level and frequency rules are intentionally absent.

## Evidence standard

Every non-obvious limitation must have a public, authoritative source reference and a concise `evidence` note that identifies what the source supports. The source must substantiate the identifier, restriction, effective date, and lookback behavior before a rule is added. Do not infer provider policy from transport code, field mappings, or a similar provider. Google Ads and TikTok Ads are deliberately absent until their own sources support their lifecycle and limit claims.

## Adding a connector without changing consumers

Provider, surface, and report identifiers are extensible string types: editors still autocomplete known values such as `meta_ads`, while new provider strings do not require edits to a closed union. Runtime validation in `createProviderCapabilityRegistry` still requires well-formed records, supported lifecycle/severity/kind values, valid dates, granularities, and source evidence.

Add a provider by defining its immutable records (normally in a provider-local data module), including authoritative evidence and tests, then construct a policy with `createProviderCapabilityRegistry(records)`. Consumers keep using the common lookup/evaluation API and do not need provider-specific branches. Append later lifecycle records rather than rewriting history, and bump `PROVIDER_CAPABILITY_REGISTRY_VERSION` when default data or contract semantics change.

Each report surface's report policy is anchored on its `standard_totals` report record: full request evaluation and attribution evaluation resolve that record with the rules above, so a connector must define it (with a later effective date to supersede an earlier policy).

## Registry authoring rules

Registry construction rejects ambiguous data deterministically, regardless of input order:

- Duplicate `recordId` values fail with the `DUPLICATE_CAPABILITY_RECORD_ID` error code.
- Two records that could compete at equal precedence fail with the `AMBIGUOUS_CAPABILITY_SELECTOR` error code: the same provider, report surface, report type, kind, capability identifier, and effective date — or two declared prefixes on the same date where one is a prefix of the other.
- An exact record and a prefix record for the same identifier can coexist because exact matching strictly precedes prefix matching, and lifecycle versions of the same capability are legitimate when their effective dates differ.

Ambiguous records are rejected whether or not their payloads differ, failure messages are bounded and control-character-sanitized, and a failed construction never mutates caller-owned data or the default registry.

```ts
const policy = createProviderCapabilityRegistry(myProviderRecords);
const result = policy.evaluate(request);
```

## Integration proposal (intentionally deferred)

A later, independent route-integration slice can translate an already validated report request into `CapabilityRequest`, reject only error-severity findings before provider contact, and log reason codes without raw operator input. Route integration is deliberately deferred: this registry change must not alter the current Meta request boundary while parallel remediation work is in progress.
