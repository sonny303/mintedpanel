import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveEmailEnv } from "./env.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveEmailEnv", () => {
  it("is sandbox only when SENDGRID_SANDBOX is exactly 'true'", () => {
    for (const value of ["", "false", "TRUE", "True", "1", "yes"]) {
      vi.stubEnv("SENDGRID_SANDBOX", value);
      expect(resolveEmailEnv().sandbox).toBe(false);
    }
    vi.stubEnv("SENDGRID_SANDBOX", "true");
    expect(resolveEmailEnv().sandbox).toBe(true);
  });

  it("trims configured values", () => {
    vi.stubEnv("SENDGRID_API_KEY", " SG.key\n");
    vi.stubEnv("SENDGRID_FROM_EMAIL", "  ");
    expect(resolveEmailEnv()).toMatchObject({ apiKey: "SG.key", fromEmail: undefined });
  });
});
