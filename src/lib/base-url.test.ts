import { describe, expect, it } from "vitest";
import { appBaseUrl, trustedOrigins } from "./base-url";

describe("appBaseUrl", () => {
  it("prefers APP_URL, then BETTER_AUTH_URL", () => {
    expect(
      appBaseUrl({ APP_URL: "https://a.example/", BETTER_AUTH_URL: "https://b.example" }),
    ).toBe("https://a.example");
    expect(appBaseUrl({ BETTER_AUTH_URL: "https://b.example" })).toBe("https://b.example");
  });

  it("uses the Vercel branch URL for previews", () => {
    expect(
      appBaseUrl({ VERCEL_BRANCH_URL: "app-git-x.vercel.app", VERCEL_URL: "app-abc.vercel.app" }),
    ).toBe("https://app-git-x.vercel.app");
    expect(
      trustedOrigins({ VERCEL_BRANCH_URL: "b.vercel.app", VERCEL_URL: "d.vercel.app" }),
    ).toEqual(["https://b.vercel.app", "https://d.vercel.app"]);
  });

  it("falls back to localhost", () => {
    expect(appBaseUrl({})).toBe("http://localhost:3000");
  });
});
