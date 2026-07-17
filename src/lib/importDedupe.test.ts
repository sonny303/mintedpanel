import { describe, expect, it } from "vitest";
import {
  ALREADY_EXISTS_REASON,
  MISSING_NPI_MATCH_REASON,
  MISSING_NPI_REASON,
  buildCommitPlan,
  dedupeGroupRows,
  dedupeFacilityRows,
  dedupeImportRows,
  planBatchAssignment,
  summarizeImportPreview,
  unresolvedConflicts,
  type DedupeInputs,
  type ImportRowDisposition,
  type StagedImportRow,
  type UpdateDisposition,
} from "@/lib/importDedupe";

const JANE = {
  id: "prov-jane",
  firstName: "Jane",
  lastName: "Shelby",
  npi: "1234567890",
  specialty: "Physical Therapy",
};
const GROUP1 = { id: "grp-1", name: "Shelby Group 1", tin: "123456789" };
const GROUP2 = { id: "grp-2", name: "Shelby Group 2", tin: "987654321" };
const FAC1 = { id: "fac-1", name: "Shelby Clinic North" };
const FAC2 = { id: "fac-2", name: "Shelby Clinic South" };
const JANE_NC_LICENSE = {
  id: "lic-jane-nc",
  providerId: JANE.id,
  state: "NC",
  licenseNumber: "NC-100",
  issueDate: "2020-01-01",
  expirationDate: "2027-01-01",
};

function baseInputs(rows: StagedImportRow[]): DedupeInputs {
  return {
    rows,
    providers: [JANE],
    groups: [GROUP1, GROUP2],
    facilities: [FAC1, FAC2],
    groupAssignments: [{ providerId: JANE.id, groupId: GROUP1.id }],
    facilityAssignments: [{ providerId: JANE.id, facilityId: FAC1.id }],
    licenses: [JANE_NC_LICENSE],
  };
}

function row(line: number, mapped: Record<string, string | null>): StagedImportRow {
  return { line, mapped };
}

const janeRow = (line: number, extra: Record<string, string | null> = {}): StagedImportRow =>
  row(line, {
    provider_first_name: "Jane",
    provider_last_name: "Shelby",
    npi: JANE.npi,
    group_name: GROUP1.name,
    group_tin: GROUP1.tin,
    facility_name: FAC1.name,
    ...extra,
  });

const newProviderRow = (line: number, extra: Record<string, string | null> = {}): StagedImportRow =>
  row(line, {
    provider_first_name: "Nora",
    provider_last_name: "Newton",
    npi: "1112223334",
    specialty: "Physical Therapy",
    group_name: GROUP1.name,
    group_tin: GROUP1.tin,
    facility_name: FAC1.name,
    license_state: "NC",
    license_number: "NC-200",
    license_expiration_date: "2028-06-01",
    ...extra,
  });

const only = <T extends ImportRowDisposition["kind"]>(
  dispositions: ImportRowDisposition[],
  kind: T,
) => dispositions.filter((d): d is Extract<ImportRowDisposition, { kind: T }> => d.kind === kind);

