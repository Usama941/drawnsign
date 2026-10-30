import { describe, expect, it } from "vitest";
import { outboxEnabled, selfSignupEnabled } from "./preview";

describe("preview features", () => {
  it("are off unless switched on", () => {
    expect(outboxEnabled({})).toBe(false);
    expect(selfSignupEnabled({})).toBe(false);
  });

  it("work on previews and locally", () => {
    expect(outboxEnabled({ EMAIL_MODE: "outbox", VERCEL_ENV: "preview" })).toBe(true);
    expect(selfSignupEnabled({ PREVIEW_SELF_SIGNUP: "true" })).toBe(true);
  });

  it("are refused on Vercel production and on the production domain", () => {
    expect(outboxEnabled({ EMAIL_MODE: "outbox", VERCEL_ENV: "production" })).toBe(false);
    expect(selfSignupEnabled({ PREVIEW_SELF_SIGNUP: "true", VERCEL_ENV: "production" })).toBe(
      false,
    );
    const prodDomain = {
      PREVIEW_SELF_SIGNUP: "true",
      PRODUCTION_HOSTNAME: "app.example.com",
      APP_URL: "https://app.example.com",
    };
    expect(selfSignupEnabled(prodDomain)).toBe(false);
  });
});
