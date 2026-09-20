#!/usr/bin/env bash
set -euo pipefail

if [ "${DR_REHEARSAL_CONFIRMATION:-}" != "LOCAL_DISPOSABLE_ONLY" ]; then
  echo "Set DR_REHEARSAL_CONFIRMATION=LOCAL_DISPOSABLE_ONLY. This script never accepts an external database URL." >&2
  exit 2
fi
if ! [[ "${DR_BACKUP_ENCRYPTION_KEY:-}" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "Set DR_BACKUP_ENCRYPTION_KEY to a disposable 64-hex-character key." >&2
  exit 2
fi
for command in docker node npx openssl; do
  command -v "${command}" >/dev/null || { echo "Missing command: ${command}" >&2; exit 2; }
done

run_id="$(date -u +%Y%m%d%H%M%S)-$(openssl rand -hex 4)"
source_container="monstera-dr-source-${run_id}"
restore_container="monstera-dr-restore-${run_id}"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/monstera-dr.XXXXXX")"

cleanup() {
  docker rm -f "${source_container}" "${restore_container}" >/dev/null 2>&1 || true
  case "${tmp_dir}" in
    "${TMPDIR:-/tmp}"/monstera-dr.*) rm -rf "${tmp_dir}" ;;
  esac
}
trap cleanup EXIT

start_epoch="$(date +%s)"
docker run -d --name "${source_container}" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=monstera_dr -p 127.0.0.1::5432 postgres:16 >/dev/null
docker run -d --name "${restore_container}" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=monstera_dr -p 127.0.0.1::5432 postgres:16 >/dev/null

for container in "${source_container}" "${restore_container}"; do
  for _ in $(seq 1 30); do
    docker exec "${container}" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec "${container}" pg_isready -U postgres >/dev/null
done

source_port="$(docker port "${source_container}" 5432/tcp | awk -F: '{print $NF}')"
restore_port="$(docker port "${restore_container}" 5432/tcp | awk -F: '{print $NF}')"
source_url="postgresql://postgres:postgres@127.0.0.1:${source_port}/monstera_dr"
restore_url="postgresql://postgres:postgres@127.0.0.1:${restore_port}/monstera_dr"

DATABASE_URL="${source_url}" DIRECT_URL="${source_url}" npx prisma migrate deploy >/dev/null
canary_workspace="dr-canary-${run_id}"
docker exec -i "${source_container}" psql -v ON_ERROR_STOP=1 -U postgres -d monstera_dr >/dev/null <<SQL
INSERT INTO "User" ("id", "email") VALUES ('dr-user-${run_id}', 'dr-${run_id}@example.test');
INSERT INTO "Workspace" ("id", "name", "slug", "ownerId", "updatedAt") VALUES ('${canary_workspace}', 'DR canary', '${canary_workspace}', 'dr-user-${run_id}', CURRENT_TIMESTAMP);
SQL

backup_epoch="$(date +%s)"
docker exec "${source_container}" pg_dump -U postgres -d monstera_dr --format=custom --no-owner --no-acl > "${tmp_dir}/backup.dump"
node scripts/dr-backup-crypto.mjs encrypt "${tmp_dir}/backup.dump" "${tmp_dir}/backup.dump.enc"
rm "${tmp_dir}/backup.dump"
node scripts/dr-backup-crypto.mjs decrypt "${tmp_dir}/backup.dump.enc" "${tmp_dir}/restore.dump"
docker exec -i "${restore_container}" pg_restore -U postgres -d monstera_dr --no-owner --no-acl < "${tmp_dir}/restore.dump"

count="$(docker exec "${restore_container}" psql -U postgres -d monstera_dr -Atc "SELECT count(*) FROM \"Workspace\" WHERE \"id\"='${canary_workspace}'")"
test "${count}" = "1"
if ! DATABASE_URL="${restore_url}" DIRECT_URL="${restore_url}" npx prisma migrate diff \
  --from-url "${restore_url}" --to-schema-datamodel prisma/schema.prisma --exit-code > "${tmp_dir}/drift.sql"; then
  echo "Restored schema drifted from prisma/schema.prisma:" >&2
  sed -n '1,200p' "${tmp_dir}/drift.sql" >&2
  exit 1
fi

end_epoch="$(date +%s)"
encrypted_sha="$(shasum -a 256 "${tmp_dir}/backup.dump.enc" | awk '{print $1}')"
printf '{"runId":"%s","environment":"local-disposable","result":"pass","backupEncrypted":true,"backupSha256":"%s","rpoSeconds":%d,"rtoSeconds":%d,"canaryWorkspaceCount":1}\n' \
  "${run_id}" "${encrypted_sha}" "$((backup_epoch - start_epoch))" "$((end_epoch - backup_epoch))"
