# Disaster-recovery rehearsal

The committed rehearsal is intentionally incapable of accepting a production
database URL. It creates two disposable PostgreSQL 16 containers, migrates and
seeds the source, produces a custom-format logical backup, encrypts it with
AES-256-GCM, restores it into the second database, verifies a canary row, and
checks schema drift. Containers and plaintext files are removed on exit.

Run from the repository root with Docker available:

```bash
DR_REHEARSAL_CONFIRMATION=LOCAL_DISPOSABLE_ONLY \
DR_BACKUP_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
bash scripts/rehearse-database-restore.sh
```

The command prints one sanitized JSON result with measured simulated RPO/RTO,
an encrypted-backup checksum, and the canary count. It never prints a database
URL or key. This local proof validates the procedure, not Neon backup access,
production recovery time, or real-world RPO. A production-derived restore
still requires the authority, independent approver, and evidence format in
`docs/OPERATIONS_ACCEPTANCE.md`.

Latest repository verification: **2026-09-20**, disposable PostgreSQL 16,
encrypted backup and canary restore passed, measured simulated RPO 3 seconds
and RTO 1 second, and Prisma reported no schema drift. These timings describe
only the local synthetic rehearsal.
