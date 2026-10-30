import { createHash } from "node:crypto";
import type { ObjectStore } from "./object-store";
import { FsObjectStore } from "./fs-store";
import { VercelBlobObjectStore } from "./vercel-blob-store";

export interface EvidenceObject {
  key: string;
  sha256: string;
  size: number;
  // False until the evidence store enforces write-once retention (pre-go-live requirement).
  locked: boolean;
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every object key starts with the tenant id from the session, so keys from different tenants
// can never collide or be addressed by path tricks.
export function objectKey(tenantId: string, ...parts: string[]): string {
  if (!UUID.test(tenantId)) throw new Error("objectKey: invalid tenant id");
  for (const part of parts) {
    if (!SEGMENT.test(part) || part.includes("..")) {
      throw new Error(`objectKey: invalid key segment "${part}"`);
    }
  }
  return [tenantId.toLowerCase(), ...parts].join("/");
}

// Two stores: drafts (mutable, deletable) and evidence (write-once, never deleted by the app).
export class Storage {
  constructor(
    readonly drafts: ObjectStore,
    private readonly evidence: ObjectStore,
  ) {}

  get evidenceLocked(): boolean {
    return this.evidence.lockedRetention;
  }

  putDraft(key: string, body: Uint8Array, contentType: string): Promise<void> {
    return this.drafts.put(key, body, { contentType, overwrite: true });
  }

  getDraft(key: string): Promise<Uint8Array | null> {
    return this.drafts.get(key);
  }

  deleteDraft(key: string): Promise<void> {
    return this.drafts.delete(key);
  }

  // Write-once: an existing key is never overwritten. There is deliberately no delete.
  async putEvidence(
    key: string,
    body: Uint8Array,
    contentType: string,
    retainUntil: Date,
  ): Promise<EvidenceObject> {
    await this.evidence.put(key, body, { contentType, overwrite: false, retainUntil });
    return {
      key,
      sha256: createHash("sha256").update(body).digest("hex"),
      size: body.byteLength,
      locked: this.evidence.lockedRetention,
    };
  }

  // Returns the bytes only if they still hash to the recorded value.
  async getEvidence(key: string, expectedSha256: string): Promise<Uint8Array | null> {
    const body = await this.evidence.get(key);
    if (!body) return null;
    const actual = createHash("sha256").update(body).digest("hex");
    if (actual !== expectedSha256) throw new Error(`evidence integrity check failed: ${key}`);
    return body;
  }
}

let storage: Storage | undefined;

export function getStorage(): Storage {
  if (!storage && process.env.STORAGE_PROVIDER === "local") {
    const root = process.env.LOCAL_STORAGE_DIR ?? ".data/storage";
    storage = new Storage(
      new FsObjectStore(`${root}/drafts`),
      new FsObjectStore(`${root}/evidence`),
    );
  }
  if (!storage) {
    const fallback = process.env.BLOB_READ_WRITE_TOKEN;
    const draftsToken = process.env.BLOB_DRAFTS_TOKEN ?? fallback;
    const evidenceToken = process.env.BLOB_EVIDENCE_TOKEN ?? fallback;
    if (!draftsToken || !evidenceToken) throw new Error("Vercel Blob tokens are not set");
    storage = new Storage(
      new VercelBlobObjectStore(draftsToken, "drafts"),
      new VercelBlobObjectStore(evidenceToken, "evidence"),
    );
  }
  return storage;
}

export function setStorageForTests(s: Storage): void {
  storage = s;
}
