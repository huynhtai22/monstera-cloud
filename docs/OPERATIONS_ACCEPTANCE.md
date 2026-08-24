# Production operations acceptance gate

This is an evidence gate, not a statement of intent. Do not mark any item
complete from code review, a configured environment variable, or the presence
of a document alone. Record only non-sensitive identifiers, timestamps, and
links to access-controlled evidence.

## Release owner

| Control | Named owner | Backup owner | Evidence location | Last verified (UTC) | Status |
| --- | --- | --- | --- | --- | --- |
| Monitoring and alert delivery | Unassigned | Unassigned | Unassigned | Unverified | Blocked |
| Database restore authority and drill | Unassigned | Unassigned | Unassigned | Unverified | Blocked |
| Retention policy and deletion approval | Unassigned | Unassigned | Unassigned | Unverified | Blocked |

No production release may describe operational hardening as complete while an
owner or evidence location is unassigned.

## Monitoring and alert delivery

The application has a protected workspace test-notification endpoint at
`POST /api/workspaces/[id]/test-telegram`; scheduled freshness evaluation runs
through `/api/cron/health-tick`, invoked by the Pilot cron workflow every
15 minutes. Those paths prove capability, not delivery.

For each enabled production workspace:

1. An administrator invokes the test-notification control once during a
   defined maintenance window. This deliberately sends one non-sensitive test
   alert; do not place credentials, chat identifiers, or workspace IDs in this
   record.
2. The designated recipient records receipt time and the alert class in the
   access-controlled incident evidence location.
3. The operator records the corresponding application/runtime-log timestamp
   and confirms the health-tick scheduler has a successful run within the last
   30 minutes.
4. The operator demonstrates escalation: acknowledge the alert, create an
   incident record, and assign a responder. Record measured acknowledgement
   time against the SLO once an SLO has an approved owner.

Pass only when every step has timestamped evidence from the same day. A 200
response, configured Telegram variables, or an alert unit test alone is not a
pass.

## Restore drill evidence

1. Name a restore authority and an independent approver before starting.
2. Restore a production backup or point-in-time snapshot into an isolated,
   non-production database. Never use a production target for the drill.
3. Record the backup timestamp, start/end times, restore point used, schema
   migration level, row-count checks for critical tables, and application
   read-only smoke result. Store identifiers only; never store connection URLs
   or credentials.
4. Compare the restored schema to the intended migration state and document
   any drift. Verify at least one representative workspace can be read while
   tenant isolation remains intact.
5. The restore authority and approver sign the evidence record. Set an expiry
   date (recommended: 90 days); an expired drill returns this control to
   unverified.

Rollback remains deployment rollback first. Database restores require incident
approval and must not be used as a routine migration rollback.

## Retention policy ownership

The current pilot data-handling document states formal self-service retention
controls are deferred. Therefore retention is **not active** until the
following decision record is complete:

1. Name a data owner, engineering operator, legal/privacy approver, and a
   backup for each role.
2. Define the retention periods and legal hold process separately for metrics,
   connection metadata, encrypted credentials, audit events, sync logs, and
   backups.
3. Identify each deletion mechanism, its approval requirement, dry-run or
   preview evidence, audit event, and rollback/restore path.
4. Run an isolated non-production expiry test and record the exact affected
   data class, candidate count, deletion count, and post-condition query.
5. Schedule a recurring review. The owner must re-approve any change to a
   retention job, destructive migration, or workspace deletion cascade.

Until these are recorded, do not enable an automated retention job or claim
that production retention is enforced.

## Required evidence format

Each evidence item must include:

- UTC timestamp and operator role;
- deployment revision or immutable release reference;
- environment class (production or isolated drill);
- sanitized result and pass/fail decision;
- link to the access-controlled log, workflow run, or incident record;
- reviewer and expiry date.

Never paste secrets, database URLs, authentication tokens, personal email
addresses, or chat IDs into this repository or an issue tracker.
