import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveEmailEnv } from "./env.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveEmailEnv", () => {
  it("delivers only when SENDGRID_SANDBOX is exactly 'false'", () => {
    for (const value of ["", "true", "TRUE", "False", "0", "no"]) {
      vi.stubEnv("SENDGRID_SANDBOX", value);
      expect(resolveEmailEnv().sandbox).toBe(true);
    }
    vi.stubEnv("SENDGRID_SANDBOX", "false");
    expect(resolveEmailEnv().sandbox).toBe(false);
  });

  it("trims configured values", () => {
    vi.stubEnv("SENDGRID_API_KEY", " SG.key\n");
    vi.stubEnv("SENDGRID_FROM_EMAIL", "  ");
    expect(resolveEmailEnv()).toMatchObject({ apiKey: "SG.key", fromEmail: undefined });
  });
});
