import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import {
  documents,
  documentVersions,
  envelopes,
  fields,
  recipients,
  signingTokens,
  tenants,
} from "@/db/schema";
import type { TenantContext, Tx } from "@/db/tenant";
import { hashToken, newToken } from "@/documents/ids";
import type { MailMessage } from "@/lib/mail";
import { objectKey, type Storage } from "@/storage";
import { signingUrl } from "./links";

export const FIELD_TYPES = [
  "SIGNATURE",
  "INITIALS",
  "DATE",
  "TEXT",
  "CHECKBOX",
  "DROPDOWN",
] as const;

const fraction = z.number().min(0).max(1);

export const CreateEnvelope = z
  .object({
    documentId: z.uuid(),
    orderMode: z.enum(["SEQUENTIAL", "PARALLEL"]),
    expiresInDays: z.number().int().min(1).max(90).default(30),
    recipients: z
      .array(z.object({ name: z.string().trim().min(1).max(200), email: z.email().max(320) }))
      .min(1)
      .max(20),
    fields: z
      .array(
        z.object({
          recipient: z.number().int().min(0),
          type: z.enum(FIELD_TYPES),
          page: z.number().int().min(1),
          x: fraction,
          y: fraction,
          width: fraction.positive(),
          height: fraction.positive(),
          required: z.boolean().default(true),
          options: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
        }),
      )
      .min(1)
      .max(500),
  })
  .superRefine((v, ctx) => {
    const emails = v.recipients.map((r) => r.email.toLowerCase());
    if (new Set(emails).size !== emails.length)
      ctx.addIssue({ code: "custom", message: "duplicate recipient email" });
    v.fields.forEach((f, i) => {
      if (f.recipient >= v.recipients.length)
        ctx.addIssue({ code: "custom", message: `field ${i}: unknown recipient` });
      if (f.x + f.width > 1 || f.y + f.height > 1)
        ctx.addIssue({ code: "custom", message: `field ${i}: off the page` });
      if (f.type === "DROPDOWN" && !f.options)
        ctx.addIssue({ code: "custom", message: `field ${i}: dropdown needs options` });
    });
    v.recipients.forEach((_, i) => {
      if (!v.fields.some((f) => f.recipient === i && f.type === "SIGNATURE")) {
        ctx.addIssue({ code: "custom", message: `recipient ${i} has no signature field` });
      }
    });
  });

export class EnvelopeError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Creates a DRAFT envelope bound to the document's current DRAFT version.
export async function createEnvelope(
  tx: Tx,
  ctx: TenantContext & { userId: string },
  input: z.infer<typeof CreateEnvelope>,
  canAccessDocument: (documentId: string) => Promise<boolean>,
): Promise<string> {
  if (!(await canAccessDocument(input.documentId)))
    throw new EnvelopeError(404, "document not found");
  const [doc] = await tx.select().from(documents).where(eq(documents.id, input.documentId));
  if (!doc || doc.status !== "DRAFT" || !doc.currentVersionId) {
    throw new EnvelopeError(409, "document has no draft version to send");
  }
  const [version] = await tx
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, doc.currentVersionId));
  if (!version || version.kind !== "DRAFT")
    throw new EnvelopeError(409, "current version is not a draft");
  if (input.fields.some((f) => f.page > version.pageCount))
    throw new EnvelopeError(400, "field on a page that does not exist");
  const open = await tx
    .select({ id: envelopes.id })
    .from(envelopes)
    .where(and(eq(envelopes.documentId, doc.id), inArray(envelopes.status, ["DRAFT", "SENT"])));
  if (open.length > 0) throw new EnvelopeError(409, "document already has an open envelope");

  const envelopeId = randomUUID();
  await tx.insert(envelopes).values({
    id: envelopeId,
    tenantId: ctx.tenantId,
    documentId: doc.id,
    documentVersionId: version.id,
    versionSha256: version.sha256,
    orderMode: input.orderMode,
    expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000),
    createdBy: ctx.userId,
  });
  const recipientIds = input.recipients.map(() => randomUUID());
  await tx.insert(recipients).values(
    input.recipients.map((r, i) => ({
      id: recipientIds[i]!,
      tenantId: ctx.tenantId,
      envelopeId,
      name: r.name,
      email: r.email.toLowerCase(),
      routingOrder: input.orderMode === "SEQUENTIAL" ? i + 1 : 1,
    })),
  );
  await tx.insert(fields).values(
    input.fields.map((f) => ({
      tenantId: ctx.tenantId,
      envelopeId,
      recipientId: recipientIds[f.recipient]!,
      type: f.type,
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      required: f.type === "SIGNATURE" ? true : f.required,
      options: f.options ?? null,
    })),
  );
  return envelopeId;
}

