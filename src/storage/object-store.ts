// Provider-neutral object storage. Development uses Vercel Blob; before go-live the evidence
// store must be a write-once store with locked retention (S3 Object Lock in compliance mode or
// equivalent). See "Pre-go-live requirements" in docs/PRD.md.
export interface PutOptions {
  contentType: string;
  // false: fail if the key already exists.
  overwrite: boolean;
  // Retention the provider must enforce. Providers without locked retention ignore it.
  retainUntil?: Date;
}

export interface ObjectStore {
  readonly provider: string;
  // True only if the provider enforces retainUntil so nobody (including us) can delete or
  // overwrite the object before then.
  readonly lockedRetention: boolean;
  put(key: string, body: Uint8Array, options: PutOptions): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export class ObjectExistsError extends Error {
  constructor(key: string) {
    super(`object already exists: ${key}`);
  }
}

export class RetentionLockedError extends Error {
  constructor(key: string) {
    super(`object is under retention: ${key}`);
  }
}
