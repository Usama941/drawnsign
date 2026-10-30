-- An envelope's version (and later its signed version) must belong to its own document.
ALTER TABLE envelopes DROP CONSTRAINT envelopes_version_fk;
--> statement-breakpoint
ALTER TABLE envelopes ADD CONSTRAINT envelopes_version_fk
  FOREIGN KEY (tenant_id, document_id, document_version_id)
  REFERENCES document_versions (tenant_id, document_id, id);
--> statement-breakpoint
ALTER TABLE envelopes ADD CONSTRAINT envelopes_signed_version_fk
  FOREIGN KEY (tenant_id, document_id, signed_version_id)
  REFERENCES document_versions (tenant_id, document_id, id);
--> statement-breakpoint
ALTER TABLE fields ADD CONSTRAINT fields_geometry_check CHECK (
  page >= 1 AND x >= 0 AND y >= 0 AND width > 0 AND height > 0 AND x + width <= 1 AND y + height <= 1);
--> statement-breakpoint
ALTER TABLE recipients ADD CONSTRAINT recipients_routing_order_check CHECK (routing_order >= 1);
--> statement-breakpoint
ALTER TABLE recipients ADD CONSTRAINT recipients_tenant_envelope_email_key
  UNIQUE (tenant_id, envelope_id, email);
--> statement-breakpoint
-- The envelope's hash is the bound version's hash, and the binding freezes on send.
CREATE FUNCTION envelopes_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  allowed text[];
BEGIN
  IF TG_OP = 'INSERT' OR NEW.document_version_id IS DISTINCT FROM OLD.document_version_id THEN
    IF NEW.version_sha256 IS DISTINCT FROM
       (SELECT sha256 FROM document_versions WHERE id = NEW.document_version_id) THEN
      RAISE EXCEPTION 'envelope hash does not match its version' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'DRAFT' AND (
         NEW.document_version_id IS DISTINCT FROM OLD.document_version_id
      OR NEW.version_sha256 IS DISTINCT FROM OLD.version_sha256
      OR NEW.order_mode IS DISTINCT FROM OLD.order_mode
      OR NEW.document_id IS DISTINCT FROM OLD.document_id) THEN
      RAISE EXCEPTION 'envelope is frozen once sent' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.signed_version_id IS NOT NULL AND NEW.signed_version_id IS DISTINCT FROM OLD.signed_version_id THEN
      RAISE EXCEPTION 'signed version is already set' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> OLD.status THEN
      allowed := CASE OLD.status
        WHEN 'DRAFT' THEN ARRAY['SENT', 'VOIDED']
        WHEN 'SENT' THEN ARRAY['COMPLETED', 'DECLINED', 'VOIDED', 'EXPIRED']
        ELSE ARRAY[]::text[]
      END;
      IF NOT (NEW.status::text = ANY (allowed)) THEN
        RAISE EXCEPTION 'envelope status cannot change from % to %', OLD.status, NEW.status
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER envelopes_guard BEFORE INSERT OR UPDATE ON envelopes
  FOR EACH ROW EXECUTE FUNCTION envelopes_guard();
--> statement-breakpoint
CREATE FUNCTION recipients_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  allowed text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (SELECT status FROM envelopes WHERE id = NEW.envelope_id) <> 'DRAFT' THEN
      RAISE EXCEPTION 'recipients can only be added to a draft envelope' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status <> OLD.status THEN
    allowed := CASE OLD.status
      WHEN 'PENDING' THEN ARRAY['NOTIFIED']
      WHEN 'NOTIFIED' THEN ARRAY['SIGNED', 'DECLINED']
      ELSE ARRAY[]::text[]
    END;
    IF NOT (NEW.status::text = ANY (allowed)) THEN
      RAISE EXCEPTION 'recipient status cannot change from % to %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER recipients_guard BEFORE INSERT OR UPDATE ON recipients
  FOR EACH ROW EXECUTE FUNCTION recipients_guard();
--> statement-breakpoint
-- Fields are laid out only on a draft envelope, and filled only by a recipient who is
-- currently signing a sent envelope. A signed recipient's values never change.
CREATE FUNCTION fields_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (SELECT status FROM envelopes WHERE id = NEW.envelope_id) <> 'DRAFT' THEN
      RAISE EXCEPTION 'fields can only be added to a draft envelope' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (SELECT status FROM envelopes WHERE id = NEW.envelope_id) <> 'SENT'
     OR (SELECT status FROM recipients WHERE id = NEW.recipient_id) <> 'NOTIFIED' THEN
    RAISE EXCEPTION 'field values are locked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fields_guard BEFORE INSERT OR UPDATE ON fields
  FOR EACH ROW EXECUTE FUNCTION fields_guard();
