-- Staged database-enforced tenant isolation.
--
-- This file is deliberately NOT a Prisma migration. Apply it only after the
-- application runtime uses a non-owner, non-BYPASSRLS role and every tenant
-- transaction sets `monstera.workspace_id` with SET LOCAL. The table owner is
-- retained as the audited migration/system bypass role.

BEGIN;

DO $policy$
DECLARE
  target record;
  tenant_predicate text;
  predicate text;
  relation record;
  system_predicate constant text := '(current_setting(''monstera.system_scope'', true) = ''1'' AND EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = ''monstera_system'' AND pg_has_role(current_user, oid, ''member'')
  ))';
BEGIN
  FOR target IN
    SELECT c.table_name, 'direct' AS kind, NULL::text AS parent, NULL::text AS column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'workspaceId'
      AND t.table_type = 'BASE TABLE'
    UNION ALL SELECT 'Workspace', 'root', NULL, NULL
    UNION ALL SELECT * FROM (VALUES
      ('SyncLog', 'child', 'Pipeline', 'pipelineId'),
      ('SyncCheckpoint', 'child', 'Pipeline', 'pipelineId'),
      ('TransformationRule', 'child', 'Pipeline', 'pipelineId'),
      ('SyncJob', 'child', 'Pipeline', 'pipelineId'),
      ('ShopeeCatalogSyncState', 'child', 'Connection', 'connectionId'),
      ('SchemaVersion', 'child', 'Connection', 'connectionId'),
      ('SyncLogDetail', 'child', 'SyncLog', 'syncLogId')
    ) AS children(table_name, kind, parent, column_name)
  LOOP
    IF target.kind = 'root' THEN
      tenant_predicate := '"id" = nullif(current_setting(''monstera.workspace_id'', true), '''')';
    ELSIF target.kind = 'direct' THEN
      -- NULL workspace rows are private to the system, never global tenant data.
      tenant_predicate := '"workspaceId" = nullif(current_setting(''monstera.workspace_id'', true), '''')';
    ELSE
      -- Parent RLS supplies ownership, including the two-hop log-detail chain.
      tenant_predicate := format('EXISTS (SELECT 1 FROM public.%I p WHERE p."id" = %I.%I)',
        target.parent, target.table_name, target.column_name);
    END IF;
    -- FK integrity checks bypass RLS in PostgreSQL. Explicitly require tenant
    -- parents to be visible too, so an own-workspace row cannot link a rival
    -- connection/client/pipeline through a legacy single-column FK.
    FOR relation IN
      SELECT parent.relname AS parent_name,
        string_agg(format('p.%I = %I.%I', pa.attname, target.table_name, ca.attname), ' AND ' ORDER BY k.i) AS join_sql,
        string_agg(format('%I.%I IS NULL', target.table_name, ca.attname), ' OR ' ORDER BY k.i) AS null_sql
      FROM pg_constraint fk
      JOIN pg_class child ON child.oid = fk.conrelid
      JOIN pg_namespace ns ON ns.oid = child.relnamespace
      JOIN pg_class parent ON parent.oid = fk.confrelid
      CROSS JOIN LATERAL generate_subscripts(fk.conkey, 1) k(i)
      JOIN pg_attribute ca ON ca.attrelid = child.oid AND ca.attnum = fk.conkey[k.i]
      JOIN pg_attribute pa ON pa.attrelid = parent.oid AND pa.attnum = fk.confkey[k.i]
      WHERE fk.contype = 'f' AND ns.nspname = 'public' AND child.relname = target.table_name
        AND (parent.relname = 'Workspace' OR EXISTS (
          SELECT 1 FROM pg_attribute a WHERE a.attrelid = parent.oid AND a.attname = 'workspaceId' AND NOT a.attisdropped
        ))
      GROUP BY fk.oid, parent.relname
    LOOP
      tenant_predicate := '(' || tenant_predicate || ') AND (' || relation.null_sql || ' OR ' ||
        format('EXISTS (SELECT 1 FROM public.%I p WHERE %s)', relation.parent_name, relation.join_sql) || ')';
    END LOOP;
    predicate := '(' || system_predicate || ' OR (' || tenant_predicate || '))';
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.table_name);
    EXECUTE format('DROP POLICY IF EXISTS monstera_workspace_isolation ON public.%I', target.table_name);
    EXECUTE format('DROP POLICY IF EXISTS monstera_workspace_access ON public.%I', target.table_name);
    -- Restrictive fence prevents any other permissive policy widening access.
    EXECUTE format('CREATE POLICY monstera_workspace_isolation ON public.%I AS RESTRICTIVE USING (%s) WITH CHECK (%s)',
      target.table_name, predicate, predicate);
    EXECUTE format('CREATE POLICY monstera_workspace_access ON public.%I AS PERMISSIVE USING (%s) WITH CHECK (%s)',
      target.table_name, predicate, predicate);
  END LOOP;
END
$policy$;

COMMIT;
