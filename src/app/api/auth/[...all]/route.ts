import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/auth/server";

const handler = (req: Request) =>
  toNextJsHandler(getAuth())[req.method === "GET" ? "GET" : "POST"](req);

export { handler as GET, handler as POST };