async function loadEnvelope(tx: Tx, envelopeId: string) {
  const [env] = await tx.select().from(envelopes).where(eq(envelopes.id, envelopeId)).for("update");
  return env ?? null;
}

// Freezes the draft as a SENT version in the write-once evidence store, binds the envelope to
// it, and notifies the first recipients. Returns the emails to send after commit.
export async function sendEnvelope(
  tx: Tx,
  ctx: TenantContext,
  envelopeId: string,
  storage: Storage,
): Promise<MailMessage[]> {
  const env = await loadEnvelope(tx, envelopeId);
  if (!env) throw new EnvelopeError(404, "envelope not found");
  if (env.status !== "DRAFT") throw new EnvelopeError(409, "envelope already sent");
  const [draft] = await tx
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, env.documentVersionId));
  const [doc] = await tx.select().from(documents).where(eq(documents.id, env.documentId));
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId));
  if (!draft || !doc || !tenant || doc.status !== "DRAFT")
    throw new EnvelopeError(409, "document is not a draft");

  const bytes = await storage.getDraft(draft.storageKey);
  if (!bytes || createHash("sha256").update(bytes).digest("hex") !== draft.sha256) {
    throw new Error(`draft bytes missing or altered for version ${draft.id}`);
  }
  const sentId = randomUUID();
  const key = objectKey(ctx.tenantId, "documents", doc.id, `${sentId}.pdf`);
  const retainUntil = new Date(Date.now() + tenant.retentionYears * 365.25 * 86_400_000);
  await storage.putEvidence(key, bytes, "application/pdf", retainUntil);
  await tx.insert(documentVersions).values({
    id: sentId,
    tenantId: ctx.tenantId,
    documentId: doc.id,
    versionNo: 0,
    parentVersionId: draft.id,
    kind: "SENT",
    storageClass: "EVIDENCE",
    storageKey: key,
    sha256: draft.sha256,
    sizeBytes: draft.sizeBytes,
    pageCount: draft.pageCount,
    createdBy: ctx.userId,
  });
  const now = new Date();
  await tx
    .update(envelopes)
    .set({ documentVersionId: sentId, versionSha256: draft.sha256, status: "SENT", sentAt: now })
    .where(eq(envelopes.id, env.id));
  await tx
    .update(documents)
    .set({ status: "SENT", currentVersionId: sentId })
    .where(eq(documents.id, doc.id));
  return notifyNext(tx, ctx, env.id, doc.title);
}

async function issueToken(
  tx: Tx,
  ctx: TenantContext,
  env: { id: string; documentVersionId: string; expiresAt: Date },
  recipientId: string,
): Promise<string> {
  const token = newToken();
  const expiresAt = new Date(Math.min(Date.now() + 30 * 86_400_000, env.expiresAt.getTime()));
  await tx.insert(signingTokens).values({
    tenantId: ctx.tenantId,
    envelopeId: env.id,
    recipientId,
    documentVersionId: env.documentVersionId,
    tokenHash: hashToken(token),
    expiresAt,
  });
  return token;
}

