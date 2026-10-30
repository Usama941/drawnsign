import { sql } from "drizzle-orm";
import { getDb } from "./client";
import type { WorkspaceType } from "./schema";

export interface VerifyMatch {
  tenantId: string;
  workspaceType: WorkspaceType;
  documentId: string;
  versionId: string;
}

// The verify page's only cross-tenant reads (CLAUDE.md rule 2): by public id and token hash,
// returning the tenant and the one version the token is bound to.
export async function lookupVerification(
  publicId: string,
  tokenHash: string,
): Promise<VerifyMatch | null> {
  const { rows } = await getDb().execute<{
    tenant_id: string;
    workspace_type: WorkspaceType;
    document_id: string;
    version_id: string;
  }>(sql`SELECT * FROM verify_lookup(${publicId}, ${tokenHash})`);
  const r = rows[0];
  return r
    ? {
        tenantId: r.tenant_id,
        workspaceType: r.workspace_type,
        documentId: r.document_id,
        versionId: r.version_id,
      }
    : null;
}

export async function publicIdExists(publicId: string): Promise<boolean> {
  const { rows } = await getDb().execute<{ exists: boolean }>(
    sql`SELECT verify_exists(${publicId}) AS exists`,
  );
  return rows[0]?.exists === true;
}
