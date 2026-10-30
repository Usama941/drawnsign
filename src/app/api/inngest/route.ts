import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { processUploadFn } from "@/inngest/documents";
import { ledgerAnchors } from "@/inngest/ledger-anchors";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [ledgerAnchors, processUploadFn],
});
