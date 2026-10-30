CREATE TYPE "public"."workspace_type" AS ENUM('COMPANY_MANAGED', 'PUBLIC_CUSTOMER');--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workspace_type" "workspace_type" NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"team_scope" text[] DEFAULT '{}'::text[] NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitations_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workspace_type" "workspace_type" NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"team_scope" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "memberships_tenant_id_user_id_key" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"workspace_type" "workspace_type" NOT NULL,
	"region" text DEFAULT 'uk' NOT NULL,
	"retention_years" integer DEFAULT 7 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_id_workspace_type_key" UNIQUE("id","workspace_type")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workspace_roles" (
	"workspace_type" "workspace_type" NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "workspace_roles_workspace_type_role_pk" PRIMARY KEY("workspace_type","role"),
	CONSTRAINT "workspace_roles_role_unique" UNIQUE("role")
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_fk" FOREIGN KEY ("tenant_id","workspace_type") REFERENCES "public"."tenants"("id","workspace_type") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_fk" FOREIGN KEY ("workspace_type","role") REFERENCES "public"."workspace_roles"("workspace_type","role") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_fk" FOREIGN KEY ("tenant_id","workspace_type") REFERENCES "public"."tenants"("id","workspace_type") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_fk" FOREIGN KEY ("workspace_type","role") REFERENCES "public"."workspace_roles"("workspace_type","role") ON DELETE no action ON UPDATE no action;