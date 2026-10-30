import {
  ObjectExistsError,
  RetentionLockedError,
  type ObjectStore,
  type PutOptions,
} from "./object-store";

// In-memory store for tests. With lockedRetention it behaves like a WORM store.
export class MemoryObjectStore implements ObjectStore {
  readonly provider = "memory";
  private readonly objects = new Map<string, { body: Uint8Array; retainUntil?: Date }>();

  constructor(readonly lockedRetention = false) {}

  async put(key: string, body: Uint8Array, options: PutOptions): Promise<void> {
    const existing = this.objects.get(key);
    if (existing && !options.overwrite) throw new ObjectExistsError(key);
    if (existing && this.isLocked(existing.retainUntil)) throw new RetentionLockedError(key);
    this.objects.set(key, { body: new Uint8Array(body), retainUntil: options.retainUntil });
  }

  async get(key: string): Promise<Uint8Array | null> {
    const obj = this.objects.get(key);
    return obj ? new Uint8Array(obj.body) : null;
  }

  async delete(key: string): Promise<void> {
    const obj = this.objects.get(key);
    if (obj && this.isLocked(obj.retainUntil)) throw new RetentionLockedError(key);
    this.objects.delete(key);
  }

  private isLocked(retainUntil?: Date): boolean {
    return this.lockedRetention && retainUntil !== undefined && retainUntil > new Date();
  }
}
