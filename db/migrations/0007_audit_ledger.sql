-- Hash chain (CLAUDE.md rule 7). Each tenant has its own chain:
--   entry_hash = sha256(prev_hash || '|' || canonical entry)
-- where the canonical entry is seq, ts, actor, action, object and sha256(payload::text),
-- joined by '|'. src/audit/chain.ts mirrors this exactly; keep them in step.
CREATE FUNCTION audit_ledger_canonical(
  p_seq bigint, p_ts timestamptz, p_actor uuid, p_action text, p_object_type text,
  p_object_id text, p_payload_sha256 text
) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|',
    p_seq::text,
    to_char(p_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    coalesce(p_actor::text, ''),
    p_action,
    p_object_type,
    coalesce(p_object_id, ''),
    p_payload_sha256)
$$;
--> statement-breakpoint
CREATE FUNCTION audit_ledger_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  head record;
BEGIN
  -- Serialise appends per tenant so two transactions can never share a prev_hash.
  PERFORM pg_advisory_xact_lock(hashtextextended('audit_ledger:' || NEW.tenant_id::text, 0));

  SELECT seq, entry_hash INTO head FROM audit_ledger
    WHERE tenant_id = NEW.tenant_id ORDER BY seq DESC LIMIT 1;

  NEW.seq := coalesce(head.seq, 0) + 1;
  NEW.ts := clock_timestamp();
  NEW.prev_hash := coalesce(head.entry_hash, repeat('0', 64));
  NEW.payload_sha256 := encode(sha256(convert_to(NEW.payload::text, 'UTF8')), 'hex');
  NEW.entry_hash := encode(sha256(convert_to(
    NEW.prev_hash || '|' || audit_ledger_canonical(NEW.seq, NEW.ts, NEW.actor_id, NEW.action,
      NEW.object_type, NEW.object_id, NEW.payload_sha256), 'UTF8')), 'hex');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_ledger_chain BEFORE INSERT ON audit_ledger
  FOR EACH ROW EXECUTE FUNCTION audit_ledger_chain();
--> statement-breakpoint
-- Insert-only (CLAUDE.md rule 6), for every role. A superuser can still bypass this with
-- session_replication_role; the chain verifier catches that.
CREATE FUNCTION reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is insert-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_ledger_insert_only BEFORE UPDATE OR DELETE ON audit_ledger
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_ledger_no_truncate BEFORE TRUNCATE ON audit_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER ledger_anchors_insert_only BEFORE UPDATE OR DELETE ON ledger_anchors
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON audit_ledger, ledger_anchors FROM app_role;
--> statement-breakpoint
ALTER TABLE audit_ledger ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_ledger FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON audit_ledger
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE ledger_anchors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ledger_anchors FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ledger_anchors
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
--> statement-breakpoint
-- The daily anchor job runs across all tenants. It does so through one SECURITY DEFINER
-- function owned by a NOLOGIN role whose only cross-tenant access is the policies below.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_anchor') THEN
    CREATE ROLE ledger_anchor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT ledger_anchor TO %I', current_user);
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO ledger_anchor;
--> statement-breakpoint
GRANT SELECT ON audit_ledger TO ledger_anchor;
--> statement-breakpoint
GRANT SELECT, INSERT ON ledger_anchors TO ledger_anchor;
--> statement-breakpoint
CREATE POLICY anchor_read ON audit_ledger FOR SELECT TO ledger_anchor USING (true);
--> statement-breakpoint
CREATE POLICY anchor_read ON ledger_anchors FOR SELECT TO ledger_anchor USING (true);
--> statement-breakpoint
CREATE POLICY anchor_write ON ledger_anchors FOR INSERT TO ledger_anchor WITH CHECK (true);
--> statement-breakpoint
-- Records each tenant's chain head as of p_date, once per day, only if the chain moved.
CREATE FUNCTION anchor_ledgers(p_date date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n integer;
BEGIN
  WITH heads AS (
    SELECT DISTINCT ON (tenant_id) tenant_id, seq, entry_hash
    FROM audit_ledger
    WHERE ts < (p_date + 1)::timestamp AT TIME ZONE 'UTC'
    ORDER BY tenant_id, seq DESC
  ), inserted AS (
    INSERT INTO ledger_anchors (tenant_id, anchor_date, last_seq, root_hash)
    SELECT h.tenant_id, p_date, h.seq, h.entry_hash FROM heads h
    WHERE NOT EXISTS (
      SELECT 1 FROM ledger_anchors a
      WHERE a.tenant_id = h.tenant_id AND (a.anchor_date = p_date OR a.last_seq = h.seq))
    RETURNING 1
  )
  SELECT count(*) INTO n FROM inserted;
  RETURN n;
END $$;
--> statement-breakpoint
ALTER FUNCTION anchor_ledgers(date) OWNER TO ledger_anchor;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION anchor_ledgers(date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION anchor_ledgers(date) TO app_role;
