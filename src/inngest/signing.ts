import { NonRetriableError } from "inngest";
import { dueEnvelopeExpiries } from "@/db/signing-lookup";
import type { TenantContext } from "@/db/tenant";
import { JobContextError } from "@/jobs/context";
import { expireEnvelope, finalizeEnvelope } from "@/signing/finalize";
import { getStorage } from "@/storage";
import { inngest } from "./client";

export const ENVELOPE_COMPLETED = "envelope/completed";

export interface EnvelopeCompletedData {
  ctx: TenantContext;
  envelopeId: string;
}

async function nonRetriable<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof JobContextError) throw new NonRetriableError(err.message);
    throw err;
  }
}

export const finalizeEnvelopeFn = inngest.createFunction(
  { id: "finalize-envelope", triggers: { event: ENVELOPE_COMPLETED }, retries: 5 },
  async ({ event, step }) => {
    const data = event.data as EnvelopeCompletedData;
    return step.run("flatten", () =>
      nonRetriable(() => finalizeEnvelope(data.ctx, data.envelopeId, getStorage())),
    );
  },
);

// Hourly: expire envelopes past their deadline. The scan returns ids only; each expiry
// re-checks its tenant inside withTenant().
export const expireEnvelopesFn = inngest.createFunction(
  { id: "expire-envelopes", triggers: { cron: "TZ=UTC 7 * * * *" } },
  async ({ step }) => {
    const due = await step.run("scan", () => dueEnvelopeExpiries(500));
    let expired = 0;
    for (const d of due) {
      const ctx: TenantContext = {
        tenantId: d.tenantId,
        workspaceType: d.workspaceType,
        userId: null,
      };
      if (
        await step.run(`expire-${d.envelopeId}`, () =>
          nonRetriable(() => expireEnvelope(ctx, d.envelopeId)),
        )
      ) {
        expired++;
      }
    }
    return { expired };
  },
);

export async function enqueueEnvelopeCompleted(data: EnvelopeCompletedData): Promise<void> {
  if (process.env.INNGEST_EVENT_KEY || process.env.INNGEST_DEV) {
    await inngest.send({ name: ENVELOPE_COMPLETED, data });
    return;
  }
  await finalizeEnvelope(data.ctx, data.envelopeId, getStorage());
}
