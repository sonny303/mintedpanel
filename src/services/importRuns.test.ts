import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommitPlan, StagedImportRow } from "@/lib/importDedupe";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  insertAssignmentRows: vi.fn(),
  ensureFirstFacilityPrimary: vi.fn(),
  listEnrollmentFacts: vi.fn(),
  createEnrollmentFact: vi.fn(),
}));

vi.mock("@/integrations/supabase/externalClient", () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}));
vi.mock("@/lib/audit", () => ({
  requireActiveOrg: () => "org-1",
  currentUserId: () => "user-1",
  writeAudit: vi.fn(),
}));
vi.mock("@/services/providerAssignments", () => ({
  insertAssignmentRows: mocks.insertAssignmentRows,
  ensureFirstFacilityPrimary: mocks.ensureFirstFacilityPrimary,
}));
vi.mock("@/services/enrollmentFacts", () => ({
  listEnrollmentFacts: mocks.listEnrollmentFacts,
  createEnrollmentFact: mocks.createEnrollmentFact,
}));

import { commitImportRun } from "./importRuns";

const NPI = "1234567890";
const OTHER_NPI = "9998887776";
const GROUPS = [
  { id: "group-1", name: "Colorado Group", tin: "111111111", npi_type2: "1111111111" },
  { id: "group-2", name: "Utah Group", tin: "222222222", npi_type2: "2222222222" },
  { id: "group-3", name: "Arizona Group", tin: "333333333", npi_type2: "3333333333" },
];

interface CapturedWrite {
  table: string;
  payload: unknown;
}

// Mock only the transport and neighboring write services. The real commit
// service snapshots staged rows, calls the RPC, and chooses relationship writes.
function installTransport(
  stagedRows: StagedImportRow[],
  facilityIds = ["facility-2", "facility-3", "facility-4", "facility-5"],
) {
  const writes: CapturedWrite[] = [];
  mocks.from.mockImplementation((table: string) => {
    let ids: string[] | undefined;
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      in: (_column: string, values: string[]) => {
        ids = values;
        return builder;
      },
      upsert: (payload: unknown) => {
        writes.push({ table, payload });
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: (value: { data: unknown; error: null }) => unknown) => {
        const tables: Record<string, unknown> = {
          import_rows: stagedRows,
          providers: [
            { id: "provider-1", npi: NPI },
            { id: "provider-2", npi: OTHER_NPI },
          ].filter((p) => !ids || ids.includes(p.id)),
          provider_groups: GROUPS,
          facilities: facilityIds.map((id) => ({ id })),
        };
        if (!(table in tables)) throw new Error(`Unexpected table read: ${table}`);
        return Promise.resolve({ data: tables[table], error: null }).then(resolve);
      },
    };
    return builder;
  });
  return writes;
}

function relationshipRow(
  line: number,
  groupIndex: number,
  state: string,
  npi = NPI,
): StagedImportRow {
  return {
    line,
    mapped: {
      npi,
      group_tin: GROUPS[groupIndex].tin,
      facility_id: `facility-${line}`,
      enrollment_payer_id: "payer-1",
      enrollment_state: state,
      enrollment_effective_date: "2026-01-01",
    },
  };
}

