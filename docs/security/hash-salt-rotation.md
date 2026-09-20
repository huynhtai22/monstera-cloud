# Telemetry and API-key pin salt rotation

Raw IP addresses and user agents are never persisted. `LOGIN_IP_SALT` creates
HMAC-SHA-256 pseudonyms; `API_KEY_PIN_SALT` independently creates the HMAC used
by optional API-key network pins. `API_KEY_HASH_PEPPER` optionally separates
stored API-key verifiers from the existing domain-separated `ENCRYPTION_KEY`
fallback. None of these values may be reused with each other or with
`NEXTAUTH_SECRET`.

## Required production configuration

- Set a random `LOGIN_IP_SALT` and record its non-secret epoch label in
  `LOGIN_IP_SALT_VERSION`.
- Set a different random `API_KEY_PIN_SALT` with
  `API_KEY_PIN_SALT_VERSION=v1` (or the current monotonically increasing
  version).
- Prefer a third independent random `API_KEY_HASH_PEPPER`. When it is omitted,
  the required `ENCRYPTION_KEY` is domain-separated for API-key verifier HMACs.
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

## API-key verifier pepper rotation

New key verifiers are versioned, domain-separated HMAC-SHA-256 values. Legacy
unkeyed hashes and verifiers produced from the previous pepper remain accepted
only so existing customer keys are not invalidated; successful use upgrades the
database row to the current verifier on a best-effort basis.

1. Copy the current pepper to `API_KEY_HASH_PEPPER_PREVIOUS`.
2. Generate and configure a new independent `API_KEY_HASH_PEPPER`.
3. Deploy, exercise each active integration, and confirm its stored verifier
   starts with the current `h2:` format.
4. After all active keys have upgraded or been rotated, remove the previous
   pepper. Keys that were never exercised must be rotated before removal.
