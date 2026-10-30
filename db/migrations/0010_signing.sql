CREATE TYPE "public"."envelope_status" AS ENUM('DRAFT', 'SENT', 'COMPLETED', 'DECLINED', 'VOIDED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."field_type" AS ENUM('SIGNATURE', 'INITIALS', 'DATE', 'TEXT', 'CHECKBOX', 'DROPDOWN');--> statement-breakpoint
CREATE TYPE "public"."order_mode" AS ENUM('SEQUENTIAL', 'PARALLEL');--> statement-breakpoint
CREATE TYPE "public"."recipient_status" AS ENUM('PENDING', 'NOTIFIED', 'SIGNED', 'DECLINED');--> statement-breakpoint
CREATE TYPE "public"."signature_event_type" AS ENUM('CONSENTED', 'OTP_VERIFIED', 'SIGNED', 'DECLINED');--> statement-breakpoint
CREATE TABLE "envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"version_sha256" text NOT NULL,
	"order_mode" "order_mode" NOT NULL,
	"status" "envelope_status" DEFAULT 'DRAFT' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"void_reason" text,
	"signed_version_id" uuid,
	"created_by" uuid NOT NULL,
	"sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "envelopes_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"envelope_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"type" "field_type" NOT NULL,
	"page" integer NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"width" double precision NOT NULL,
	"height" double precision NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"options" text[],
	"value" text,
	"filled_at" timestamp with time zone,
	CONSTRAINT "fields_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"envelope_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"session_hash" text,
	"session_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_challenges_session_hash_unique" UNIQUE("session_hash")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"envelope_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"routing_order" integer NOT NULL,
	"status" "recipient_status" DEFAULT 'PENDING' NOT NULL,
	"decline_reason" text,
	"notified_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipients_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "recipients_tenant_envelope_id_key" UNIQUE("tenant_id","envelope_id","id")
);
--> statement-breakpoint
CREATE TABLE "signature_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"envelope_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"type" "signature_event_type" NOT NULL,
	"version_sha256" text NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"auth_method" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signing_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"envelope_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signing_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "envelopes" ADD CONSTRAINT "envelopes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envelopes" ADD CONSTRAINT "envelopes_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envelopes" ADD CONSTRAINT "envelopes_version_fk" FOREIGN KEY ("tenant_id","document_version_id") REFERENCES "public"."document_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_recipient_fk" FOREIGN KEY ("tenant_id","envelope_id","recipient_id") REFERENCES "public"."recipients"("tenant_id","envelope_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_recipient_fk" FOREIGN KEY ("tenant_id","envelope_id","recipient_id") REFERENCES "public"."recipients"("tenant_id","envelope_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipients" ADD CONSTRAINT "recipients_envelope_fk" FOREIGN KEY ("tenant_id","envelope_id") REFERENCES "public"."envelopes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_events" ADD CONSTRAINT "signature_events_recipient_fk" FOREIGN KEY ("tenant_id","envelope_id","recipient_id") REFERENCES "public"."recipients"("tenant_id","envelope_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_tokens" ADD CONSTRAINT "signing_tokens_recipient_fk" FOREIGN KEY ("tenant_id","envelope_id","recipient_id") REFERENCES "public"."recipients"("tenant_id","envelope_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_tokens" ADD CONSTRAINT "signing_tokens_version_fk" FOREIGN KEY ("tenant_id","document_version_id") REFERENCES "public"."document_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;