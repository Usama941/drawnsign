import { z } from "zod";
import { problem } from "@/server/problem";
import { verifyRoute } from "@/server/verify-route";
import { hashCheck } from "@/verify/service";

const Body = z.object({ token: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/) });

// Upload-to-verify. The browser hashes the file locally and sends only the hash.
export const POST = verifyRoute(
  async (req) => {
    const parsed = Body.safeParse(
      await req
        .clone()
        .json()
        .catch(() => null),
    );
    return parsed.success ? parsed.data.token : null;
  },
  async ({ req, tx, match, viewer }) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return problem(400, "Bad Request");
    return Response.json(await hashCheck(tx, match, viewer, parsed.data.sha256));
  },
);
