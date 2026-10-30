import { NonRetriableError } from "inngest";
import { JobContextError } from "@/jobs/context";
import { getStorage } from "@/storage";
import { processUpload } from "@/documents/uploads";
import type { TenantContext } from "@/db/tenant";
import { inngest } from "./client";

export const UPLOAD_RECEIVED = "document/upload.received";

// Event data is built server-side from the uploader's session (never from client input),
// and Inngest requests are signature-checked in production.
export interface UploadReceivedData {
  ctx: TenantContext;
  uploadId: string;
}

export const processUploadFn = inngest.createFunction(
  { id: "process-upload", triggers: { event: UPLOAD_RECEIVED }, retries: 3 },
  async ({ event, step }) => {
    const data = event.data as UploadReceivedData;
    return step.run("sanitise", async () => {
      try {
        return await processUpload(data.ctx, data.uploadId, getStorage());
      } catch (err) {
        // A context mismatch never succeeds on retry.
        if (err instanceof JobContextError) throw new NonRetriableError(err.message);
        throw err;
      }
    });
  },
);

// Uses Inngest when it is configured; otherwise (local development without the Inngest dev
// server, and tests) processes inline.
export async function enqueueUploadProcessing(data: UploadReceivedData): Promise<void> {
  if (process.env.INNGEST_EVENT_KEY || process.env.INNGEST_DEV) {
    await inngest.send({ name: UPLOAD_RECEIVED, data });
    return;
  }
  await processUpload(data.ctx, data.uploadId, getStorage());
}
