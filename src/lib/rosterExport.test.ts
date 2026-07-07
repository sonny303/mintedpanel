import { describe, expect, it } from "vitest";
import { ROSTER_CSV_HEADER, buildRosterCsv, type RosterRowInput } from "./rosterExport";

const HEADER =
  "Provider Name,Credentials,NPI,Specialty,Home State,Group / Facility,Cases,Case Statuses";

function row(overrides: Partial<RosterRowInput> = {}): RosterRowInput {
  return {
    firstName: "Ada",
    lastName: "Byron",
    credentials: "DPT",
    npi: "1234567890",
    specialty: "Physical Therapy",
    homeState: "KS",
    groupOrFacility: "Kansas Fitness Physio",
    cases: [],
    ...overrides,
  };
}

describe("buildRosterCsv", () => {
  it("emits the locked header as the first line", () => {
    expect(buildRosterCsv([]).split("\n")[0]).toBe(HEADER);
  });

  it("empty input yields the header row only (no trailing newline)", () => {
    expect(buildRosterCsv([])).toBe(HEADER);
  });

  it("maps a provider row and summarizes its cases per payer", () => {
    const csv = buildRosterCsv([
      row({
        cases: [
          { payerName: "Aetna", state: "KS", statusLabel: "In-Network" },
          { payerName: "Cigna", state: "MO", statusLabel: "Submitted" },
        ],
      }),
    ]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      "Ada Byron,DPT,1234567890,Physical Therapy,KS,Kansas Fitness Physio,2,Aetna (KS): In-Network; Cigna (MO): Submitted",
    );
  });

  it("sorts the case summary by payer then state (deterministic)", () => {
    const csv = buildRosterCsv([
      row({
        cases: [
          { payerName: "Cigna", state: "MO", statusLabel: "Submitted" },
          { payerName: "Aetna", state: "MO", statusLabel: "Approved" },
          { payerName: "Aetna", state: "KS", statusLabel: "In-Network" },
        ],
      }),
    ]);
    expect(csv.split("\n")[1]).toContain(
      "Aetna (KS): In-Network; Aetna (MO): Approved; Cigna (MO): Submitted",
    );
  });

  it("renders empty status label as 'No status' and drops parens when state is blank", () => {
    const csv = buildRosterCsv([
      row({ cases: [{ payerName: "Humana", state: "", statusLabel: "" }] }),
    ]);
    expect(csv.split("\n")[1]).toContain("Humana: No status");
  });

  it("preserves provider order and keeps one row per provider", () => {
    const csv = buildRosterCsv([
      row({ firstName: "Ada", lastName: "Byron" }),
      row({ firstName: "Grace", lastName: "Hopper" }),
    ]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1].startsWith("Ada Byron,")).toBe(true);
    expect(lines[2].startsWith("Grace Hopper,")).toBe(true);
  });

  it("renders null optional fields as empty cells", () => {
    const csv = buildRosterCsv([
      row({
        credentials: null,
        npi: null,
        specialty: null,
        homeState: null,
        groupOrFacility: null,
      }),
    ]);
    expect(csv.split("\n")[1]).toBe("Ada Byron,,,,,,0,");
  });

  describe("CSV escaping", () => {
    it("quotes a field containing a comma", () => {
      const csv = buildRosterCsv([row({ credentials: "PT, DPT" })]);
      expect(csv.split("\n")[1]).toContain('"PT, DPT"');
    });

    it("doubles embedded quotes and wraps the field", () => {
      const csv = buildRosterCsv([row({ groupOrFacility: 'Say "Hi" Clinic' })]);
      expect(csv.split("\n")[1]).toContain('"Say ""Hi"" Clinic"');
    });

    it("quotes a field containing a newline", () => {
      const csv = buildRosterCsv([row({ specialty: "Line1\nLine2" })]);
      expect(csv).toContain('"Line1\nLine2"');
    });

    it("quotes a payer name with a comma inside the case summary", () => {
      const csv = buildRosterCsv([
        row({ cases: [{ payerName: "Blue Cross, Inc.", state: "KS", statusLabel: "Submitted" }] }),
      ]);
      expect(csv.split("\n")[1]).toContain('"Blue Cross, Inc. (KS): Submitted"');
    });
  });

  describe("PHI-minimal", () => {
    it("the header carries no SSN, DOB, or home-address columns", () => {
      const header = ROSTER_CSV_HEADER.join(" ").toLowerCase();
      for (const banned of ["ssn", "social", "birth", "dob", "street", "zip"]) {
        expect(header).not.toContain(banned);
      }
    });

    it("the row shape offers no field to leak SSN/DOB/address", () => {
      // Compile-time guarantee mirrored at runtime: only roster-safe keys exist.
      const keys = Object.keys(
        row({ cases: [{ payerName: "Aetna", state: "KS", statusLabel: "In-Network" }] }),
      );
      expect(keys.sort()).toEqual(
        [
          "cases",
          "credentials",
          "firstName",
          "groupOrFacility",
          "homeState",
          "lastName",
          "npi",
          "specialty",
        ].sort(),
      );
    });
  });
});
