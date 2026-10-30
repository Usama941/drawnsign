import { verifyRoute } from "@/server/verify-route";
import { getStorage } from "@/storage";
import { verificationView } from "@/verify/service";

export const GET = verifyRoute(
  async (req) => new URL(req.url).searchParams.get("t"),
  async ({ tx, match, viewer }) =>
    Response.json(await verificationView(tx, match, viewer, getStorage()), {
      headers: { "cache-control": "no-store" },
    }),
);
