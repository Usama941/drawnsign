import { describe, expect, it } from "vitest";
import { hashToken, newPublicId, newToken, PUBLIC_ID } from "./ids";

describe("ids", () => {
  it("public ids are DOC- plus 10 Crockford base32 characters and vary", () => {
    const ids = new Set(Array.from({ length: 500 }, newPublicId));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(PUBLIC_ID);
  });

  it("tokens carry 128 bits and hash deterministically", () => {
    const t = newToken();
    expect(Buffer.from(t, "base64url")).toHaveLength(16);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });
});
