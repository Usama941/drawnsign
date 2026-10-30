import { route } from "@/server/route";

export const GET = route({}, async ({ session }) =>
  Response.json({
    userId: session.userId,
    workspaceType: session.tenant.workspaceType,
    role: session.tenant.role,
  }),
);
