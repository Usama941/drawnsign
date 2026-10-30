import { timingSafeEqual } from "node:crypto";
import { latestOutboxMail } from "@/db/dev-outbox";
import { rateLimitHit } from "@/db/signing-lookup";
import { outboxEnabled } from "@/lib/preview";
import { notFound, problem } from "@/server/problem";
import { clientIp } from "@/signing/links";

// Preview-only email outbox. 404 unless EMAIL_MODE=outbox on a non-production deployment;
// needs the DEV_OUTBOX_KEY passphrase in the x-outbox-key header.
export async function GET(req: Request): Promise<Response> {
  const key = process.env.DEV_OUTBOX_KEY ?? "";
  if (!outboxEnabled() || key.length < 16) return notFound();
  if (!(await rateLimitHit(`outbox:${clientIp(req)}`, 30, 60)))
    return problem(429, "Too Many Requests");
  const given = Buffer.from(req.headers.get("x-outbox-key") ?? "");
  const expected = Buffer.from(key);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return problem(401, "Unauthorized");
  return Response.json(
    { mail: await latestOutboxMail() },
    { headers: { "cache-control": "no-store" } },
  );
}