describe("dedupeImportRows — five-part matching", () => {
  it("creates a new provider with resolved group/facility/license", () => {
    const out = dedupeImportRows(baseInputs([newProviderRow(2)]));
    expect(out).toHaveLength(1);
    const create = only(out, "create")[0];
    expect(create.provider.npi).toBe("1112223334");
    expect(create.groupIds).toEqual([GROUP1.id]);
    expect(create.facilityIds).toEqual([FAC1.id]);
    expect(create.licenses).toEqual([
      { state: "NC", licenseNumber: "NC-200", issueDate: null, expirationDate: "2028-06-01" },
    ]);
  });

  it("skips an exact five-part duplicate with 'already exists'", () => {
    const out = dedupeImportRows(
      baseInputs([janeRow(2, { license_state: "NC", license_number: "NC-100" })]),
    );
    expect(out).toHaveLength(1);
    const skip = only(out, "skip")[0];
    expect(skip.providerId).toBe(JANE.id);
    expect(skip.reason).toBe(ALREADY_EXISTS_REASON);
  });

  it("proposes assignments on the existing provider for a name+NPI match under a new group/facility — never a second record (TS-61)", () => {
    const out = dedupeImportRows(
      baseInputs([
        janeRow(2, { group_name: GROUP2.name, group_tin: GROUP2.tin, facility_name: FAC2.name }),
      ]),
    );
    expect(only(out, "create")).toHaveLength(0);
    const update = only(out, "update")[0];
    expect(update.providerId).toBe(JANE.id);
    expect(update.addGroupIds).toEqual([GROUP2.id]);
    expect(update.addFacilityIds).toEqual([FAC2.id]);
    expect(update.conflicts).toHaveLength(0);
  });

  it("blocks missing-NPI rows for manual review — matched by name or not, never merged", () => {
    const out = dedupeImportRows(
      baseInputs([
        janeRow(2, { npi: null }),
        row(3, { provider_first_name: "Totally", provider_last_name: "Unknown", npi: null }),
      ]),
    );
    const blocked = only(out, "blocked");
    expect(blocked).toHaveLength(2);
    expect(blocked[0].reason).toBe(MISSING_NPI_MATCH_REASON);
    expect(blocked[1].reason).toBe(MISSING_NPI_REASON);
    expect(blocked.every((b) => b.column === "npi")).toBe(true);
  });

  it("treats a name match with a DIFFERENT existing NPI as a new provider, with a note", () => {
    const out = dedupeImportRows(baseInputs([janeRow(2, { npi: "9998887776" })]));
    const create = only(out, "create")[0];
    expect(create).toBeDefined();
    expect(create.npi).toBe("9998887776");
    expect(create.notes.some((n) => n.includes("different NPI"))).toBe(true);
  });

  it("turns a name match on an NPI-less existing provider into an NPI-fill conflict (update, not create)", () => {
    const inputs = baseInputs([janeRow(2)]);
    inputs.providers = [{ ...JANE, npi: null }];
    inputs.licenses = [];
    const out = dedupeImportRows(inputs);
    const update = only(out, "update")[0];
    expect(update).toBeDefined();
    expect(update.providerId).toBe(JANE.id);
    const npiConflict = update.conflicts.find((c) => c.field === "npi");
    expect(npiConflict?.existingDisplay).toBeNull();
    expect(npiConflict?.importedDisplay).toBe(JANE.npi);
    expect(only(out, "create")).toHaveLength(0);
  });

  it("folds multiple lines of one NEW provider into ONE create (multi-group, multi-license)", () => {
    const out = dedupeImportRows(
      baseInputs([
        newProviderRow(2),
        newProviderRow(3, {
          group_name: GROUP2.name,
          group_tin: GROUP2.tin,
          facility_name: FAC2.name,
          license_state: "SC",
          license_number: "SC-300",
          license_expiration_date: null,
        }),
      ]),
    );
    expect(out).toHaveLength(1);
    const create = only(out, "create")[0];
    expect(create.lines).toEqual([2, 3]);
    expect(create.groupIds).toEqual([GROUP1.id, GROUP2.id]);
    expect(create.facilityIds).toEqual([FAC1.id, FAC2.id]);
    expect(create.licenses.map((l) => l.state)).toEqual(["NC", "SC"]);
  });

  it("folds multiple lines of one EXISTING provider into ONE update", () => {
    const out = dedupeImportRows(
      baseInputs([
        janeRow(2, { group_name: GROUP2.name, group_tin: GROUP2.tin }),
        janeRow(3, { facility_name: FAC2.name }),
      ]),
    );
    expect(out).toHaveLength(1);
    const update = only(out, "update")[0];
    expect(update.lines).toEqual([2, 3]);
    expect(update.addGroupIds).toEqual([GROUP2.id]);
    expect(update.addFacilityIds).toEqual([FAC2.id]);
  });

  it("resolves the group by TIN first, then by name with a TIN-mismatch note", () => {
    const byTin = dedupeImportRows(
      baseInputs([
        newProviderRow(2, { group_name: "Renamed Entity LLC", group_tin: "12-3456789" }),
      ]),
    );
    expect(only(byTin, "create")[0].groupIds).toEqual([GROUP1.id]);

    const byName = dedupeImportRows(
      baseInputs([newProviderRow(2, { group_name: GROUP1.name, group_tin: "555555555" })]),
    );
    const create = only(byName, "create")[0];
    expect(create.groupIds).toEqual([GROUP1.id]);
    expect(create.notes.some((n) => n.includes("TIN in the file differs"))).toBe(true);
  });

  it("notes unresolved group/facility instead of blocking — batch assignment is the remedy", () => {
    const out = dedupeImportRows(
      baseInputs([
        newProviderRow(2, {
          group_name: "No Such Group",
          group_tin: "000000000",
          facility_name: "No Such Facility",
        }),
      ]),
    );
    const create = only(out, "create")[0];
    expect(create.groupIds).toEqual([]);
    expect(create.facilityIds).toEqual([]);
    expect(create.notes.some((n) => n.includes('Group "No Such Group" not found'))).toBe(true);
    expect(create.notes.some((n) => n.includes('Facility "No Such Facility" not found'))).toBe(
      true,
    );
  });
});

