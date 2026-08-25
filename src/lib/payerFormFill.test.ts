import { describe, expect, it } from "vitest";
import { applyRegistryTransform, planPayerFormFill } from "@/lib/payerFormFill";
import type { RegistryRow } from "@/lib/fieldRegistry";

const row = (over: Partial<RegistryRow> = {}): RegistryRow =>
  ({
    id: over.id ?? "id-1",
    selector: "Npi",
    status: "approved",
    source: "token",
    token: "provider.npi",
    fieldLabel: "NPI",
    ...over,
  }) as RegistryRow;

const VALUES = {
  "provider.npi": "1999999984",
  "facility.state": "nc",
  "provider.dob": "1980-04-09",
};

describe("applyRegistryTransform", () => {
  it("normalizes a state code's case and leaves anything else alone", () => {
    expect(applyRegistryTransform("nc", "state_abbrev")).toBe("NC");
    expect(applyRegistryTransform("North Carolina", "state_abbrev")).toBe("North Carolina");
  });

  it("reshapes only the machine date forms", () => {
    expect(applyRegistryTransform("1980-04-09", "date_mmddyyyy")).toBe("04/09/1980");
    expect(applyRegistryTransform("4/9/1980", "date_mmddyyyy")).toBe("04/09/1980");
    expect(applyRegistryTransform("April 9 1980", "date_mmddyyyy")).toBe("April 9 1980");
  });

  it("is a no-op for no transform and for one it does not know", () => {
    expect(applyRegistryTransform("nc", null)).toBe("nc");
    expect(applyRegistryTransform("nc", "shout")).toBe("nc");
  });
});

describe("planPayerFormFill", () => {
  it("fills an approved token from the case's resolved values", () => {
    const plan = planPayerFormFill([row()], VALUES);
    expect(plan.fill).toHaveLength(1);
    expect(plan.fill[0].value).toBe("1999999984");
    expect(plan.fieldsFilled).toBe(1);
    expect(plan.fieldsSkipped).toEqual([]);
  });

  it("applies the row's transform to the resolved value", () => {
    const plan = planPayerFormFill(
      [row({ token: "facility.state", transform: "state_abbrev", selector: "St" })],
      VALUES,
    );
    expect(plan.fill[0].value).toBe("NC");
  });

  it("writes a hardcoded row's literal, with no token involved", () => {
    const plan = planPayerFormFill(
      [row({ source: "hardcoded", token: null, hardcodedValue: "Physical Therapy" })],
      VALUES,
    );
    expect(plan.fill[0]).toMatchObject({ value: "Physical Therapy", outcome: "fixed" });
    expect(plan.fieldsSkipped).toEqual([]);
  });

  it("lists a manual field as the person's, and never as a gap", () => {
    const plan = planPayerFormFill(
      [row({ source: "manual", token: null, fieldLabel: "Wet signature" })],
      VALUES,
    );
    expect(plan.fill).toEqual([]);
    expect(plan.manualLabels).toEqual(["Wet signature"]);
    expect(plan.fieldsSkipped).toEqual([]);
  });

  it("treats an undecided row as a gap — nothing is assumed for it", () => {
    const plan = planPayerFormFill(
      [row({ status: "proposed", source: "manual", token: null })],
      VALUES,
    );
    expect(plan.fill).toEqual([]);
    expect(plan.fieldsSkipped).toEqual([{ selector: "Npi", label: "NPI", reason: "unmapped" }]);
  });

  it("reports a mapped token that resolves to nothing, rather than writing blank", () => {
    const plan = planPayerFormFill([row({ token: "provider.caqhId" })], VALUES);
    expect(plan.fill).toEqual([]);
    expect(plan.fieldsSkipped).toEqual([{ selector: "Npi", label: "NPI", reason: "empty_token" }]);
  });

  it("skips a retired row entirely", () => {
    const plan = planPayerFormFill([row({ status: "retired" })], VALUES);
    expect(plan.fill).toEqual([]);
    expect(plan.fieldsSkipped).toEqual([]);
    expect(plan.entries[0].outcome).toBe("stale");
  });

  it("prefers the admin's display label in what it reports", () => {
    const plan = planPayerFormFill([row({ displayLabel: "Provider NPI" })], VALUES);
    expect(plan.fill[0].label).toBe("Provider NPI");
  });
});
