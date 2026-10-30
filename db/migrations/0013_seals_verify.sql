ALTER TABLE completion_certificates DROP CONSTRAINT completion_certificates_version_fk;
--> statement-breakpoint
ALTER TABLE completion_certificates ADD CONSTRAINT completion_certificates_version_fk
  FOREIGN KEY (tenant_id, document_id, document_version_id)
  REFERENCES document_versions (tenant_id, document_id, id);
--> statement-breakpoint
ALTER TABLE completion_certificates ADD CONSTRAINT completion_certificates_envelope_fk
  FOREIGN KEY (tenant_id, envelope_id) REFERENCES envelopes (tenant_id, id);
--> statement-breakpoint
-- Every SIGNED version is sealed, and only SIGNED versions carry a seal.
ALTER TABLE document_versions ADD CONSTRAINT document_versions_seal_check
  CHECK ((kind = 'SIGNED') = (seal_mode IS NOT NULL)
         AND (seal_mode IS NULL OR (seal_certificate IS NOT NULL AND sealed_at IS NOT NULL)));
--> statement-breakpoint
-- The bottom 5% of every page is reserved for the identification footer (PRD section 11).
ALTER TABLE fields ADD CONSTRAINT fields_footer_check CHECK (y + height <= 0.95);
--> statement-breakpoint
CREATE TRIGGER completion_certificates_insert_only BEFORE UPDATE OR DELETE ON completion_certificates
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER completion_certificates_no_truncate BEFORE TRUNCATE ON completion_certificates
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON completion_certificates, verification_tokens FROM app_role;
--> statement-breakpoint
ALTER TABLE completion_certificates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE completion_certificates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON completion_certificates
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
-- Verify-page lookups (CLAUDE.md rule 2, PRD section 12). The only cross-tenant reads for
-- verifiers, owned by a NOLOGIN role whose access is limited to the policies below.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verify_lookup') THEN
    CREATE ROLE verify_lookup NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT verify_lookup TO %I', current_user);
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO verify_lookup;
--> statement-breakpoint
GRANT SELECT ON verification_tokens, document_versions, documents, tenants TO verify_lookup;
--> statement-breakpoint
CREATE POLICY verify_lookup_read ON verification_tokens FOR SELECT TO verify_lookup USING (true);
--> statement-breakpoint
CREATE POLICY verify_lookup_read ON document_versions FOR SELECT TO verify_lookup USING (true);
--> statement-breakpoint
CREATE POLICY verify_lookup_read ON documents FOR SELECT TO verify_lookup USING (true);
--> statement-breakpoint
CREATE POLICY verify_lookup_read ON tenants FOR SELECT TO verify_lookup USING (true);
--> statement-breakpoint
-- With a live token: the tenant and the one version that token is bound to.
CREATE FUNCTION verify_lookup(p_public_id text, p_token_hash text)
RETURNS TABLE (tenant_id uuid, workspace_type workspace_type, document_id uuid, version_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.tenant_id, tn.workspace_type, t.document_id, t.version_id
  FROM verification_tokens t
  JOIN documents d ON d.id = t.document_id
  JOIN tenants tn ON tn.id = t.tenant_id
  WHERE t.token_hash = p_token_hash
    AND d.public_id = p_public_id
    AND t.expires_at > now()
    AND d.status <> 'DELETED'
  LIMIT 1
$$;
--> statement-breakpoint
-- Without a token: only whether the public id exists.
CREATE FUNCTION verify_exists(p_public_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM documents WHERE public_id = p_public_id AND status <> 'DELETED')
$$;
--> statement-breakpoint
ALTER FUNCTION verify_lookup(text, text) OWNER TO verify_lookup;
--> statement-breakpoint
ALTER FUNCTION verify_exists(text) OWNER TO verify_lookup;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION verify_lookup(text, text), verify_exists(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION verify_lookup(text, text), verify_exists(text) TO app_role;