describe("conflict detection + resolution (TS-62)", () => {
  it("flags a specialty conflict with the existing value as the shown default", () => {
    const out = dedupeImportRows(baseInputs([janeRow(2, { specialty: "Occupational Therapy" })]));
    const update = only(out, "update")[0];
    const conflict = update.conflicts.find((c) => c.field === "specialty");
    expect(conflict?.existingDisplay).toBe("Physical Therapy");
    expect(conflict?.importedDisplay).toBe("Occupational Therapy");
  });

  it("flags a name conflict when the NPI matches but the name differs", () => {
    const out = dedupeImportRows(
      baseInputs([janeRow(2, { provider_first_name: "Janet", provider_last_name: "Shelby-Ross" })]),
    );
    const update = only(out, "update")[0];
    const conflict = update.conflicts.find((c) => c.field === "name");
    expect(conflict?.existingDisplay).toBe("Jane Shelby");
    expect(conflict?.importedDisplay).toBe("Janet Shelby-Ross");
    expect(conflict?.set).toEqual({ first_name: "Janet", last_name: "Shelby-Ross" });
  });

  it("flags a license conflict for a same-state different number; same number is a no-op", () => {
    const conflictOut = dedupeImportRows(
      baseInputs([janeRow(2, { license_state: "NC", license_number: "NC-999" })]),
    );
    const update = only(conflictOut, "update")[0];
    const conflict = update.conflicts.find((c) => c.field === "license");
    expect(conflict?.existingDisplay).toBe("NC-100");
    expect(conflict?.importedDisplay).toBe("NC-999");
    expect(conflict?.licenseUpdate?.id).toBe(JANE_NC_LICENSE.id);

    const sameOut = dedupeImportRows(
      baseInputs([janeRow(2, { license_state: "NC", license_number: "nc-100" })]),
    );
    expect(only(sameOut, "skip")).toHaveLength(1);
  });

  it("inserts a new-state license on an existing provider without a conflict", () => {
    const out = dedupeImportRows(
      baseInputs([janeRow(2, { license_state: "SC", license_number: "SC-500" })]),
    );
    const update = only(out, "update")[0];
    expect(update.conflicts).toHaveLength(0);
    expect(update.licenseInserts).toEqual([
      { state: "SC", licenseNumber: "SC-500", issueDate: null, expirationDate: null },
    ]);
  });

  it("treats a conflict as unresolved until an EXPLICIT pick — either value resolves it", () => {
    const out = dedupeImportRows(baseInputs([janeRow(2, { specialty: "Occupational Therapy" })]));
    const update = only(out, "update")[0] as UpdateDisposition;
    expect(unresolvedConflicts(update, {})).toHaveLength(1);
    expect(unresolvedConflicts(update, { [JANE.id]: { specialty: "existing" } })).toHaveLength(0);
    expect(unresolvedConflicts(update, { [JANE.id]: { specialty: "imported" } })).toHaveLength(0);
  });
});

describe("summarizeImportPreview — exact reconciliation (F3.1.1)", () => {
  it("reconciles create/update/blocked/skip counts with the staged rows", () => {
    const rows = [
      newProviderRow(2),
      newProviderRow(3, {
        group_name: GROUP2.name,
        group_tin: GROUP2.tin,
        license_state: null,
        license_number: null,
      }),
      janeRow(4, { group_name: GROUP2.name, group_tin: GROUP2.tin }),
      janeRow(5, { npi: null }),
      row(6, {
        provider_first_name: "Solo",
        provider_last_name: "NoNpi",
        npi: null,
      }),
      janeRow(7, { license_state: "NC", license_number: "NC-100" }),
    ];
    const out = dedupeImportRows(baseInputs(rows));
    const summary = summarizeImportPreview(out, {}, 3);
    // rows 2+3 fold into one create; row 4+7 fold into one Jane update
    // (group add, no conflict); rows 5+6 are blocked; 3 scan errors ride in.
    expect(summary.createProviders).toBe(1);
    expect(summary.updateProviders).toBe(1);
    expect(summary.skippedProviders).toBe(0);
    expect(summary.blockedRows).toBe(2 + 3);
    expect(summary.stagedRowsCovered).toBe(rows.length);
  });

  it("moves an update with unresolved conflicts into the blocked bucket — only that row", () => {
    const rows = [janeRow(2, { specialty: "Occupational Therapy" }), newProviderRow(3)];
    const out = dedupeImportRows(baseInputs(rows));
    const before = summarizeImportPreview(out, {}, 0);
    expect(before.createProviders).toBe(1);
    expect(before.updateProviders).toBe(0);
    expect(before.blockedRows).toBe(1);
    const after = summarizeImportPreview(out, { [JANE.id]: { specialty: "existing" } }, 0);
    expect(after.updateProviders).toBe(1);
    expect(after.blockedRows).toBe(0);
  });
});

