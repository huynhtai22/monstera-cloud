-- Self-serve Start: new workspaces default to free.
-- Does not rewrite existing rows (pilot / paid tenants stay as stored).
ALTER TABLE "Workspace" ALTER COLUMN "plan" SET DEFAULT 'free';