function signingEmail(to: string, name: string, title: string, token: string): MailMessage {
  return {
    to,
    subject: `Please sign: ${title}`,
    text: `Hello ${name},\n\nYou have been asked to sign "${title}".\n\nOpen this link to review and sign:\n${signingUrl(token)}\n\nThe link is personal to you. Do not forward it.\n`,
  };
}

// Notifies the recipients whose turn it is: every pending recipient in parallel mode, or the
// next routing order once all earlier recipients have signed in sequential mode.
export async function notifyNext(
  tx: Tx,
  ctx: TenantContext,
  envelopeId: string,
  title: string,
): Promise<MailMessage[]> {
  const [env] = await tx.select().from(envelopes).where(eq(envelopes.id, envelopeId));
  if (!env || env.status !== "SENT") return [];
  const all = await tx
    .select()
    .from(recipients)
    .where(eq(recipients.envelopeId, envelopeId))
    .orderBy(asc(recipients.routingOrder));
  const unsigned = all.filter((r) => r.status !== "SIGNED");
  if (unsigned.length === 0) return [];
  const turn = Math.min(...unsigned.map((r) => r.routingOrder));
  const due = all.filter((r) => r.status === "PENDING" && r.routingOrder === turn);
  const mail: MailMessage[] = [];
  for (const r of due) {
    await tx
      .update(recipients)
      .set({ status: "NOTIFIED", notifiedAt: new Date() })
      .where(eq(recipients.id, r.id));
    mail.push(signingEmail(r.email, r.name, title, await issueToken(tx, ctx, env, r.id)));
  }
  return mail;
}

export async function remindEnvelope(
  tx: Tx,
  ctx: TenantContext,
  envelopeId: string,
): Promise<MailMessage[]> {
  const env = await loadEnvelope(tx, envelopeId);
  if (!env) throw new EnvelopeError(404, "envelope not found");
  if (env.status !== "SENT") throw new EnvelopeError(409, "envelope is not out for signature");
  const [doc] = await tx.select().from(documents).where(eq(documents.id, env.documentId));
  const waiting = await tx
    .select()
    .from(recipients)
    .where(and(eq(recipients.envelopeId, env.id), eq(recipients.status, "NOTIFIED")));
  const mail: MailMessage[] = [];
  for (const r of waiting) {
    mail.push(signingEmail(r.email, r.name, doc!.title, await issueToken(tx, ctx, env, r.id)));
  }
  return mail;
}

export async function voidEnvelope(tx: Tx, envelopeId: string, reason: string): Promise<void> {
  const env = await loadEnvelope(tx, envelopeId);
  if (!env) throw new EnvelopeError(404, "envelope not found");
  if (env.status !== "DRAFT" && env.status !== "SENT")
    throw new EnvelopeError(409, "envelope cannot be voided");
  await tx
    .update(envelopes)
    .set({ status: "VOIDED", voidReason: reason })
    .where(eq(envelopes.id, env.id));
  if (env.status === "SENT") {
    await tx
      .update(documents)
      .set({ status: "VOIDED" })
      .where(and(eq(documents.id, env.documentId), ne(documents.status, "VOIDED")));
  }
}

export async function getEnvelope(tx: Tx, envelopeId: string) {
  const [env] = await tx.select().from(envelopes).where(eq(envelopes.id, envelopeId));
  if (!env) return null;
  const people = await tx
    .select({
      id: recipients.id,
      name: recipients.name,
      email: recipients.email,
      routingOrder: recipients.routingOrder,
      status: recipients.status,
      declineReason: recipients.declineReason,
      completedAt: recipients.completedAt,
    })
    .from(recipients)
    .where(eq(recipients.envelopeId, envelopeId))
    .orderBy(asc(recipients.routingOrder));
  return {
    id: env.id,
    documentId: env.documentId,
    documentVersionId: env.documentVersionId,
    versionSha256: env.versionSha256,
    orderMode: env.orderMode,
    status: env.status,
    expiresAt: env.expiresAt,
    signedVersionId: env.signedVersionId,
    recipients: people,
  };
}
