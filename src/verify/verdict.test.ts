import { describe, expect, it } from "vitest";
import type { SealCheck } from "@/crypto/pades";
import { verdictFor } from "./verdict";

const good: SealCheck = {
  signed: true,
  coversWholeFile: true,
  digestValid: true,
  signatureValid: true,
  timestampValid: true,
  timestampTime: new Date(),
  certificatePem: "x",
  subject: "x",
};

describe("verdictFor (CLAUDE.md rule 8)", () => {
  it.each(["DRAFT", "SENT", "AMENDED", "CORRECTION"])(
    "a %s version is never green, whatever its seal",
    (kind) => {
      expect(verdictFor(kind, "PRODUCTION", good)).toBe("NOT_SIGNED");
    },
  );

  it("a development seal is amber even when every check passes", () => {
    expect(verdictFor("SIGNED", "DEVELOPMENT", good)).toBe("SIGNED_DEVELOPMENT");
  });

  it("green needs a SIGNED version, a production seal and all checks", () => {
    expect(verdictFor("SIGNED", "PRODUCTION", good)).toBe("SIGNED_TRUSTED");
    for (const key of [
      "coversWholeFile",
      "digestValid",
      "signatureValid",
      "timestampValid",
    ] as const) {
      expect(verdictFor("SIGNED", "PRODUCTION", { ...good, [key]: false })).toBe(
        "SIGNATURE_INVALID",
      );
    }
    expect(verdictFor("SIGNED", "PRODUCTION", null)).toBe("SIGNATURE_INVALID");
  });
});
