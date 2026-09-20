# Scoped cron credential rollout

PR #183 preserves the existing shared-secret scheduler during deployment. No secret values are created, retrieved, or changed by this code release.

- If a route's scoped secret is configured, only that scoped secret is accepted.
- If it is absent, `CRON_SECRET` remains accepted during transition unless `CRON_ALLOW_LEGACY_SHARED_SECRET=0` is explicitly set.
- The pilot workflow likewise selects each scoped GitHub secret, falling back to the existing GitHub `CRON_SECRET` when absent.
- Missing/short server secrets remain configuration errors; requests without a matching bearer token remain unauthorized.
- Shared-secret compatibility is not least-privilege enforcement. Do not claim the scoped-secret rollout is complete while fallback is active.

## Separate operator configuration rollout

Coordinate a maintenance window for the scheduler and application configuration; do not install one side of a scoped token and let scheduled invocations use mismatched values. Pause scheduled invocation during the configuration cutover if necessary. Install the same independently generated per-route value in both the application and GitHub Actions, deploy the application configuration, then verify authorized scheduled execution. Repeat for every scope and scheduler caller (including any master fan-out). Never log values.

Only after all callers and scoped credentials are verified, explicitly set `CRON_ALLOW_LEGACY_SHARED_SECRET=0`. Verify missing-scope configuration fails closed and a scope's token cannot invoke another scope. Keep `CRON_SECRET` for the daily master route. Do not simply remove the compatibility variable to enforce scopes: unset intentionally preserves compatibility in this release.

The configuration rollout remains pending; the merge does not enable worker mode, global RLS, or background freshness monitoring either.