--> statement-breakpoint
CREATE FUNCTION signing_tokens_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.document_version_id IS DISTINCT FROM
     (SELECT document_version_id FROM envelopes WHERE id = NEW.envelope_id) THEN
    RAISE EXCEPTION 'signing token must bind the envelope version' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER signing_tokens_guard BEFORE INSERT ON signing_tokens
  FOR EACH ROW EXECUTE FUNCTION signing_tokens_guard();
--> statement-breakpoint
CREATE TRIGGER signature_events_insert_only BEFORE UPDATE OR DELETE ON signature_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER signature_events_no_truncate BEFORE TRUNCATE ON signature_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON signature_events, signing_tokens FROM app_role;
--> statement-breakpoint
GRANT UPDATE (status, void_reason, signed_version_id, document_version_id, version_sha256,
  sent_at, completed_at, updated_at) ON envelopes TO app_role;
--> statement-breakpoint
GRANT UPDATE (status, decline_reason, notified_at, completed_at) ON recipients TO app_role;
--> statement-breakpoint
GRANT UPDATE (value, filled_at) ON fields TO app_role;
--> statement-breakpoint
GRANT UPDATE (attempts, verified_at, session_hash, session_expires_at) ON otp_challenges TO app_role;
--> statement-breakpoint
GRANT UPDATE, DELETE ON rate_limits TO app_role;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['envelopes', 'recipients', 'fields', 'signature_events',
                           'signing_tokens', 'otp_challenges'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id())
                    WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Fixed-window rate limit. Returns true while the key is within its limit.
CREATE FUNCTION rate_limit_hit(p_key text, p_max integer, p_window_seconds integer) RETURNS boolean
LANGUAGE sql AS $$
  INSERT INTO rate_limits (key, window_start, count)
  VALUES (p_key, to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds), 1)
  ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
  RETURNING count <= p_max
$$;
--> statement-breakpoint
-- Signing-link lookup (CLAUDE.md rule 2). The only cross-tenant read for signers: by token
-- hash, returns the tenant and that one recipient, and nothing for expired tokens, recipients
-- who have signed or declined, or envelopes no longer out for signature.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'signing_lookup') THEN
    CREATE ROLE signing_lookup NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT signing_lookup TO %I', current_user);
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO signing_lookup;
--> statement-breakpoint
GRANT SELECT ON signing_tokens, recipients, envelopes, tenants TO signing_lookup;
--> statement-breakpoint
CREATE POLICY signing_lookup_read ON signing_tokens FOR SELECT TO signing_lookup USING (true);
--> statement-breakpoint
CREATE POLICY signing_lookup_read ON recipients FOR SELECT TO signing_lookup USING (true);
--> statement-breakpoint
CREATE POLICY signing_lookup_read ON envelopes FOR SELECT TO signing_lookup USING (true);
--> statement-breakpoint
CREATE POLICY signing_lookup_read ON tenants FOR SELECT TO signing_lookup USING (true);
--> statement-breakpoint
CREATE FUNCTION signing_lookup(p_token_hash text)
RETURNS TABLE (tenant_id uuid, workspace_type workspace_type, envelope_id uuid, recipient_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.tenant_id, tn.workspace_type, t.envelope_id, t.recipient_id
  FROM signing_tokens t
  JOIN recipients r ON r.id = t.recipient_id
  JOIN envelopes e ON e.id = t.envelope_id
  JOIN tenants tn ON tn.id = t.tenant_id
  WHERE t.token_hash = p_token_hash
    AND t.expires_at > now()
    AND r.status = 'NOTIFIED'
    AND e.status = 'SENT'
    AND e.expires_at > now()
    AND t.document_version_id = e.document_version_id
  LIMIT 1
$$;
--> statement-breakpoint
ALTER FUNCTION signing_lookup(text) OWNER TO signing_lookup;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION signing_lookup(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION signing_lookup(text) TO app_role;
--> statement-breakpoint
-- Expiry scan for the scheduled job: ids only; the job re-checks each one inside withTenant().
CREATE FUNCTION due_envelope_expiries(p_limit integer)
RETURNS TABLE (tenant_id uuid, workspace_type workspace_type, envelope_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.tenant_id, tn.workspace_type, e.id
  FROM envelopes e JOIN tenants tn ON tn.id = e.tenant_id
  WHERE e.status = 'SENT' AND e.expires_at <= now()
  ORDER BY e.expires_at
  LIMIT p_limit
$$;
--> statement-breakpoint
ALTER FUNCTION due_envelope_expiries(integer) OWNER TO signing_lookup;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION due_envelope_expiries(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION due_envelope_expiries(integer) TO app_role;
