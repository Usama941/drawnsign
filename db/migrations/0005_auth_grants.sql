-- Better Auth manages these global tables, so the app role needs full DML on them.
-- None of them is an evidence table.
GRANT UPDATE, DELETE ON sessions, accounts, verifications, two_factors, passkeys TO app_role;
--> statement-breakpoint
GRANT DELETE ON users TO app_role;
--> statement-breakpoint
CREATE FUNCTION current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint
-- Before a tenant is chosen (app.tenant_id unset), a signed-in user may read only their own
-- memberships and the tenants they belong to. Once app.tenant_id is set, only
-- tenant_isolation applies.
CREATE POLICY own_memberships ON memberships FOR SELECT
  USING (current_tenant_id() IS NULL AND user_id = current_user_id());
--> statement-breakpoint
CREATE POLICY own_tenants ON tenants FOR SELECT
  USING (current_tenant_id() IS NULL
         AND id IN (SELECT tenant_id FROM memberships WHERE user_id = current_user_id()));
