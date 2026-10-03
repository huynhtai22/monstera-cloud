# Release-governance decision

## Enforced repository controls

- The `verify` workflow is required for changes proposed to `main`.
- The Security policy workflow runs Gitleaks, npm dependency-integrity checks,
  a CycloneDX SBOM/audit, and CodeQL. As checked on 2026-09-28, those four jobs
  are passing on `main` but are **not** required branch checks; only `verify`
  is required. Requiring them still needs a repository-administrator change.
- Security-sensitive paths have a declared code owner in `.github/CODEOWNERS`.
- A Prisma model with a required direct `workspaceId` must be tenant-guarded or
  carry a documented exception; the schema coverage test enforces this rule.
- Production releases remain subject to the dependency preflight and rollback
  rules in [PILOT_OPERATIONS.md](./PILOT_OPERATIONS.md).

## GA decision boundary

Repository enforcement does not establish runtime evidence. GA remains blocked
until the current acceptance record shows named owners and fresh evidence for:

1. production alert delivery and escalation;
2. an isolated restore drill within its validity period;
3. retention-policy approval and an isolated expiry drill;
4. live connector certification for each provider offered to customers.

Do not remove these conditions by changing documentation alone.
