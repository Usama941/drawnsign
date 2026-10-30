-- workspace_type is set once on tenant creation and can never change (CLAUDE.md rule 1).
-- The trigger fires for every role, including the owner and superusers.
CREATE FUNCTION tenants_workspace_type_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_type IS DISTINCT FROM OLD.workspace_type THEN
    RAISE EXCEPTION 'workspace_type is immutable (tenant %)', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER tenants_workspace_type_guard BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION tenants_workspace_type_immutable();
--> statement-breakpoint
ALTER TABLE memberships ADD CONSTRAINT memberships_status_check
  CHECK (status IN ('ACTIVE', 'SUSPENDED'));
--> statement-breakpoint
-- Separate role catalogues per workspace type (PRD section 4). Must match src/auth/permissions.ts.
INSERT INTO workspace_roles (workspace_type, role) VALUES
  ('COMPANY_MANAGED', 'COMPANY_ADMIN'),
  ('COMPANY_MANAGED', 'COMPANY_MANAGER'),
  ('COMPANY_MANAGED', 'COMPANY_EMPLOYEE'),
  ('COMPANY_MANAGED', 'COMPANY_AUDITOR'),
  ('PUBLIC_CUSTOMER', 'CUSTOMER_OWNER'),
  ('PUBLIC_CUSTOMER', 'CUSTOMER_ADMIN'),
  ('PUBLIC_CUSTOMER', 'CUSTOMER_SENDER'),
  ('PUBLIC_CUSTOMER', 'CUSTOMER_VIEWER');
--> statement-breakpoint
-- App role grants. Default is SELECT, INSERT (0000_roles); widen per column only.
REVOKE INSERT ON workspace_roles FROM app_role;
--> statement-breakpoint
GRANT UPDATE (name, email, email_verified, image, two_factor_enabled, updated_at) ON users TO app_role;
--> statement-breakpoint
GRANT UPDATE (name, region, retention_years) ON tenants TO app_role;
--> statement-breakpoint
GRANT UPDATE (role, team_scope, status) ON memberships TO app_role;
--> statement-breakpoint
GRANT UPDATE (accepted_at) ON invitations TO app_role;
