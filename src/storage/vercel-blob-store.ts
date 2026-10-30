import { BlobPreconditionFailedError, del, get, put } from "@vercel/blob";
import { ObjectExistsError, type ObjectStore, type PutOptions } from "./object-store";

// Development storage. Private blobs only. Vercel Blob has no write-once retention, so this
// must not hold production evidence (pre-go-live requirement in docs/PRD.md).
export class VercelBlobObjectStore implements ObjectStore {
  readonly provider = "vercel-blob";
  readonly lockedRetention = false;

  constructor(
    private readonly token: string,
    private readonly prefix: string,
  ) {}

  async put(key: string, body: Uint8Array, options: PutOptions): Promise<void> {
    try {
      await put(this.path(key), Buffer.from(body), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: options.overwrite,
        contentType: options.contentType,
        token: this.token,
      });
    } catch (err) {
      if (!options.overwrite && isAlreadyExists(err)) throw new ObjectExistsError(key);
      throw err;
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    const result = await get(this.path(key), {
      access: "private",
      useCache: false,
      token: this.token,
    });
    if (!result || !result.stream) return null;
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    await del(this.path(key), { token: this.token });
  }

  private path(key: string): string {
    return `${this.prefix}/${key}`;
  }
}

function isAlreadyExists(err: unknown): boolean {
  return (
    err instanceof BlobPreconditionFailedError ||
    (err instanceof Error && /already exists/i.test(err.message))
  );
}
