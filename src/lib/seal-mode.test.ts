import { describe, expect, it } from "vitest";
import { assertSealModeAllowed, sealModeViolation } from "./seal-mode";

describe("seal mode guard", () => {
  it("allows development seals in local and preview deployments", () => {
    expect(sealModeViolation({ SEAL_MODE: "development" })).toBeNull();
    expect(sealModeViolation({ SEAL_MODE: "development", VERCEL_ENV: "preview" })).toBeNull();
    expect(
      sealModeViolation(
        { SEAL_MODE: "development", PRODUCTION_HOSTNAME: "app.example.com" },
        "x.vercel.app",
      ),
    ).toBeNull();
  });

  it("refuses development seals in a Vercel production deployment", () => {
    expect(() =>
      assertSealModeAllowed({ SEAL_MODE: "development", VERCEL_ENV: "production" }),
    ).toThrow(/production deployment/);
  });

  it.each(["app.example.com", "APP.example.com:443", "eu.app.example.com"])(
    "refuses development seals on the production domain (%s)",
    (host) => {
      expect(() =>
        assertSealModeAllowed(
          { SEAL_MODE: "development", PRODUCTION_HOSTNAME: "app.example.com" },
          host,
        ),
      ).toThrow(/production domain/);
    },
  );

  it("does not restrict other seal modes", () => {
    expect(sealModeViolation({ VERCEL_ENV: "production" }, "app.example.com")).toBeNull();
  });
});
