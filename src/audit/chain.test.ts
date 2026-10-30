import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { entryHash, GENESIS_HASH, verifyChain, type LedgerRow } from "./chain";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function build(n: number): LedgerRow[] {
  const rows: LedgerRow[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const payloadText = JSON.stringify({ i });
    const base = {
      seq: String(i),
      tsText: `2026-10-30T12:00:0${i}.000000Z`,
      actorId: null,
      action: "test",
      objectType: "thing",
      objectId: String(i),
      payloadText,
      payloadSha256: sha256(payloadText),
    };
    const hash = entryHash(prev, base);
    rows.push({ ...base, prevHash: prev, entryHash: hash });
    prev = hash;
  }
  return rows;
}

describe("verifyChain", () => {
  it("accepts an intact chain", () => {
    expect(verifyChain(build(5))).toEqual({ ok: true, length: 5 });
  });

  it("detects an edited payload", () => {
    const rows = build(5);
    rows[2] = { ...rows[2]!, payloadText: '{"i": 99}' };
    expect(verifyChain(rows)).toMatchObject({ ok: false, seq: "3" });
  });

  it("detects an edited field even when its payload hash is recomputed", () => {
    const rows = build(5);
    rows[1] = { ...rows[1]!, action: "something-else" };
    expect(verifyChain(rows)).toMatchObject({ ok: false, seq: "2", reason: "entry hash mismatch" });
  });

  it("detects a deleted entry", () => {
    const rows = build(5);
    rows.splice(2, 1);
    expect(verifyChain(rows)).toMatchObject({ ok: false, seq: "4", reason: "sequence gap" });
  });
});
