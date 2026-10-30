import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { ObjectExistsError, type ObjectStore, type PutOptions } from "./object-store";

// Local-disk store for development and end-to-end tests (STORAGE_PROVIDER=local). Refused in
// production. No locked retention.
export class FsObjectStore implements ObjectStore {
  readonly provider = "local-fs";
  readonly lockedRetention = false;
  private readonly root: string;

  constructor(root: string) {
    if (process.env.NODE_ENV === "production" && process.env.VERCEL_ENV) {
      throw new Error("FsObjectStore is for local development only");
    }
    this.root = resolve(root);
  }

  private path(key: string): string {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error("key escapes the store root");
    return p;
  }

  async put(key: string, body: Uint8Array, options: PutOptions): Promise<void> {
    const p = this.path(key);
    if (!options.overwrite && (await stat(p).catch(() => null))) throw new ObjectExistsError(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body, { flag: options.overwrite ? "w" : "wx" });
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}
