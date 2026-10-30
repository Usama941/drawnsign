import type { z } from "zod";
import { problem } from "./problem";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InputError extends Error {
  constructor(readonly response: Response) {
    super("invalid input");
  }
}

export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new InputError(problem(400, "Bad Request", "body must be JSON"));
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new InputError(problem(400, "Bad Request", parsed.error.message));
  return parsed.data;
}

// Resource ids from the path. Anything that is not a uuid is simply not found.
export function idParam(params: Record<string, string | string[]>, name: string): string {
  const value = params[name];
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new InputError(problem(404, "Not Found"));
  }
  return value;
}
