-- Staged database-enforced tenant isolation.
--
-- This file is deliberately NOT a Prisma migration. Apply it only after the
-- application runtime uses a non-owner, non-BYPASSRLS role and every tenant
-- transaction sets `monstera.workspace_id` with SET LOCAL. The table owner is
-- retained as the audited migration/system bypass role.

BEGIN;

DO $policy$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'workspaceId'
      AND c.is_nullable = 'NO'
    ORDER BY c.table_name
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS monstera_workspace_isolation ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY monstera_workspace_isolation ON public.%I USING (
         current_setting(''monstera.system_scope'', true) = ''1''
         OR "workspaceId" = nullif(current_setting(''monstera.workspace_id'', true), '''')
       ) WITH CHECK (
         current_setting(''monstera.system_scope'', true) = ''1''
         OR "workspaceId" = nullif(current_setting(''monstera.workspace_id'', true), '''')
       )',
      table_name
    );
  END LOOP;
END
$policy$;

COMMIT;
