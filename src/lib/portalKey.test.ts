import { describe, expect, it } from "vitest";
import { createIndependentPortalInput, createPortalConfigurationKey } from "./portalKey";

describe("createPortalConfigurationKey", () => {
  it("creates distinct permanent keys for configs with the same name and case type", () => {
    const first = createPortalConfigurationKey("BCBS KS", "enrollment");
    const second = createPortalConfigurationKey("BCBS KS", "enrollment");

    expect(first).toMatch(/^bcbs-ks-enrollment-[a-f0-9]{12}$/);
    expect(second).toMatch(/^bcbs-ks-enrollment-[a-f0-9]{12}$/);
    expect(second).not.toBe(first);
  });

  it("builds independent same-URL submissions with payer and type and no inherited state", () => {
    const input = {
      name: " BCBS KS ",
      payerId: " payer-1 ",
      caseType: "contract" as const,
      formUrl: " https://payer.example/form ",
    };
    const first = createIndependentPortalInput(input);
    const second = createIndependentPortalInput(input);

    expect(first).toMatchObject({
      name: "BCBS KS",
      payerId: "payer-1",
      caseType: "contract",
      formUrl: "https://payer.example/form",
    });
    expect(first.portalKey).not.toBe(second.portalKey);
    expect(first).not.toHaveProperty("isVerified");
    expect(first).not.toHaveProperty("provenAt");
  });
});
