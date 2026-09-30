# Dependency availability hardening — 2026-09-30

## Selection and baseline

PR #184 is merged (`f40a5b9f`); this pass incorporates current main `20182649` into the existing dependency PR #196. The current roadmap and known limitations still require an authorized Google Ads pilot and real recovery/alert receipts. This change does not substitute for those acceptance gates.

The immediately actionable release blocker is the high-severity `brace-expansion` dependency audit finding. Before this patch, PR #196's production audit still reported one high vulnerability through the root and two Sentry bundler paths. Its earlier CSV/parser/security upgrades are retained.

## Focused change

Refresh only the ten locked `brace-expansion` copies, preserving each consumer's existing major version and declared ranges:

- 1.1.18 → 1.1.21 (development tooling).
- 2.1.4 → 2.1.7 (root resolution).
- 5.0.9 → 5.0.12 (Sentry bundlers and TypeScript tooling).

No new package, override, application route, database migration or feature flag. The patch bounds recursion and pathological brace rewrites; it reduces known dependency-level availability risk. No claim that the application exposes these attack inputs on a public route.

Maintainer advisories:

- [Quadratic brace rewrite](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr).
- [Nested brace recursion](https://github.com/advisories/GHSA-qhr7-859c-m2p7).
- [Comma parser recursion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p).

## Local checks

Node 22.23.2, clean independent checkout and clean `npm ci`:

- Clean installation: passed; zero reported vulnerabilities.
- Production-only audit with the CI high-severity gate: zero vulnerabilities.
- Complete dependency audit: zero vulnerabilities.
- All ten installed copies: ordinary campaign filename expansion preserved; 5,000 nested braces and a 32,000-character pathological rewrite completed in isolated subprocesses within a two-second timeout, without stack exhaustion. These are bounded local probes, not a formal proof for all inputs.
- TikTok report/OAuth fixtures: 11 passed, including CSV and quoted fields. Network calls were mocked; no customer OAuth or imports were performed.
- CI lint command: zero errors, 69 existing warnings, below the 105-warning gate.
- Production build / TypeScript: passed after cache cleanup.

An initial build ran out of local disk space. Removed this task's disposable loader baseline build caches and restarted the build; no customer/user source files were removed.

## Release boundaries

PR #196 remains a reviewable change. No merge or production deployment is performed in this pass; no production flag is enabled. No customer account, warehouse import or alert recipient was used. CI must verify the exact pushed head before merge. Production pilot and end-to-end recovery/alert acceptance remain pending.
