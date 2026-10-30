-- Runtime role for the application. NOLOGIN: a deployment creates a login role that is a
-- member of app_role (see docs/runbooks/database-roles.md). It never owns tables, is never
-- superuser and never bypasses row-level security.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_role;
--> statement-breakpoint
-- Default for every table the migrator creates from now on: read and insert only.
-- UPDATE/DELETE must be granted per table in the migration that creates it, and never on
-- evidence tables (audit_ledger, amendment_events, signature_events, consent_records,
-- document_versions).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO app_role;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_role;
