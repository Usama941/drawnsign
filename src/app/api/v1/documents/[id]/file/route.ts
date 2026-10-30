import { eq } from "drizzle-orm";
import { documentVersions } from "@/db/schema";
import { findDocument, VIEW } from "@/documents/service";
import { idParam } from "@/server/input";
import { notFound } from "@/server/problem";
import { route } from "@/server/route";
import { getStorage } from "@/storage";

// The current version's PDF, for the field editor and viewers.
export const GET = route({ permission: VIEW }, async ({ tx, session, params }) => {
  const doc = await findDocument(tx, session, idParam(params, "id"));
  if (!doc?.currentVersionId) return notFound();
  const [v] = await tx
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, doc.currentVersionId));
  if (!v) return notFound();
  const storage = getStorage();
  const bytes =
    v.storageClass === "DRAFTS"
      ? await storage.getDraft(v.storageKey)
      : await storage.getEvidence(v.storageKey, v.sha256);
  if (!bytes) return notFound();
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-version-id": v.id,
      "x-version-sha256": v.sha256,
    },
  });
});
