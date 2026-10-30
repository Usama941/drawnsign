import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { rateLimitHit } from "@/db/signing-lookup";
import {
  documents,
  documentVersions,
  envelopes,
  fields,
  otpChallenges,
  recipients,
  signatureEvents,
  users,
} from "@/db/schema";
import { hashToken, newToken } from "@/documents/ids";
import type { MailMessage } from "@/lib/mail";
import type { SignerContext } from "@/server/signing-route";
import type { Storage } from "@/storage";
import { notifyNext } from "./envelopes";
import { clientIp } from "./links";

export const SIGNER_COOKIE = "ds_signer";
export const CONSENT_TEXT =
  "I agree to use electronic records and signatures for this document, and I understand that my electronic signature is as binding as a handwritten one.";

const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const SIGNER_SESSION_TTL_MS = 60 * 60_000;

export class SignerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function otpHash(challengeId: string, code: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  return createHmac("sha256", secret).update(`${challengeId}:${code}`).digest("hex");
}

function cookieValue(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

async function context(s: SignerContext) {
  const [env] = await s.tx.select().from(envelopes).where(eq(envelopes.id, s.envelopeId));
  const [me] = await s.tx.select().from(recipients).where(eq(recipients.id, s.recipientId));
  const [doc] = env
    ? await s.tx.select().from(documents).where(eq(documents.id, env.documentId))
    : [];
  if (!env || !me || !doc) throw new SignerError(404, "not found");
  return { env, me, doc };
}

async function hasEvent(s: SignerContext, type: "CONSENTED" | "OTP_VERIFIED") {
  const rows = await s.tx
    .select({ id: signatureEvents.id })
    .from(signatureEvents)
    .where(and(eq(signatureEvents.recipientId, s.recipientId), eq(signatureEvents.type, type)))
    .limit(1);
  return rows.length > 0;
}

async function recordEvent(
  s: SignerContext,
  versionSha256: string,
  type: "CONSENTED" | "OTP_VERIFIED" | "SIGNED" | "DECLINED",
  details: Record<string, unknown> = {},
  authMethod: string | null = null,
) {
  await s.tx.insert(signatureEvents).values({
    tenantId: s.tenant.tenantId,
    envelopeId: s.envelopeId,
    recipientId: s.recipientId,
    type,
    versionSha256,
    ip: clientIp(s.req),
    userAgent: s.req.headers.get("user-agent")?.slice(0, 500) ?? null,
    authMethod,
    details,
  });
}

// True when the browser holds a live signer session for this recipient (set after email OTP).
export async function hasSignerSession(s: SignerContext): Promise<boolean> {
  const value = cookieValue(s.req, SIGNER_COOKIE);
  if (!value) return false;
  const rows = await s.tx
    .select({ id: otpChallenges.id })
    .from(otpChallenges)
    .where(
      and(
        eq(otpChallenges.recipientId, s.recipientId),
        eq(otpChallenges.sessionHash, hashToken(value)),
        gt(otpChallenges.sessionExpiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function requireSession(s: SignerContext) {
  if (!(await hasSignerSession(s)))
    throw new SignerError(401, "verify the code sent to your email first");
}

export async function signingView(s: SignerContext) {
  const { env, me, doc } = await context(s);
  const [version] = await s.tx
    .select({ pageCount: documentVersions.pageCount })
    .from(documentVersions)
    .where(eq(documentVersions.id, env.documentVersionId));
  const verified = await hasSignerSession(s);
  const myFields = verified
    ? await s.tx
        .select({
          id: fields.id,
          type: fields.type,
          page: fields.page,
          x: fields.x,
          y: fields.y,
          width: fields.width,
          height: fields.height,
          required: fields.required,
          options: fields.options,
        })
        .from(fields)
        .where(eq(fields.recipientId, me.id))
        .orderBy(asc(fields.page))
    : [];
  return {
    document: {
      title: doc.title,
      publicId: doc.publicId,
      pageCount: version?.pageCount ?? 0,
      sha256: env.versionSha256,
    },
    recipient: { name: me.name, email: me.email },
    consentText: CONSENT_TEXT,
    consented: await hasEvent(s, "CONSENTED"),
    verified,
    fields: myFields,
  };
}

export async function consent(s: SignerContext) {
  const { env } = await context(s);
  if (!(await hasEvent(s, "CONSENTED"))) {
    await recordEvent(s, env.versionSha256, "CONSENTED", {
      textSha256: createHash("sha256").update(CONSENT_TEXT).digest("hex"),
    });
  }
}

export async function sendOtp(s: SignerContext): Promise<MailMessage> {
  const { me, doc } = await context(s);
  if (!(await hasEvent(s, "CONSENTED")))
    throw new SignerError(409, "accept the electronic records consent first");
  if (!(await rateLimitHit(`otp:send:${s.recipientId}`, 3, 15 * 60))) {
    throw new SignerError(429, "too many codes requested; try again later");
  }
  const id = randomUUID();
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await s.tx.insert(otpChallenges).values({
    id,
    tenantId: s.tenant.tenantId,
    envelopeId: s.envelopeId,
    recipientId: s.recipientId,
    codeHash: otpHash(id, code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  return {
    to: me.email,
    subject: `Your signing code for ${doc.title}`,
    text: `Your code is ${code}. It expires in 10 minutes.\n\nIf you did not ask for this code, ignore this email.\n`,
  };
}

// Checks the latest open code. A wrong guess counts even though the request fails, so the
// caller must commit it (commitEvenIfFailed). Returns the signer session cookie value.
export async function verifyOtp(s: SignerContext, code: string): Promise<string> {
  const { env } = await context(s);
  if (!(await rateLimitHit(`otp:verify:${s.recipientId}`, 10, 60 * 60))) {
    throw new SignerError(429, "too many attempts; try again later");
  }
  const [challenge] = await s.tx
    .select()
    .from(otpChallenges)
    .where(
      and(
        eq(otpChallenges.recipientId, s.recipientId),
        isNull(otpChallenges.verifiedAt),
        gt(otpChallenges.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(otpChallenges.createdAt))
    .limit(1)
    .for("update");
  if (!challenge) throw new SignerError(400, "no active code; request a new one");
  if (challenge.attempts >= OTP_MAX_ATTEMPTS)
    throw new SignerError(429, "too many attempts; request a new code");

  const expected = Buffer.from(challenge.codeHash, "hex");
  const actual = Buffer.from(otpHash(challenge.id, code), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    await s.tx
      .update(otpChallenges)
      .set({ attempts: challenge.attempts + 1 })
      .where(eq(otpChallenges.id, challenge.id));
    throw new SignerError(400, "incorrect code");
  }

  const session = newToken();
  await s.tx
    .update(otpChallenges)
    .set({
      verifiedAt: new Date(),
      sessionHash: hashToken(session),
      sessionExpiresAt: new Date(Date.now() + SIGNER_SESSION_TTL_MS),
    })
    .where(eq(otpChallenges.id, challenge.id));
  await recordEvent(s, env.versionSha256, "OTP_VERIFIED", {}, "email_otp");
  return session;
}

export function signerCookie(value: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SIGNER_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SIGNER_SESSION_TTL_MS / 1000}${secure}`;
}

export async function signingDocument(s: SignerContext, storage: Storage): Promise<Uint8Array> {
  await requireSession(s);
  const { env } = await context(s);
  const [v] = await s.tx
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, env.documentVersionId));
  const bytes = v ? await storage.getEvidence(v.storageKey, v.sha256) : null;
  if (!bytes) throw new SignerError(404, "not found");
  return bytes;
}

export const CompleteBody = z.object({
  values: z.array(z.object({ fieldId: z.uuid(), value: z.string().max(400_000) })).max(500),
});

const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;

function checkValue(
  field: { type: string; options: string[] | null },
  value: string,
): string | null {
  switch (field.type) {
    case "SIGNATURE":
    case "INITIALS": {
      const m = PNG_DATA_URL.exec(value);
      if (!m) return "signature must be a PNG image";
      const bytes = Buffer.from(m[1]!, "base64");
      if (bytes.length > 300_000) return "signature image is too large";
      if (
        !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      ) {
        return "signature must be a PNG image";
      }
      return null;
    }
    case "DATE":
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
        ? null
        : "invalid date";
    case "TEXT":
      return value.length <= 500 ? null : "text is too long";
    case "CHECKBOX":
      return value === "true" || value === "false" ? null : "invalid checkbox value";
    case "DROPDOWN":
      return field.options?.includes(value) ? null : "invalid option";
    default:
      return "unknown field type";
  }
}

export type CompleteResult = { envelopeCompleted: boolean; mail: MailMessage[] };

export async function completeSigning(
  s: SignerContext,
  input: z.infer<typeof CompleteBody>,
): Promise<CompleteResult> {
  await requireSession(s);
  const { env, me, doc } = await context(s);
  if (!(await hasEvent(s, "CONSENTED"))) throw new SignerError(409, "consent missing");

  // Sequential order: everyone with an earlier routing order must have signed.
  const everyone = await s.tx.select().from(recipients).where(eq(recipients.envelopeId, env.id));
  if (everyone.some((r) => r.routingOrder < me.routingOrder && r.status !== "SIGNED")) {
    throw new SignerError(409, "an earlier signer has not signed yet");
  }

  const mine = await s.tx.select().from(fields).where(eq(fields.recipientId, me.id));
  const byId = new Map(mine.map((f) => [f.id, f]));
  const values = new Map<string, string>();
  for (const { fieldId, value } of input.values) {
    const field = byId.get(fieldId);
    if (!field) throw new SignerError(400, "unknown field");
    if (value === "" && !field.required) continue;
    const problem = checkValue(field, value);
    if (problem) throw new SignerError(400, problem);
    values.set(fieldId, value);
  }
  for (const f of mine) {
    const missing = !values.has(f.id) || (f.type === "CHECKBOX" && values.get(f.id) !== "true");
    if (f.required && missing) throw new SignerError(400, "a required field is empty");
  }

  const now = new Date();
  for (const [fieldId, value] of values) {
    await s.tx.update(fields).set({ value, filledAt: now }).where(eq(fields.id, fieldId));
  }
  await s.tx
    .update(recipients)
    .set({ status: "SIGNED", completedAt: now })
    .where(eq(recipients.id, me.id));
  await recordEvent(s, env.versionSha256, "SIGNED", { fields: values.size }, "email_otp");

  const done = everyone.every((r) => r.id === me.id || r.status === "SIGNED");
  if (done) {
    await s.tx
      .update(envelopes)
      .set({ status: "COMPLETED", completedAt: now })
      .where(eq(envelopes.id, env.id));
    await s.tx.update(documents).set({ status: "COMPLETED" }).where(eq(documents.id, doc.id));
    return { envelopeCompleted: true, mail: [] };
  }
  if (doc.status === "SENT") {
    await s.tx
      .update(documents)
      .set({ status: "PARTIALLY_SIGNED" })
      .where(eq(documents.id, doc.id));
  }
  return { envelopeCompleted: false, mail: await notifyNext(s.tx, s.tenant, env.id, doc.title) };
}

export async function declineSigning(s: SignerContext, reason: string): Promise<MailMessage[]> {
  await requireSession(s);
  const { env, me, doc } = await context(s);
  const now = new Date();
  await s.tx
    .update(recipients)
    .set({ status: "DECLINED", declineReason: reason, completedAt: now })
    .where(eq(recipients.id, me.id));
  await s.tx.update(envelopes).set({ status: "DECLINED" }).where(eq(envelopes.id, env.id));
  await s.tx.update(documents).set({ status: "DECLINED" }).where(eq(documents.id, doc.id));
  await recordEvent(s, env.versionSha256, "DECLINED", { reason });
  const [sender] = await s.tx
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, env.createdBy));
  return sender
    ? [
        {
          to: sender.email,
          subject: `Declined: ${doc.title}`,
          text: `${me.name} declined to sign "${doc.title}".\n\nReason: ${reason}\n`,
        },
      ]
    : [];
}
