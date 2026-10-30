import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const API_ROOT = join(process.cwd(), "src/app/api");
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

export function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)],
  );
}

// Every route.ts under /api/v1, with the router it must belong to.
export function v1RouteFiles(): { file: string; kind: "v1" | "company" }[] {
  return listFiles(join(API_ROOT, "v1"))
    .filter((f) => f.endsWith(`${sep}route.ts`))
    .map((file) => ({
      file,
      kind: relative(join(API_ROOT, "v1"), file).startsWith(`company${sep}`) ? "company" : "v1",
    }));
}
