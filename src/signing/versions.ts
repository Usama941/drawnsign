import { eq, sql } from "drizzle-orm";
import { documentVersions, tenants, verificationTokens } from "@/db/schema";
import type { TenantContext, Tx } from "@/db/tenant";
import { hashToken, newToken } from "@/documents/ids";
import { appUrl } from "./links";

export async function retentionUntil(tx: Tx, tenantId: string): Promise<Date> {
  const [t] = await tx
    .select({ years: tenants.retentionYears })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  return new Date(Date.now() + (t?.years ?? 7) * 365.25 * 86_400_000);
}

// The number the version trigger will assign. Callers insert and then check it matched, so
// footers never print a wrong version number.
export async function nextVersionNo(tx: Tx, documentId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`coalesce(max(${documentVersions.versionNo}), 0) + 1` })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId));
  return Number(row?.n ?? 1);
}

export function verifyUrl(publicId: string, token: string): string {
  return `${appUrl()}/verify/${publicId}?t=${token}`;
}

export function displayUrl(publicId: string): string {
  return `${appUrl().replace(/^https?:\/\//, "")}/verify/${publicId}`;
}

// One verification token per version (CLAUDE.md rule 2): hashed, bound to the version,
// expiring at the document's retention end.
export async function insertVerificationToken(
  tx: Tx,
  ctx: TenantContext,
  documentId: string,
  versionId: string,
  token: string,
  expiresAt: Date,
): Promise<void> {
  await tx.insert(verificationTokens).values({
    tenantId: ctx.tenantId,
    documentId,
    versionId,
    tokenHash: hashToken(token),
    expiresAt,
  });
}

export { newToken };
