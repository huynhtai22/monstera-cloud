#!/usr/bin/env bash
set -euo pipefail

if [ "${RLS_REHEARSAL_CONFIRMATION:-}" != "LOCAL_DISPOSABLE_ONLY" ]; then
  echo "Set RLS_REHEARSAL_CONFIRMATION=LOCAL_DISPOSABLE_ONLY." >&2
  exit 2
fi
command -v docker >/dev/null || { echo "Docker is required" >&2; exit 2; }

run_id="$(date -u +%Y%m%d%H%M%S)-$(openssl rand -hex 4)"
container="monstera-rls-${run_id}"
cleanup() { docker rm -f "${container}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "${container}" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=monstera_rls -p 127.0.0.1::5432 postgres:16 >/dev/null
for _ in $(seq 1 30); do
  docker exec "${container}" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "${container}" pg_isready -U postgres >/dev/null
port="$(docker port "${container}" 5432/tcp | awk -F: '{print $NF}')"
url="postgresql://postgres:postgres@127.0.0.1:${port}/monstera_rls"
DATABASE_URL="${url}" DIRECT_URL="${url}" npx prisma migrate deploy >/dev/null
docker exec -i "${container}" psql -v ON_ERROR_STOP=1 -U postgres -d monstera_rls < scripts/tenant-rls-policy.sql >/dev/null

docker exec -i "${container}" psql -v ON_ERROR_STOP=1 -U postgres -d monstera_rls >/dev/null <<'SQL'
CREATE ROLE monstera_tenant_test NOLOGIN NOBYPASSRLS;
CREATE ROLE monstera_system NOLOGIN NOBYPASSRLS;
CREATE ROLE monstera_system_test NOLOGIN NOBYPASSRLS;
GRANT monstera_system TO monstera_system_test;
GRANT USAGE ON SCHEMA public TO monstera_tenant_test;
GRANT USAGE ON SCHEMA public TO monstera_system_test;
GRANT SELECT, INSERT ON "ApiKey" TO monstera_tenant_test;
GRANT SELECT ON "ApiKey" TO monstera_system_test;
GRANT SELECT ON "Workspace" TO monstera_tenant_test, monstera_system_test;
INSERT INTO "User" ("id", "email") VALUES
  ('rls-user-a', 'rls-a@example.test'),
  ('rls-user-b', 'rls-b@example.test');
INSERT INTO "Workspace" ("id", "name", "slug", "ownerId", "updatedAt") VALUES
  ('rls-ws-a', 'RLS A', 'rls-ws-a', 'rls-user-a', CURRENT_TIMESTAMP),
  ('rls-ws-b', 'RLS B', 'rls-ws-b', 'rls-user-b', CURRENT_TIMESTAMP);
INSERT INTO "ApiKey" ("id", "name", "workspaceId") VALUES
  ('rls-key-a', 'A', 'rls-ws-a'), ('rls-key-b', 'B', 'rls-ws-b');
SQL

visible_a="$(docker exec "${container}" psql -U postgres -d monstera_rls -Atc "SET ROLE monstera_tenant_test; SET monstera.workspace_id='rls-ws-a'; SELECT string_agg(\"id\", ',') FROM \"ApiKey\";")"
test "${visible_a##*$'\n'}" = "rls-key-a"
visible_none="$(docker exec "${container}" psql -U postgres -d monstera_rls -Atc "SET ROLE monstera_tenant_test; SELECT count(*) FROM \"ApiKey\";")"
test "${visible_none##*$'\n'}" = "0"
spoofed_system="$(docker exec "${container}" psql -v ON_ERROR_STOP=1 -U postgres -d monstera_rls -Atc "SET ROLE monstera_tenant_test; SET monstera.system_scope='1'; SELECT count(*) FROM \"ApiKey\";")"
test "${spoofed_system##*$'\n'}" = "0"
reset_context="$(docker exec "${container}" psql -v ON_ERROR_STOP=1 -U postgres -d monstera_rls -Atc "SET ROLE monstera_tenant_test; BEGIN; SET LOCAL monstera.workspace_id='rls-ws-a'; COMMIT; SELECT count(*) FROM \"ApiKey\";")"
test "${reset_context##*$'\n'}" = "0"
system_rows="$(docker exec "${container}" psql -v ON_ERROR_STOP=1 -U postgres -d monstera_rls -Atc "SET ROLE monstera_system_test; SET monstera.system_scope='1'; SELECT count(*) FROM \"ApiKey\";")"
test "${system_rows##*$'\n'}" = "2"
if docker exec "${container}" psql -v ON_ERROR_STOP=1 -U postgres -d monstera_rls -Atc "SET ROLE monstera_tenant_test; SET monstera.workspace_id='rls-ws-a'; INSERT INTO \"ApiKey\" (\"id\",\"name\",\"workspaceId\") VALUES ('cross-tenant','bad','rls-ws-b');" >/dev/null 2>&1; then
  echo "RLS rehearsal failed: cross-tenant insert was accepted" >&2
  exit 1
fi

printf '{"runId":"%s","environment":"local-disposable","result":"pass","sameTenantRows":1,"unscopedRows":0,"crossTenantInsert":"rejected","spoofedSystemRows":0,"postCommitRows":0,"authorizedSystemRows":2}\n' "${run_id}"