describe("buildCommitPlan", () => {
  it("emits creates/updates in the RPC wire shape and excludes unresolved rows as blocked entries", () => {
    const rows = [
      newProviderRow(2),
      janeRow(3, { specialty: "Occupational Therapy" }),
      janeRow(4, { license_state: "NC", license_number: "NC-100" }),
    ];
    const out = dedupeImportRows(baseInputs(rows));
    const unresolvedPlan = buildCommitPlan(out, {});
    expect(unresolvedPlan.creates).toHaveLength(1);
    expect(unresolvedPlan.creates[0].provider.first_name).toBe("Nora");
    expect(unresolvedPlan.creates[0].group_ids).toEqual([GROUP1.id]);
    expect(unresolvedPlan.updates).toHaveLength(0);
    expect(unresolvedPlan.blocked_entries).toEqual([
      { line: 3, column: "specialty", reason: "Unresolved specialty conflict — row not committed" },
    ]);
    expect(unresolvedPlan.skipped_count).toBe(0);

    const resolvedPlan = buildCommitPlan(out, { [JANE.id]: { specialty: "imported" } });
    expect(resolvedPlan.updates).toHaveLength(1);
    expect(resolvedPlan.updates[0].set).toEqual({ specialty: "Occupational Therapy" });
    expect(resolvedPlan.blocked_entries).toEqual([]);
  });

  it("keeps existing values out of the update `set` and folds an imported license pick into license_updates", () => {
    const rows = [
      janeRow(2, {
        specialty: "Occupational Therapy",
        license_state: "NC",
        license_number: "NC-999",
        license_expiration_date: "2029-01-01",
      }),
    ];
    const out = dedupeImportRows(baseInputs(rows));
    const plan = buildCommitPlan(out, {
      [JANE.id]: { specialty: "existing", [`license:${JANE_NC_LICENSE.id}`]: "imported" },
    });
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].set).toEqual({});
    expect(plan.updates[0].license_updates).toEqual([
      {
        id: JANE_NC_LICENSE.id,
        license_number: "NC-999",
        issue_date: null,
        expiration_date: "2029-01-01",
      },
    ]);
  });

  it("counts skips and carries manual-review rows as blocked entries", () => {
    const rows = [janeRow(2), janeRow(3, { npi: null })];
    const out = dedupeImportRows(baseInputs(rows));
    const plan = buildCommitPlan(out, {});
    expect(plan.skipped_count).toBe(1);
    expect(plan.blocked_entries).toEqual([
      { line: 3, column: "npi", reason: MISSING_NPI_MATCH_REASON },
    ]);
  });
});

describe("planBatchAssignment (F3.1.5)", () => {
  const P1 = "prov-1";
  const P2 = "prov-2";
  const P3 = "prov-3";

  it("fills only the gaps — explicit row data wins over the batch default", () => {
    const plan = planBatchAssignment({
      providerIds: [P1, P2, P3],
      groupId: GROUP2.id,
      facilityIds: [FAC1.id, FAC2.id],
      existingGroupAssignments: [{ providerId: P1, groupId: GROUP1.id }],
      existingFacilityAssignments: [{ providerId: P2, facilityId: FAC1.id }],
    });
    // P1 keeps its row-explicit group, gets the batch facilities;
    // P2 keeps its row-explicit facility, gets the batch group;
    // P3 had nothing and gets both.
    expect(plan.groupInserts).toEqual([
      { providerId: P2, groupId: GROUP2.id, isPrimary: true },
      { providerId: P3, groupId: GROUP2.id, isPrimary: true },
    ]);
    expect(plan.facilityInserts).toEqual([
      { providerId: P1, facilityId: FAC1.id },
      { providerId: P1, facilityId: FAC2.id },
      { providerId: P3, facilityId: FAC1.id },
      { providerId: P3, facilityId: FAC2.id },
    ]);
    expect(plan.skippedProviderIds).toEqual([]);
  });

  it("is idempotent: a re-run over the filled state plans zero inserts", () => {
    const plan = planBatchAssignment({
      providerIds: [P1, P2],
      groupId: GROUP2.id,
      facilityIds: [FAC1.id],
      existingGroupAssignments: [
        { providerId: P1, groupId: GROUP2.id },
        { providerId: P2, groupId: GROUP2.id },
      ],
      existingFacilityAssignments: [
        { providerId: P1, facilityId: FAC1.id },
        { providerId: P2, facilityId: FAC1.id },
      ],
    });
    expect(plan.groupInserts).toEqual([]);
    expect(plan.facilityInserts).toEqual([]);
    expect(plan.skippedProviderIds).toEqual([P1, P2]);
  });

  it("handles a facilities-only batch (no group default)", () => {
    const plan = planBatchAssignment({
      providerIds: [P1],
      groupId: null,
      facilityIds: [FAC2.id],
      existingGroupAssignments: [],
      existingFacilityAssignments: [],
    });
    expect(plan.groupInserts).toEqual([]);
    expect(plan.facilityInserts).toEqual([{ providerId: P1, facilityId: FAC2.id }]);
  });
});

