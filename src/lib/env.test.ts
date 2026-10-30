import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

describe("loadEnv", () => {
  it("defaults NODE_ENV to development", () => {
    expect(loadEnv({}).NODE_ENV).toBe("development");
  });

  it("rejects unknown NODE_ENV values", () => {
    expect(() => loadEnv({ NODE_ENV: "staging" })).toThrow();
  });
});
