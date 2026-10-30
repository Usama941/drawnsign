import { randomUUID } from "node:crypto";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { scopeOf } from "@/auth/permissions";
import { documents, documentVersions, uploads } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import type { TenantAppSession } from "@/server/route";
import { newPublicId } from "./ids";

export const SEND = {
  COMPANY_MANAGED: "company.documents.send",
  PUBLIC_CUSTOMER: "customer.documents.send",
} as const;

export const VIEW = {
  COMPANY_MANAGED: "company.documents.view",
  PUBLIC_CUSTOMER: "customer.documents.view",
} as const;

// Row filter for the caller's view scope. RLS already limits rows to the tenant; this narrows
// within it. "team" means own documents until teams exist (M2); "shared" has no shares yet.
export function viewFilter(session: TenantAppSession): SQL | undefined {
  const scope = scopeOf(session, VIEW[session.tenant.workspaceType]);
  switch (scope) {
    case "all":
      return undefined;
    case "own":
    case "team":
      return eq(documents.ownerId, session.userId);
    default:
      return sql`false`;
  }
}

export async function createDocument(
  tx: Tx,
  session: TenantAppSession,
  title: string,
): Promise<{ id: string; publicId: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomUUID();
    const publicId = newPublicId();
    const rows = await tx
      .insert(documents)
      .values({ id, tenantId: session.tenant.tenantId, publicId, title, ownerId: session.userId })
      .onConflictDoNothing({ target: documents.publicId })
      .returning({ id: documents.id });
    if (rows.length === 1) return { id, publicId };
  }
  throw new Error("could not allocate a public document id");
}

export async function findDocument(tx: Tx, session: TenantAppSession, id: string) {
  const [doc] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), viewFilter(session)));
  return doc ?? null;
}

export async function listDocuments(tx: Tx, session: TenantAppSession) {
  return tx
    .select({
      id: documents.id,
      publicId: documents.publicId,
      title: documents.title,
      status: documents.status,
      currentVersionId: documents.currentVersionId,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(viewFilter(session))
    .orderBy(desc(documents.createdAt))
    .limit(100);
}

export async function listVersions(tx: Tx, documentId: string) {
  return tx
    .select({
      id: documentVersions.id,
      versionNo: documentVersions.versionNo,
      kind: documentVersions.kind,
      sha256: documentVersions.sha256,
      pageCount: documentVersions.pageCount,
      sizeBytes: documentVersions.sizeBytes,
      parentVersionId: documentVersions.parentVersionId,
      createdAt: documentVersions.createdAt,
    })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(documentVersions.versionNo);
}

// Only the uploader can push bytes to, or complete, their own upload.
export async function findOwnUpload(tx: Tx, session: TenantAppSession, id: string) {
  const [upload] = await tx
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, id), eq(uploads.createdBy, session.userId)));
  return upload ?? null;
}