/* --------------- E3.3 TE-8 — group / facility dedupe grains --------------- */

describe("dedupeGroupRows (TE-8 — grain = TIN)", () => {
  const groups = [GROUP1, GROUP2];
  const row = (line: number, mapped: Record<string, string | null>): StagedImportRow => ({
    line,
    mapped,
  });

  it("skips a staged group whose TIN matches an existing group", () => {
    const result = dedupeGroupRows([row(2, { name: "Shelby Group 1", tin: "123456789" })], groups);
    expect(result.creates).toHaveLength(0);
    expect(result.skips).toHaveLength(1);
    expect(result.skips[0].reason).toContain(ALREADY_EXISTS_REASON);
  });

  it("creates a new group with a fresh TIN", () => {
    const result = dedupeGroupRows([row(2, { name: "Fresh Group", tin: "555001234" })], groups);
    expect(result.creates).toHaveLength(1);
    expect(result.creates[0].mapped.tin).toBe("555001234");
  });

  it("folds a TIN repeated within the file to one create", () => {
    const result = dedupeGroupRows(
      [
        row(2, { name: "Fresh Group", tin: "555001234" }),
        row(3, { name: "Fresh Group Again", tin: "555001234" }),
      ],
      groups,
    );
    expect(result.creates).toHaveLength(1);
    expect(result.skips).toHaveLength(1);
    expect(result.skips[0].reason).toMatch(/Duplicate TIN/);
  });

  it("blocks a row missing a TIN (defensive)", () => {
    const result = dedupeGroupRows([row(2, { name: "No TIN Group", tin: null })], groups);
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0].column).toBe("group_tin");
  });
});

describe("dedupeFacilityRows (TE-8 — grain = group + name + address)", () => {
  const groups = [GROUP1, GROUP2];
  const facilities = [
    {
      id: "fac-1",
      name: "River Clinic",
      groupId: GROUP1.id,
      street: "10 River Rd",
      city: "Wilmington",
      state: "NC",
      zip: "28401",
    },
  ];
  const row = (line: number, mapped: Record<string, string | null>): StagedImportRow => ({
    line,
    mapped,
  });
  const base = {
    facility_name: "River Clinic",
    group_tin: "123456789",
    street: "10 River Rd",
    city: "Wilmington",
    state: "NC",
    zip: "28401",
  };

  it("resolves the parent group by TIN and skips an exact name+address match", () => {
    const result = dedupeFacilityRows([row(2, { ...base })], groups, facilities);
    expect(result.creates).toHaveLength(0);
    expect(result.skips).toHaveLength(1);
    expect(result.skips[0].reason).toContain(ALREADY_EXISTS_REASON);
  });

  it("creates when the address differs (same name, new address = distinct facility)", () => {
    const result = dedupeFacilityRows(
      [row(2, { ...base, street: "20 Ocean Ave" })],
      groups,
      facilities,
    );
    expect(result.creates).toHaveLength(1);
    expect(result.creates[0].groupId).toBe(GROUP1.id);
  });

  it("resolves the parent group by name when TIN is absent", () => {
    const result = dedupeFacilityRows(
      [row(2, { ...base, group_tin: null, group_name: "Shelby Group 1", street: "20 Ocean Ave" })],
      groups,
      facilities,
    );
    expect(result.creates).toHaveLength(1);
    expect(result.creates[0].groupId).toBe(GROUP1.id);
  });

  it("blocks a row whose parent group cannot be resolved (ladder, TE-5)", () => {
    const result = dedupeFacilityRows(
      [row(2, { ...base, group_tin: "000000000", group_name: "Ghost Group" })],
      groups,
      facilities,
    );
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0].reason).toMatch(/not found/);
  });
});
