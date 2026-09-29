import { describe, expect, it } from "vitest";
import type { RosterEvaluation, RosterEvaluationResult } from "./rosterValidation";
import { evaluateRosterSource } from "./rosterValidation";
import type { RosterMapping, RosterTemplate } from "@/types";

const template: RosterTemplate = {
  id: "template-1",
  slug: "unit-test-roster",
  payerName: "Test payer",
  name: "Test provider roster",
  schemaVersion: 1,
  verified: true,
  verificationStatus: "verified",
  grains: ["provider", "provider_location"],
  columns: [
    { key: "npi", header: "Individual NPI", required: true, targetType: "npi" },
    { key: "address", header: "Practice address", required: true, targetType: "text" },
    { key: "zip", header: "Practice ZIP+4", required: true, targetType: "zip_plus_4" },
    { key: "license", header: "License number", required: false, targetType: "text" },
  ],
};

const baseMapping: RosterMapping = {
  id: "mapping-1",
  orgId: "org-1",
  templateId: template.id,
  name: "Test mapping",
  grain: "provider_location",
  selectedProviderIds: ["provider-1"],
  selectedFacilityIds: ["facility-1"],
  selectedGroupIds: [],
  columnAssignments: [
    { columnKey: "npi", sourceField: "provider.npi", transform: "npi_check" },
    { columnKey: "address", sourceField: "facility.street", transform: "uppercase" },
    { columnKey: "zip", sourceField: "facility.zip", transform: null },
    { columnKey: "license", sourceField: "license.license_number", transform: null },
  ],
  revision: 3,
  updatedAt: "2026-09-25T12:00:00Z",
};

const validSourceRow = {
  rowKey: "provider-1:facility-1",
  provider: {
    first_name: "Ada",
    last_name: "Lovelace",
    npi: "1234567893",
    ssn: "123-45-6789",
    ssn_last4: "6789",
  },
  facility: {
    id: "facility-1",
    name: "North Clinic",
    street: "123 Main Street",
    city: "Raleigh",
    zip: "12345-6789",
    state: "NC",
    is_active: true,
  },
  licenses: [
    {
      license_number: "RN123",
      state: "NC",
      status: "active",
      issue_date: "2020-01-01",
      expiration_date: "2030-01-01",
    },
  ],
};

function evaluate(
  overrides: Parameters<typeof evaluateRosterSource>[1] = [],
  patch: Partial<RosterMapping> = {},
  sourceRows: unknown[] = [validSourceRow],
  sourceTemplate: RosterTemplate = template,
): RosterEvaluationResult {
  const input: RosterEvaluation = {
    mapping: { ...baseMapping, ...patch },
    template: sourceTemplate,
    sourceRows,
    inputFingerprint: "fingerprint-1",
    validationDate: "2026-09-25",
  };
  return evaluateRosterSource(input, overrides);
}

