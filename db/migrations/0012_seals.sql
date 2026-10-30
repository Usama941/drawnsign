CREATE TYPE "public"."seal_mode" AS ENUM('DEVELOPMENT', 'PRODUCTION');--> statement-breakpoint
CREATE TABLE "completion_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"envelope_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"seal_mode" "seal_mode" NOT NULL,
	"seal_certificate" text NOT NULL,
	"sealed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "completion_certificates_version_key" UNIQUE("document_version_id")
);
--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "seal_mode" "seal_mode";--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "seal_certificate" text;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "sealed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "timestamp_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "completion_certificates" ADD CONSTRAINT "completion_certificates_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_certificates" ADD CONSTRAINT "completion_certificates_version_fk" FOREIGN KEY ("tenant_id","document_version_id") REFERENCES "public"."document_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;