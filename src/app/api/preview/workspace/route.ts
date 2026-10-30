import { z } from "zod";
import { resolveSession } from "@/auth/session";
import { listOwnMemberships } from "@/db/memberships";
import { createPreviewWorkspace } from "@/db/preview-workspace";
import { selfSignupEnabled } from "@/lib/preview";
import { readJson, InputError } from "@/server/input";
import { notFound, problem, unauthorized } from "@/server/problem";

const Body = z.object({ name: z.string().trim().min(1).max(100) });

export async function GET(): Promise<Response> {
  return Response.json({ enabled: selfSignupEnabled() });
}

// Preview-only: create a test workspace for a signed-in user who has none.
export async function POST(req: Request): Promise<Response> {
  if (!selfSignupEnabled()) return notFound();
  const session = await resolveSession(req.headers);
  if (!session) return unauthorized();
  if ((await listOwnMemberships(session.userId)).length > 0) {
    return problem(409, "Conflict", "you already have a workspace");
  }
  try {
    const { name } = await readJson(req, Body);
    await createPreviewWorkspace(session.userId, name);
    return Response.json({ created: true }, { status: 201 });
  } catch (err) {
    if (err instanceof InputError) return err.response;
    throw err;
  }
}
