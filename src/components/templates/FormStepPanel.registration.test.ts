import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/externalClient", () => ({ supabase: {} }));

import { buildPortalRegistrationPlan } from "./FormStepPanel";

describe("FormStepPanel portal registration", () => {
  it("creates distinct typed configurations for repeated same-URL registration", () => {
    const input = {
      name: " BCBS KS ",
      initialKey: "",
      templatePayerId: "payer-1",
      templateCaseType: "enrollment" as const,
      formUrl: " https://payer.example/form ",
    };

    const first = buildPortalRegistrationPlan(input);
    const second = buildPortalRegistrationPlan(input);

    expect(first.mode).toBe("new");
    expect(second.mode).toBe("new");
    expect(first.input).toMatchObject({
      name: "BCBS KS",
      payerId: "payer-1",
      caseType: "enrollment",
      formUrl: "https://payer.example/form",
    });
    expect(first.input.portalKey).toMatch(/^bcbs-ks-enrollment-[a-f0-9]{12}$/);
    expect(second.input.portalKey).not.toBe(first.input.portalKey);
    expect(Object.keys(first.input).sort()).toEqual([
      "caseType",
      "formUrl",
      "name",
      "payerId",
      "portalKey",
    ]);
    expect(first.input).not.toHaveProperty("fieldMaps");
    expect(first.input).not.toHaveProperty("provenAt");
    expect(first.input).not.toHaveProperty("isVerified");
  });

  it("repairs an existing SOP reference using its normalized key without reset data", () => {
    const plan = buildPortalRegistrationPlan({
      name: " BCBS KS Contract ",
      initialKey: "  BCBS_KS_Contract  ",
      templatePayerId: "payer-1",
      templateCaseType: "contract",
      formUrl: "https://payer.example/form",
    });

    expect(plan.mode).toBe("repair");
    expect(plan.input).toEqual({
      name: "BCBS KS Contract",
      portalKey: "bcbs_ks_contract",
      payerId: "payer-1",
      caseType: "contract",
      formUrl: "https://payer.example/form",
    });
    expect(Object.keys(plan.input).sort()).toEqual([
      "caseType",
      "formUrl",
      "name",
      "payerId",
      "portalKey",
    ]);
    expect(plan.input).not.toHaveProperty("fieldMaps");
    expect(plan.input).not.toHaveProperty("provenAt");
    expect(plan.input).not.toHaveProperty("isVerified");
  });

  it("requires a payer and case type before either registration path", () => {
    expect(() =>
      buildPortalRegistrationPlan({
        name: "BCBS KS",
        initialKey: "",
        templatePayerId: "   ",
        templateCaseType: "enrollment",
        formUrl: "",
      }),
    ).toThrow("Choose a payer and case type");

    expect(() =>
      buildPortalRegistrationPlan({
        name: "BCBS KS",
        initialKey: "legacy-key",
        templatePayerId: "payer-1",
        templateCaseType: null,
        formUrl: "",
      }),
    ).toThrow("Choose a payer and case type");
  });
});
