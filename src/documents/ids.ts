import { createHash, randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// DOC- + 10 Crockford base32 characters (50 random bits), PRD section 12.
export function newPublicId(): string {
  const bytes = randomBytes(7); // 56 bits; use the first 50
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  bits >>= 6n;
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return `DOC-${out}`;
}

export const PUBLIC_ID = /^DOC-[0-9A-HJKMNP-TV-Z]{10}$/;

// 128-bit bearer token (verification and signing links). Only its hash is stored.
export function newToken(): string {
  return randomBytes(16).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
