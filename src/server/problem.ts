// RFC 9457 problem+json responses.
export function problem(status: number, title: string, detail?: string): Response {
  return new Response(JSON.stringify({ type: "about:blank", title, status, detail }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

export const notFound = () => problem(404, "Not Found");
export const unauthorized = () => problem(401, "Unauthorized");
export const forbidden = () => problem(403, "Forbidden");
