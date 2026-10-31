import { describe, expect, it } from "vitest";
import { missingManualCaseFields, missingManualCaseFieldsHint } from "./manualCaseFields";

const NONE = "__none__";

describe("missingManualCaseFields", () => {
  it("lists every key field when nothing is picked, in form order", () => {
    expect(
      missingManualCaseFields({ provider: NONE, group: NONE, payer: NONE, state: NONE }, NONE),
    ).toEqual(["provider", "group", "payer", "state"]);
  });

  it("drops the fields that are set", () => {
    expect(
      missingManualCaseFields({ provider: "pr-1", group: "g-1", payer: NONE, state: NONE }, NONE),
    ).toEqual(["payer", "state"]);
    expect(
      missingManualCaseFields({ provider: NONE, group: NONE, payer: "pay-1", state: "NC" }, NONE),
    ).toEqual(["provider", "group"]);
  });

  it("is empty once all four are set", () => {
    expect(
      missingManualCaseFields(
        { provider: "pr-1", group: "g-1", payer: "pay-1", state: "NC" },
        NONE,
      ),
    ).toEqual([]);
  });
});

describe("missingManualCaseFieldsHint", () => {
  it("names one, two, and several missing fields", () => {
    expect(missingManualCaseFieldsHint(["state"])).toBe("Choose a state to create the case.");
    expect(missingManualCaseFieldsHint(["payer", "state"])).toBe(
      "Choose a payer and state to create the case.",
    );
    expect(missingManualCaseFieldsHint(["group", "payer", "state"])).toBe(
      "Choose a group, payer, and state to create the case.",
    );
    expect(missingManualCaseFieldsHint(["provider", "group", "payer", "state"])).toBe(
      "Choose a provider, group, payer, and state to create the case.",
    );
  });

  it("is null when nothing is missing", () => {
    expect(missingManualCaseFieldsHint([])).toBeNull();
  });
});
