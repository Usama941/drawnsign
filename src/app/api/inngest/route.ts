import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { processUploadFn } from "@/inngest/documents";
import { ledgerAnchors } from "@/inngest/ledger-anchors";
import { expireEnvelopesFn, finalizeEnvelopeFn } from "@/inngest/signing";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [ledgerAnchors, processUploadFn, finalizeEnvelopeFn, expireEnvelopesFn],
});
