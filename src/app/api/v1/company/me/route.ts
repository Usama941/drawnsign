import { companyRoute } from "@/server/route";

export const GET = companyRoute({}, async ({ session }) =>
  Response.json({ userId: session.userId, role: session.tenant.role }),
);