describe("evaluateRosterSource", () => {
  it("accepts valid NPI, required address, ZIP+4, and active target-state license", () => {
    const result = evaluate();
    expect(result.validation.exportable).toBe(true);
    expect(result.validation.hardErrorCount).toBe(0);
    expect(result.preview.rows[0]?.values).toMatchObject({
      npi: "1234567893",
      address: "123 MAIN STREET",
      zip: "12345-6789",
      license: "RN123",
    });
  });

  it("blocks malformed provider NPI and binds override to exact row, rule, and field", () => {
    const row = {
      ...validSourceRow,
      provider: { ...validSourceRow.provider, npi: "1234567890" },
      facility: { ...validSourceRow.facility, group_id: "group-1" },
      group: { id: "group-1", name: "North Group", npi_type2: "1234567893", tin: "001234567" },
    };
    const npiMapping: Partial<RosterMapping> = {
      selectedGroupIds: ["group-1"],
      columnAssignments: baseMapping.columnAssignments.map((assignment) =>
        assignment.columnKey === "npi"
          ? { ...assignment, sourceField: "group.npi_type2" }
          : assignment,
      ),
    };
    const result = evaluate([], npiMapping, [row]);
    const providerNpiIssue = result.validation.issues.find(
      (issue) => issue.ruleCode === "provider_npi_invalid" && issue.fieldKey === "provider.npi",
    );
    expect(providerNpiIssue?.overrideable).toBe(true);
    expect(result.validation.exportable).toBe(false);

    const exactOverride = {
      id: "override-1",
      rowKey: providerNpiIssue!.rowKey,
      ruleCode: providerNpiIssue!.ruleCode,
      fieldKey: providerNpiIssue!.fieldKey,
      reason: "Payer confirmed a one-time exception for this provider record.",
    };
    const overridden = evaluate([exactOverride], npiMapping, [row]);
    const matching = overridden.validation.issues.find(
      (issue) => issue.ruleCode === "provider_npi_invalid" && issue.fieldKey === "provider.npi",
    );
    expect(matching?.overrideId).toBe("override-1");
    expect(overridden.validation.exportable).toBe(true);

    const wrongRow = evaluate([{ ...exactOverride, rowKey: "another-row" }], npiMapping, [row]);
    expect(wrongRow.validation.hardErrorCount).toBe(1);
    expect(wrongRow.validation.exportable).toBe(false);
  });

  it("requires an explicit NPI check transform to trim a padded source NPI", () => {
    const npiTemplate: RosterTemplate = {
      ...template,
      columns: [{ key: "npi", header: "Individual NPI", required: true, targetType: "npi" }],
    };
    const paddedRow = {
      ...validSourceRow,
      provider: { ...validSourceRow.provider, npi: " 1234567893 " },
    };
    const assignment = {
      columnKey: "npi",
      sourceField: "provider.npi" as const,
      transform: null,
    };
    const invalid = evaluate([], { columnAssignments: [assignment] }, [paddedRow], npiTemplate);
    expect(invalid.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleCode: "npi_invalid", fieldKey: "npi" }),
      ]),
    );
    expect(invalid.preview.rows[0]?.values.npi).toBe(" 1234567893 ");

    const transformed = evaluate(
      [],
      { columnAssignments: [{ ...assignment, transform: "npi_check" }] },
      [paddedRow],
      npiTemplate,
    );
    expect(transformed.preview.rows[0]?.values.npi).toBe("1234567893");
    expect(transformed.validation.exportable).toBe(true);
  });

  it("requires a nonblank mapped address and ZIP+4 formatting", () => {
    const row = {
      ...validSourceRow,
      facility: {
        ...validSourceRow.facility,
        street: "  ",
        city: "",
        state: "",
        zip: "12345",
      },
    };
    const result = evaluate([], {}, [row]);
    expect(result.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleCode: "required_value_missing", fieldKey: "address" }),
        expect.objectContaining({
          ruleCode: "facility_street_missing",
          fieldKey: "facility.street",
        }),
        expect.objectContaining({ ruleCode: "facility_city_missing", fieldKey: "facility.city" }),
        expect.objectContaining({ ruleCode: "facility_state_missing", fieldKey: "facility.state" }),
        expect.objectContaining({
          ruleCode: "facility_zip_plus_4_invalid",
          fieldKey: "facility.zip",
        }),
      ]),
    );
    expect(result.validation.exportable).toBe(false);
  });

  it("requires a current active license in the selected location state", () => {
    const row = {
      ...validSourceRow,
      licenses: [
        {
          license_number: "RN123",
          state: "SC",
          status: "active",
          issue_date: "2020-01-01",
          expiration_date: "2030-01-01",
        },
      ],
    };
    const result = evaluate([], {}, [row]);
    expect(result.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleCode: "active_state_license_missing",
          fieldKey: "license.license_number",
          overrideable: true,
        }),
      ]),
    );
    expect(result.validation.exportable).toBe(false);
  });

  it("does not accept or output an active matching-state license without a license number", () => {
    const row = {
      ...validSourceRow,
      licenses: [
        {
          license_number: "",
          state: "NC",
          status: "active",
          issue_date: "2020-01-01",
          expiration_date: "2030-01-01",
        },
      ],
    };
    const result = evaluate([], {}, [row]);
    expect(result.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleCode: "active_state_license_missing",
          fieldKey: "license.license_number",
        }),
      ]),
    );
    expect(result.preview.rows[0]?.values.license).toBeNull();
    expect(result.validation.exportable).toBe(false);
  });

  it("does not allow overrides to bypass a missing provider-location relationship", () => {
    const row = { ...validSourceRow, facility: null, licenses: [] };
    const result = evaluate(
      [
        {
          id: "override-location",
          rowKey: "provider-1:facility-1",
          ruleCode: "location_assignment_missing",
          fieldKey: "facility.id",
          reason: "The team requested a temporary exception for this relationship.",
        },
      ],
      {},
      [row],
    );
    const relationshipIssue = result.validation.issues.find(
      (issue) => issue.ruleCode === "location_assignment_missing",
    );
    expect(relationshipIssue?.overrideable).toBe(false);
    expect(relationshipIssue?.overrideId).toBeNull();
    expect(result.validation.exportable).toBe(false);
  });

  it("redacts and blocks malformed SSN last-four values without override", () => {
    const ssnTemplate: RosterTemplate = {
      ...template,
      columns: [
        ...template.columns,
        { key: "ssn", header: "SSN last 4", required: false, targetType: "text" },
      ],
    };
    const ssnMapping: Partial<RosterMapping> = {
      columnAssignments: [
        ...baseMapping.columnAssignments,
        { columnKey: "ssn", sourceField: "provider.ssn_last4", transform: null },
      ],
    };
    const row = {
      ...validSourceRow,
      provider: { ...validSourceRow.provider, ssn_last4: "678" },
    };
    const blocked = evaluate([], ssnMapping, [row], ssnTemplate);
    const issue = blocked.validation.issues.find((entry) => entry.ruleCode === "ssn_last4_invalid");
    expect(issue?.overrideable).toBe(false);
    expect(issue?.message).not.toContain("678");
    expect(blocked.preview.rows[0]?.values.ssn).toBeNull();
    const attemptedOverride = evaluate(
      [
        {
          id: "ssn-override",
          rowKey: "provider-1:facility-1",
          ruleCode: "ssn_last4_invalid",
          fieldKey: "ssn",
          reason: "A source value exception was approved by our operations team.",
        },
      ],
      ssnMapping,
      [row],
      ssnTemplate,
    );
    expect(
      attemptedOverride.validation.issues.find((entry) => entry.ruleCode === "ssn_last4_invalid")
        ?.overrideId,
    ).toBeNull();
    expect(attemptedOverride.validation.exportable).toBe(false);
  });

  it("reports malformed mapped phone and calendar date values", () => {
    const extraColumns = [
      { key: "phone", header: "Practice phone", required: false, targetType: "phone" as const },
      { key: "dob", header: "Date of birth", required: false, targetType: "date" as const },
    ];
    const extendedTemplate: RosterTemplate = {
      ...template,
      columns: [...template.columns, ...extraColumns],
    };
    const extendedMapping: Partial<RosterMapping> = {
      columnAssignments: [
        ...baseMapping.columnAssignments,
        { columnKey: "phone", sourceField: "facility.phone", transform: "phone_strip" },
        { columnKey: "dob", sourceField: "provider.date_of_birth", transform: "date_mm_dd_yyyy" },
      ],
    };
    const row = {
      ...validSourceRow,
      provider: { ...validSourceRow.provider, date_of_birth: "2023-02-29" },
      facility: { ...validSourceRow.facility, phone: "555-01" },
    };
    const result = evaluate([], extendedMapping, [row], extendedTemplate);
    expect(result.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleCode: "phone_invalid",
          fieldKey: "phone",
          overrideable: true,
        }),
        expect.objectContaining({ ruleCode: "date_invalid", fieldKey: "dob", overrideable: true }),
      ]),
    );
  });
});
