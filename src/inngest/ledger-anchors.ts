import { anchorLedgers } from "@/db/audit";
import { inngest } from "./client";

// Daily at 00:15 UTC: anchor every tenant's chain head as of the previous UTC day.
// Exporting anchors to a separate locked store is a pre-go-live requirement (PRD 17-18).
export const ledgerAnchors = inngest.createFunction(
  { id: "ledger-anchors", triggers: { cron: "TZ=UTC 15 0 * * *" } },
  async ({ step }) => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const anchored = await step.run("anchor", () => anchorLedgers(yesterday));
    return { date: yesterday, anchored };
  },
);

export const functions = [ledgerAnchors];
