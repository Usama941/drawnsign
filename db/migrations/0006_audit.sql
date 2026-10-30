CREATE TABLE "audit_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload_sha256" text NOT NULL,
	"prev_hash" text NOT NULL,
	"entry_hash" text NOT NULL,
	CONSTRAINT "audit_ledger_tenant_id_seq_key" UNIQUE("tenant_id","seq")
);
--> statement-breakpoint
CREATE TABLE "ledger_anchors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"anchor_date" date NOT NULL,
	"last_seq" bigint NOT NULL,
	"root_hash" text NOT NULL,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_anchors_tenant_id_anchor_date_key" UNIQUE("tenant_id","anchor_date")
);
--> statement-breakpoint
ALTER TABLE "audit_ledger" ADD CONSTRAINT "audit_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_anchors" ADD CONSTRAINT "ledger_anchors_ledger_fk" FOREIGN KEY ("tenant_id","last_seq") REFERENCES "public"."audit_ledger"("tenant_id","seq") ON DELETE no action ON UPDATE no action;