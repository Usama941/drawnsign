type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string | string[]>> },
) => Promise<Response>;

// Calls a route handler the way Next.js would.
export async function call(
  mod: Promise<unknown>,
  method: string,
  opts: {
    headers?: Headers;
    params?: Record<string, string>;
    json?: unknown;
    body?: Uint8Array;
    url?: string;
  } = {},
): Promise<Response> {
  const handler = ((await mod) as Record<string, Handler>)[method];
  if (!handler) throw new Error(`no ${method} handler`);
  const headers = new Headers(opts.headers);
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(opts.json);
  } else if (opts.body) {
    headers.set("content-type", "application/pdf");
    body = Buffer.from(opts.body);
  }
  const req = new Request(`http://localhost:3000${opts.url ?? "/api/v1/test"}`, {
    method,
    headers,
    body,
  });
  return handler(req, { params: Promise.resolve(opts.params ?? {}) });
}
