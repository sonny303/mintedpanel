// MINT-91 — the import checks a phone only where it writes one: a NEW
// provider, group, or facility. A row matched to an existing record never
// writes its phone, so a stored legacy value never blocks a re-import.
import { describe, expect, it } from "vitest";
import {
  dedupeFacilityRows,
  dedupeGroupRows,
  dedupeImportRows,
  type DedupeInputs,
  type ImportRowDisposition,
  type StagedImportRow,
} from "@/lib/importDedupe";

// Check-digit-valid NPIs, so the rows stay on the phone path once the MINT-7
// NPI check digit binds new identities too.
const JANE = {
  id: "prov-jane",
  firstName: "Jane",
  lastName: "Shelby",
  npi: "1093817462",
  specialty: "Physical Therapy",
};
const NEW_NPI = "1112223338";
const GROUP1 = { id: "grp-1", name: "Shelby Group 1", tin: "123456789" };
const FAC1 = { id: "fac-1", name: "Shelby Clinic North" };

const row = (line: number, mapped: Record<string, string | null>): StagedImportRow => ({
  line,
  mapped,
});

function providerInputs(rows: StagedImportRow[]): DedupeInputs {
  return {
    rows,
    providers: [JANE],
    groups: [GROUP1],
    facilities: [FAC1],
    groupAssignments: [{ providerId: JANE.id, groupId: GROUP1.id }],
    facilityAssignments: [{ providerId: JANE.id, facilityId: FAC1.id }],
    licenses: [],
  };
}

const providerRow = (line: number, npi: string, phone: string | null): StagedImportRow =>
  row(line, {
    provider_first_name: npi === JANE.npi ? "Jane" : "Nora",
    provider_last_name: npi === JANE.npi ? "Shelby" : "Newton",
    npi,
    phone,
    group_name: GROUP1.name,
    group_tin: GROUP1.tin,
    facility_name: FAC1.name,
  });

const kinds = (out: ImportRowDisposition[]) => out.map((d) => d.kind);

describe("provider import — phone (MINT-91)", () => {
  it("blocks a NEW provider whose phone has letters, naming the column", () => {
    const out = dedupeImportRows(providerInputs([providerRow(2, NEW_NPI, "abc-def-ghij")]));
    expect(out).toEqual([
      {
        kind: "blocked",
        line: 2,
        column: "phone",
        displayName: "Nora Newton",
        reason: "phone must be a 10-digit US phone number",
      },
    ]);
  });

  it("blocks every later row of a provider whose first row is phone-blocked", () => {
    const out = dedupeImportRows(
      providerInputs([
        providerRow(2, NEW_NPI, "abc-def-ghij"),
        providerRow(3, NEW_NPI, "910-555-0100"),
        providerRow(4, NEW_NPI, null),
      ]),
    );
    expect(kinds(out)).toEqual(["blocked", "blocked", "blocked"]);
    expect(out[1]).toMatchObject({
      line: 3,
      column: "npi",
      reason: `Same provider (NPI ${NEW_NPI}) as row 2, which is blocked`,
    });
  });

  it("creates a NEW provider with a blank or valid phone", () => {
    expect(kinds(dedupeImportRows(providerInputs([providerRow(2, NEW_NPI, null)])))).toEqual([
      "create",
    ]);
    const out = dedupeImportRows(providerInputs([providerRow(2, NEW_NPI, "+1 (910) 555-0100")]));
    expect(kinds(out)).toEqual(["create"]);
  });

  it("never blocks a row for an EXISTING provider — its phone is never written", () => {
    expect(
      kinds(dedupeImportRows(providerInputs([providerRow(2, JANE.npi, "abc-def-ghij")]))),
    ).toEqual(["skip"]);
  });
});

describe("group import — phone (MINT-91)", () => {
  it("blocks a NEW group on the first invalid block phone; inherited blocks follow billing", () => {
    const result = dedupeGroupRows(
      [
        row(2, { name: "Fresh Group", tin: "555001234", billing_phone: "919-555-0100" }),
        row(3, { name: "Other Group", tin: "555009999", cred_phone: "555-01" }),
      ],
      [GROUP1],
    );
    expect(result.creates.map((c) => c.line)).toEqual([2]);
    expect(result.blocked).toEqual([
      {
        line: 3,
        column: "cred_phone",
        displayName: "Other Group",
        reason: "cred_phone must be a 10-digit US phone number",
      },
    ]);
  });

  it("blocks a later row with the same TIN instead of creating it", () => {
    const result = dedupeGroupRows(
      [
        row(2, { name: "Fresh Group", tin: "555001234", billing_phone: "abc-def-ghij" }),
        row(3, { name: "Fresh Group", tin: "555001234", billing_phone: "919-555-0100" }),
      ],
      [GROUP1],
    );
    expect(result.creates).toHaveLength(0);
    expect(result.skips).toHaveLength(0);
    expect(result.blocked.map((b) => [b.line, b.column])).toEqual([
      [2, "billing_phone"],
      [3, "group_tin"],
    ]);
    expect(result.blocked[1].reason).toBe(
      "Duplicate TIN 555001234 in this file — row 2 is blocked",
    );
  });

  it("skips an EXISTING group (matched by TIN) whatever its phone", () => {
    const result = dedupeGroupRows(
      [row(2, { name: "Shelby Group 1", tin: "123456789", billing_phone: "abc-def-ghij" })],
      [GROUP1],
    );
    expect(result.skips).toHaveLength(1);
    expect(result.blocked).toHaveLength(0);
  });
});

describe("facility import — phone (MINT-91)", () => {
  const facilities = [
    {
      id: "fac-river",
      name: "River Clinic",
      groupId: GROUP1.id,
      street: "10 River Rd",
      city: "Wilmington",
      state: "NC",
      zip: "28401",
    },
  ];
  const base = {
    facility_name: "River Clinic",
    group_tin: "123456789",
    street: "10 River Rd",
    city: "Wilmington",
    state: "NC",
    zip: "28401",
  };

  it("blocks a NEW facility with an invalid phone or appointment phone", () => {
    const result = dedupeFacilityRows(
      [
        row(2, { ...base, street: "20 Ocean Ave", phone: "910-555-0100 ext. 4" }),
        row(3, { ...base, street: "30 Bay St", appointment_phone: "CALL-NOW" }),
      ],
      [GROUP1],
      facilities,
    );
    expect(result.creates.map((c) => c.line)).toEqual([2]);
    expect(result.blocked.map((b) => [b.line, b.column])).toEqual([[3, "appointment_phone"]]);
  });

  it("blocks a later row for the same facility instead of creating it", () => {
    const fresh = { ...base, street: "20 Ocean Ave" };
    const result = dedupeFacilityRows(
      [row(2, { ...fresh, phone: "abc-def-ghij" }), row(3, { ...fresh, phone: "910-555-0100" })],
      [GROUP1],
      facilities,
    );
    expect(result.creates).toHaveLength(0);
    expect(result.blocked.map((b) => [b.line, b.column])).toEqual([
      [2, "phone"],
      [3, "facility_name"],
    ]);
    expect(result.blocked[1].reason).toMatch(/row 2 is blocked$/);
  });

  it("skips an EXISTING facility whatever its phone", () => {
    const result = dedupeFacilityRows(
      [row(2, { ...base, phone: "abc-def-ghij" })],
      [GROUP1],
      facilities,
    );
    expect(result.skips).toHaveLength(1);
    expect(result.blocked).toHaveLength(0);
  });
});
