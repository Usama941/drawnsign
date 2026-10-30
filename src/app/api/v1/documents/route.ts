import { z } from "zod";
import { tenantContext } from "@/auth/session";
import { createDocument, listDocuments, SEND, VIEW } from "@/documents/service";
import { createUpload, uploadMode } from "@/documents/uploads";
import { readJson } from "@/server/input";
import { route } from "@/server/route";

const CreateDocument = z.object({ title: z.string().trim().min(1).max(200) });

// Creates a document and its first upload slot.
export const POST = route({ permission: SEND }, async ({ req, tx, session, audit }) => {
  const { title } = await readJson(req, CreateDocument);
  const doc = await createDocument(tx, session, title);
  const upload = await createUpload(tx, tenantContext(session), doc.id);
  audit({
    action: "document.created",
    objectType: "document",
    objectId: doc.id,
    details: { uploadId: upload.id },
  });
  return Response.json(
    { documentId: doc.id, publicId: doc.publicId, upload: { id: upload.id, mode: uploadMode() } },
    { status: 201 },
  );
});

export const GET = route({ permission: VIEW }, async ({ tx, session }) =>
  Response.json({ documents: await listDocuments(tx, session) }),
);
