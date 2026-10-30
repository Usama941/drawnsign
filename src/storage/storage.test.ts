import { describe, expect, it } from "vitest";
import { MemoryObjectStore } from "./memory-store";
import { ObjectExistsError, RetentionLockedError } from "./object-store";
import { objectKey, Storage } from "./index";

const TENANT = "0b6f8c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e";
const bytes = (s: string) => new TextEncoder().encode(s);
const later = () => new Date(Date.now() + 86_400_000);

describe("objectKey", () => {
  it("prefixes the tenant id", () => {
    expect(objectKey(TENANT, "documents", "v1.pdf")).toBe(`${TENANT}/documents/v1.pdf`);
  });

  it.each(["..", "a/b", "", ".hidden", "x..y"])("rejects segment %j", (seg) => {
    expect(() => objectKey(TENANT, seg)).toThrow();
  });

  it("rejects a non-uuid tenant", () => {
    expect(() => objectKey("../other", "x")).toThrow();
  });
});

describe("Storage", () => {
  it("evidence is write-once and integrity-checked on read", async () => {
    const storage = new Storage(new MemoryObjectStore(), new MemoryObjectStore());
    const key = objectKey(TENANT, "signed", "v3.pdf");
    const stored = await storage.putEvidence(key, bytes("signed"), "application/pdf", later());
    expect(stored).toMatchObject({ key, size: 6, locked: false });
    await expect(
      storage.putEvidence(key, bytes("tampered"), "application/pdf", later()),
    ).rejects.toBeInstanceOf(ObjectExistsError);
    expect(await storage.getEvidence(key, stored.sha256)).toEqual(bytes("signed"));
    await expect(storage.getEvidence(key, "0".repeat(64))).rejects.toThrow(/integrity/);
  });

  it("exposes no way to delete evidence", () => {
    const storage = new Storage(new MemoryObjectStore(), new MemoryObjectStore());
    expect("deleteEvidence" in storage).toBe(false);
  });

  it("drafts can be overwritten and deleted", async () => {
    const storage = new Storage(new MemoryObjectStore(), new MemoryObjectStore());
    const key = objectKey(TENANT, "drafts", "d.pdf");
    await storage.putDraft(key, bytes("a"), "application/pdf");
    await storage.putDraft(key, bytes("b"), "application/pdf");
    expect(await storage.getDraft(key)).toEqual(bytes("b"));
    await storage.deleteDraft(key);
    expect(await storage.getDraft(key)).toBeNull();
  });

  it("a locked store refuses deletion before retention ends", async () => {
    const locked = new MemoryObjectStore(true);
    const storage = new Storage(new MemoryObjectStore(), locked);
    const key = objectKey(TENANT, "signed", "v1.pdf");
    const stored = await storage.putEvidence(key, bytes("x"), "application/pdf", later());
    expect(stored.locked).toBe(true);
    await expect(locked.delete(key)).rejects.toBeInstanceOf(RetentionLockedError);
  });
});
