import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTER } from "@/server/route";
import { API_ROOT, HTTP_METHODS, listFiles, v1RouteFiles } from "../route-files";

describe("API route rules", () => {
  it("no API code mentions a tenant id (tenant comes from the session only)", () => {
    const offenders = listFiles(API_ROOT).filter((f) =>
      /tenant[_-]?id/i.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("has at least one company route to guard", () => {
    expect(v1RouteFiles().some((r) => r.kind === "company")).toBe(true);
  });

  it.each(v1RouteFiles())(
    "$file exports only handlers from its own router",
    async ({ file, kind }) => {
      const mod = (await import(file)) as Record<string, unknown>;
      const handlers = HTTP_METHODS.filter((m) => m in mod);
      expect(handlers.length).toBeGreaterThan(0);
      for (const method of handlers) {
        const handler = mod[method] as { [ROUTER]?: string };
        expect({ method, router: handler[ROUTER] }).toEqual({ method, router: kind });
      }
    },
  );
});
