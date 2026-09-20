# Telemetry and API-key pin salt rotation

Raw IP addresses and user agents are never persisted. `LOGIN_IP_SALT` creates
pseudonymous telemetry hashes; `API_KEY_PIN_SALT` independently creates the
enforcement hash used by optional API-key network pins. Neither value is an
encryption key, and neither may be reused for `NEXTAUTH_SECRET` or
`ENCRYPTION_KEY`.

## Required production configuration

- Set a random `LOGIN_IP_SALT` and record its non-secret epoch label in
  `LOGIN_IP_SALT_VERSION`.
- Set a different random `API_KEY_PIN_SALT` with
  `API_KEY_PIN_SALT_VERSION=v1` (or the current monotonically increasing
  version).
- Store values only in the deployment secret manager. The repository and
  incident tickets may record versions, dates, and approvers, never values.

## Pin-salt rotation (no outage)

1. Copy the current pin salt and version into
   `API_KEY_PIN_SALT_PREVIOUS` / `API_KEY_PIN_SALT_PREVIOUS_VERSION`.
2. Generate a new random current salt and increment the current version.
3. Deploy and verify both an existing pin and a newly created pin. Existing
   versioned pins accept the matching previous key; pre-versioning pins remain
   compatible with `LOGIN_IP_SALT` during migration.
4. Ask admins to unpin/re-pin active keys. Audit the `api_key.unpinned` and
   `api_key.pinned` events.
5. After the agreed overlap window, confirm no stored pin uses the previous
   version, remove the previous pair, and redeploy.

If the current pin salt is lost before pins are migrated, remove affected pins
through the authenticated admin flow and re-pin; do not weaken validation.

## Telemetry-salt rotation (privacy discontinuity)

Telemetry hashes are observations, not credentials, so there is no need to
accept an old hash at request time. Changing `LOGIN_IP_SALT` deliberately
breaks linkage to the prior epoch. Before rotating, record the new version and
cutover timestamp, allow the current measurement window to close, and annotate
dashboards so distinct-device counts are not compared across the boundary.
Keep `LOGIN_IP_SALT_PREVIOUS` only during legacy pin migration; remove it after
all pre-versioning pins have been replaced.
