# Pilot privacy and data handling disclosure

Monstera Cloud stores agency workspace identity, staff membership and roles, encrypted connector credentials, normalized advertising and marketplace metrics, synchronization logs, and selected raw provider payload fields needed for reconciliation and support. API-key secrets are never stored in recoverable form and are displayed only once.

Client records are labels and groupings owned by an agency workspace. Clients do not receive accounts, roles, or portal access in this pilot.

The pilot does not claim a contractual uptime SLA, formal compliance certification, real-time refresh, or guaranteed connector availability. Refresh is manual plus nightly, subject to provider availability and rate limits. Access or deletion requests are handled through the pilot operator while formal self-service retention controls are deferred.

Production credentials and normalized data must remain in approved infrastructure. Do not copy raw payloads, tokens, invitation URLs, OTPs, or API secrets into issue trackers or chat. Security and authorization failures should be retained as structured audit/monitoring events without sensitive values.