function updatePlan(blockedLines: number[] = []): CommitPlan {
  return {
    creates: [],
    updates: [
      {
        line: 2,
        provider_id: "provider-1",
        set: { specialty: "Physical Therapy" },
        add_group_ids: [],
        add_facility_ids: [],
        license_inserts: [],
        license_updates: [],
      },
    ],
    skipped_count: 0,
    blocked_entries: blockedLines.map((line) => ({
      line,
      column: "npi",
      reason: "Provider identity requires manual review",
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({
    data: { updated: 1, updated_provider_ids: ["provider-1"] },
    error: null,
  });
  mocks.listEnrollmentFacts.mockResolvedValue([]);
  mocks.createEnrollmentFact.mockResolvedValue({ id: "fact-1" });
  mocks.insertAssignmentRows.mockResolvedValue(undefined);
  mocks.ensureFirstFacilityPrimary.mockResolvedValue(undefined);
});

describe("commitImportRun — P02 reviewed source-row boundary", () => {
  it("excludes every blocked same-NPI row from relationship writes while safe providers commit", async () => {
    const writes = installTransport([
      relationshipRow(2, 0, "CO"),
      relationshipRow(3, 1, "UT"),
      relationshipRow(4, 2, "AZ"),
      relationshipRow(5, 2, "AZ", OTHER_NPI),
    ]);
    const plan = updatePlan([3, 4]);
    plan.updates.push({ ...plan.updates[0], line: 5, provider_id: "provider-2" });
    mocks.rpc.mockResolvedValue({
      data: { updated: 2, updated_provider_ids: ["provider-1", "provider-2"] },
      error: null,
    });

    const result = await commitImportRun("run-1", plan);

    expect(mocks.rpc).toHaveBeenCalledWith("commit_import_run", {
      p_run_id: "run-1",
      p_plan: plan,
    });
    expect(result.updatedProviderIds).toEqual(["provider-1", "provider-2"]);
    expect(mocks.insertAssignmentRows).toHaveBeenCalledOnce();
    expect(mocks.insertAssignmentRows).toHaveBeenCalledWith([
      { providerId: "provider-1", facilityId: "facility-2", startDate: expect.any(String) },
      { providerId: "provider-2", facilityId: "facility-5", startDate: expect.any(String) },
    ]);
    expect(writes).toEqual([
      {
        table: "provider_group_assignments",
        payload: [
          { org_id: "org-1", provider_id: "provider-1", group_id: "group-1", is_primary: false },
          { org_id: "org-1", provider_id: "provider-2", group_id: "group-3", is_primary: false },
        ],
      },
    ]);
    expect(mocks.createEnrollmentFact.mock.calls.map(([input]) => input)).toEqual([
      {
        providerId: "provider-1",
        groupId: "group-1",
        payerId: "payer-1",
        state: "CO",
        effectiveDate: "2026-01-01",
      },
      {
        providerId: "provider-2",
        groupId: "group-3",
        payerId: "payer-1",
        state: "AZ",
        effectiveDate: "2026-01-01",
      },
    ]);
    expect(result.relationships).toEqual({
      facilityAssignments: 2,
      groupAssignments: 2,
      enrollmentFacts: 2,
    });
  });

  it("writes no relationships when every relationship source line is blocked", async () => {
    const writes = installTransport([
      { line: 2, mapped: { npi: NPI, specialty: "Physical Therapy" } },
      relationshipRow(3, 0, "CO"),
      relationshipRow(4, 1, "UT"),
    ]);

    const result = await commitImportRun("run-1", updatePlan([3, 4]));

    expect(result.updated).toBe(1);
    expect(writes).toEqual([]);
    expect(mocks.insertAssignmentRows).not.toHaveBeenCalled();
    expect(mocks.createEnrollmentFact).not.toHaveBeenCalled();
    expect(result.relationships).toEqual({
      facilityAssignments: 0,
      groupAssignments: 0,
      enrollmentFacts: 0,
    });
  });

  it("preserves one provider across three groups, three states, and three license rows", async () => {
    const writes = installTransport([
      relationshipRow(2, 0, "CO"),
      relationshipRow(3, 1, "UT"),
      relationshipRow(4, 2, "AZ"),
    ]);
    const plan = updatePlan();
    plan.updates[0].add_group_ids = ["group-1", "group-2", "group-3"];
    plan.updates[0].license_inserts = ["CO", "UT", "AZ"].map((state) => ({
      state,
      license_number: `${state}-100`,
      license_type: null,
      issue_date: null,
      expiration_date: null,
    }));

    const result = await commitImportRun("run-1", plan);

    expect(mocks.rpc).toHaveBeenCalledWith("commit_import_run", {
      p_run_id: "run-1",
      p_plan: plan,
    });
    expect(result.updatedProviderIds).toEqual(["provider-1"]);
    expect(result.relationships).toEqual({
      facilityAssignments: 3,
      groupAssignments: 3,
      enrollmentFacts: 3,
    });
    expect(mocks.insertAssignmentRows).toHaveBeenCalledWith([
      { providerId: "provider-1", facilityId: "facility-2", startDate: expect.any(String) },
      { providerId: "provider-1", facilityId: "facility-3", startDate: expect.any(String) },
      { providerId: "provider-1", facilityId: "facility-4", startDate: expect.any(String) },
    ]);
    expect(writes[0]?.payload).toEqual([
      { org_id: "org-1", provider_id: "provider-1", group_id: "group-1", is_primary: false },
      { org_id: "org-1", provider_id: "provider-1", group_id: "group-2", is_primary: false },
      { org_id: "org-1", provider_id: "provider-1", group_id: "group-3", is_primary: false },
    ]);
    expect(mocks.createEnrollmentFact.mock.calls.map(([input]) => input.state)).toEqual([
      "CO",
      "UT",
      "AZ",
    ]);
  });

  it("prunes a deleted facility while preserving live assignments and enrollment facts", async () => {
    installTransport([relationshipRow(2, 0, "CO"), relationshipRow(3, 1, "UT")], ["facility-2"]);

    const result = await commitImportRun("run-1", updatePlan());

    expect(mocks.insertAssignmentRows).toHaveBeenCalledWith([
      { providerId: "provider-1", facilityId: "facility-2", startDate: expect.any(String) },
    ]);
    expect(result.relationships).toEqual({
      facilityAssignments: 1,
      groupAssignments: 2,
      enrollmentFacts: 2,
    });
  });

  it("retains the existing replay behavior without another relationship pass", async () => {
    const writes = installTransport([relationshipRow(2, 0, "CO")]);
    mocks.rpc.mockResolvedValue({
      data: { already_committed: true, updated_provider_ids: ["provider-1"] },
      error: null,
    });

    const result = await commitImportRun("run-1", updatePlan());

    expect(result.alreadyCommitted).toBe(true);
    expect(writes).toEqual([]);
    expect(mocks.insertAssignmentRows).not.toHaveBeenCalled();
    expect(mocks.createEnrollmentFact).not.toHaveBeenCalled();
    expect(mocks.ensureFirstFacilityPrimary).not.toHaveBeenCalled();
  });
});
