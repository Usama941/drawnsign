-- A version reference must point at a version of the same document in the same tenant.
ALTER TABLE document_versions
  ADD CONSTRAINT document_versions_tenant_document_id_key UNIQUE (tenant_id, document_id, id);
--> statement-breakpoint
ALTER TABLE documents ADD CONSTRAINT documents_current_version_fk
  FOREIGN KEY (tenant_id, id, current_version_id)
  REFERENCES document_versions (tenant_id, document_id, id);
--> statement-breakpoint
ALTER TABLE verification_tokens DROP CONSTRAINT verification_tokens_version_fk;
--> statement-breakpoint
ALTER TABLE verification_tokens ADD CONSTRAINT verification_tokens_version_fk
  FOREIGN KEY (tenant_id, document_id, version_id)
  REFERENCES document_versions (tenant_id, document_id, id);
--> statement-breakpoint
-- Drafts live in the drafts store; every other version kind is evidence (write-once).
ALTER TABLE document_versions ADD CONSTRAINT document_versions_storage_class_check
  CHECK ((kind = 'DRAFT') = (storage_class = 'DRAFTS'));
--> statement-breakpoint
ALTER TABLE document_versions ADD CONSTRAINT document_versions_sha256_check
  CHECK (sha256 ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
CREATE FUNCTION document_versions_assign() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('document_versions:' || NEW.document_id::text, 0));
  IF NEW.parent_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM document_versions
    WHERE id = NEW.parent_version_id AND document_id = NEW.document_id
  ) THEN
    RAISE EXCEPTION 'parent version belongs to another document' USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.version_no := coalesce(
    (SELECT max(version_no) FROM document_versions WHERE document_id = NEW.document_id), 0) + 1;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER document_versions_assign BEFORE INSERT ON document_versions
  FOR EACH ROW EXECUTE FUNCTION document_versions_assign();
--> statement-breakpoint
-- Insert-only evidence table (CLAUDE.md rules 5 and 6).
CREATE TRIGGER document_versions_insert_only BEFORE UPDATE OR DELETE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER document_versions_no_truncate BEFORE TRUNCATE ON document_versions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON document_versions FROM app_role;
--> statement-breakpoint
-- Document lifecycle (PRD section 8). Content never goes backwards.
CREATE FUNCTION documents_status_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  allowed text[];
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  allowed := CASE OLD.status
    WHEN 'DRAFT' THEN ARRAY['SENT', 'DELETED']
    WHEN 'SENT' THEN ARRAY['PARTIALLY_SIGNED', 'COMPLETED', 'DECLINED', 'VOIDED', 'EXPIRED']
    WHEN 'PARTIALLY_SIGNED' THEN ARRAY['COMPLETED', 'DECLINED', 'VOIDED', 'EXPIRED']
    WHEN 'COMPLETED' THEN ARRAY['AMENDED', 'ARCHIVED']
    WHEN 'AMENDED' THEN ARRAY['COMPLETED', 'ARCHIVED']
    WHEN 'DECLINED' THEN ARRAY['ARCHIVED']
    WHEN 'VOIDED' THEN ARRAY['ARCHIVED']
    WHEN 'EXPIRED' THEN ARRAY['ARCHIVED']
    WHEN 'ARCHIVED' THEN ARRAY['DELETED']
    ELSE ARRAY[]::text[]
  END;
  IF NOT (NEW.status::text = ANY (allowed)) THEN
    RAISE EXCEPTION 'document status cannot change from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'AMENDED' AND (SELECT workspace_type FROM tenants WHERE id = NEW.tenant_id)
       <> 'COMPANY_MANAGED' THEN
    RAISE EXCEPTION 'amendments not permitted for this workspace type' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'DELETED' AND NEW.legal_hold THEN
    RAISE EXCEPTION 'document is under legal hold' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER documents_status_guard BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_status_guard();
--> statement-breakpoint
GRANT UPDATE (title, status, current_version_id, legal_hold, updated_at) ON documents TO app_role;
--> statement-breakpoint
GRANT UPDATE (status, reject_reason, version_id, updated_at) ON uploads TO app_role;
--> statement-breakpoint
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON documents
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE document_versions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON document_versions
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE uploads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON uploads
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE verification_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE verification_tokens FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON verification_tokens
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
