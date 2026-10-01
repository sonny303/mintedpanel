import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ContractSopAssignmentDetails } from "@/services/contractSopAssignments";

vi.mock("@/services/contractSopAssignments", () => ({ getContractSopAssignment: vi.fn() }));
vi.mock("@/services/portalFieldMaps", () => ({ resolveEffectivePortalMaps: vi.fn() }));

import { getContractSopAssignment } from "@/services/contractSopAssignments";
import { resolveEffectivePortalMaps } from "@/services/portalFieldMaps";
import {
  getContractFormContext,
  loadContractOwnerContext,
  validateContractOwnerSelection,
  type ContractOwnerContext,
  type ContractFormContextServiceCtx,
} from "./contractFormContext";

const CONTRACT_ID = "41414141-4242-4535-8686-797979797979";
const ASSIGNMENT_ID = "51515151-4242-4535-8686-797979797979";
const TEMPLATE_ID = "61616161-4242-4535-8686-797979797979";
const PROVIDER_ID = "71717171-4242-4535-8686-797979797979";
const FACILITY_ID = "81818181-4242-4535-8686-797979797979";
const GROUP_ID = "91919191-4242-4535-8686-797979797979";
const PAYER_ID = "a1a1a1a1-4242-4535-8686-797979797979";

function ctxFor(db: unknown): ContractFormContextServiceCtx {
  return { db: db as SupabaseClient<Database>, orgId: "org-1" };
}

function assignmentDetails(
  taskDefinitions: unknown[] = [
    {
      title: "Contract packet",
      steps: [
        { label: "Page one", stepType: "online_form", portalKey: "payer_contract_key" },
        { label: "Page two", stepType: "online_form", portalKey: "payer_contract_key" },
      ],
    },
  ],
): ContractSopAssignmentDetails {
  return {
    assignment: {
      id: ASSIGNMENT_ID,
      orgId: "org-1",
      contractId: CONTRACT_ID,
      sopTemplateId: TEMPLATE_ID,
      sopVersion: 4,
      contextVersion: 7,
      createdBy: "actor-1",
      updatedBy: "actor-1",
      createdAt: "2026-10-01T12:00:00.000Z",
      updatedAt: "2026-10-01T12:00:00.000Z",
    },
    version: {
      templateId: TEMPLATE_ID,
      version: 4,
      name: "Contract SOP",
      caseType: "contract",
      taskDefinitions: taskDefinitions as never,
      requiredProfileAttributes: ["group.contractingContactEmail"],
    },
    hasRecordedActivity: false,
  };
}

function makeDb(
  rows: Record<string, Array<{ data: unknown; error?: unknown }>>,
  captures: Array<{ table: string; filters: Array<[string, unknown]> }> = [],
) {
  const cursors = new Map<string, number>();
  const db = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      captures.push({ table, filters });
      const index = cursors.get(table) ?? 0;
      cursors.set(table, index + 1);
      const result = rows[table]?.[index] ?? rows[table]?.at(-1) ?? { data: null };
      const builder: Record<string, unknown> = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return builder;
        },
        or(value: string) {
          filters.push(["or", value]);
          return builder;
        },
        maybeSingle: () => Promise.resolve(result),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject),
      };
      return builder;
    },
  };
  return { db, captures };
}

function ownerRows() {
  return {
    contracts: [{ data: { id: CONTRACT_ID, group_id: GROUP_ID, payer_id: PAYER_ID, state: "KS" } }],
    provider_groups: [{ data: { id: GROUP_ID, name: "Selected group" } }],
    payers: [{ data: { id: PAYER_ID } }],
  };
}

const effectiveConfiguration = {
  portalId: "portal-contract",
  portalKey: "payer_contract_key",
  ownerScope: "organization",
  ownerOrgId: "org-1",
  caseType: "contract",
  formUrl: "https://payer.example.test/form",
  payerId: PAYER_ID,
  requiresExplicitSelection: true,
  mappingGeneration: 2,
  effectiveMappingFingerprint: "sha256:contract-map",
  maps: [{ token: "provider.firstName", selector: "#name" }],
  activeFieldCount: 1,
  isVerified: true,
  isReady: true,
  status: "ready",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getContractSopAssignment).mockResolvedValue(assignmentDetails());
  vi.mocked(resolveEffectivePortalMaps).mockResolvedValue(effectiveConfiguration as never);
});

describe("Contract form context service", () => {
  it("org-scopes the owner, resolves the immutable assignment, and distinguishes same-config steps", async () => {
    const captures: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
    const { db } = makeDb(ownerRows(), captures);

    const result = await loadContractOwnerContext(ctxFor(db), CONTRACT_ID);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.context.contract).toMatchObject({
      id: CONTRACT_ID,
      groupId: GROUP_ID,
      payerId: PAYER_ID,
      state: "KS",
      groupName: "Selected group",
    });
    expect(result.context.assignment).toMatchObject({ id: ASSIGNMENT_ID, contextVersion: 7 });
    expect(result.context.sop).toMatchObject({
      templateId: TEMPLATE_ID,
      version: 4,
      caseType: "contract",
    });
    expect(result.context.steps).toHaveLength(2);
    expect(result.context.steps[0].portalKey).toBe(result.context.steps[1].portalKey);
    expect(result.context.steps[0].stepIdentity).not.toBe(result.context.steps[1].stepIdentity);
    expect(result.context.steps.map((step) => step.stepIdentity)).toEqual([
      `${CONTRACT_ID}:org-1:${ASSIGNMENT_ID}:7:${TEMPLATE_ID}:4:0:0`,
      `${CONTRACT_ID}:org-1:${ASSIGNMENT_ID}:7:${TEMPLATE_ID}:4:0:1`,
    ]);
    expect(captures[0]).toMatchObject({
      table: "contracts",
      filters: [
        ["id", CONTRACT_ID],
        ["org_id", "org-1"],
      ],
    });
    expect(captures.find((capture) => capture.table === "provider_groups")?.filters).toContainEqual(
      ["org_id", "org-1"],
    );
    expect(captures.find((capture) => capture.table === "payers")?.filters).toContainEqual([
      "or",
      "org_id.is.null,org_id.eq.org-1",
    ]);
  });

  it("returns not-found before reading related rows for a cross-org Contract", async () => {
    const { db, captures } = makeDb({ contracts: [{ data: null }] });

    expect(await loadContractOwnerContext(ctxFor(db), CONTRACT_ID)).toEqual({ kind: "not_found" });
    expect(captures).toHaveLength(1);
    expect(captures[0].filters).toContainEqual(["org_id", "org-1"]);
    expect(getContractSopAssignment).not.toHaveBeenCalled();
  });

  it("keeps same-org Contract references scoped to the caller's group and payer", async () => {
    const { db: foreignGroupDb, captures: groupCaptures } = makeDb({
      ...ownerRows(),
      provider_groups: [{ data: null }],
    });
    expect(await loadContractOwnerContext(ctxFor(foreignGroupDb), CONTRACT_ID)).toMatchObject({
      kind: "mismatch",
    });
    expect(
      groupCaptures.find((capture) => capture.table === "provider_groups")?.filters,
    ).toContainEqual(["org_id", "org-1"]);
    expect(getContractSopAssignment).not.toHaveBeenCalled();

    const { db: foreignPayerDb, captures: payerCaptures } = makeDb({
      ...ownerRows(),
      payers: [{ data: null }],
    });
    expect(await loadContractOwnerContext(ctxFor(foreignPayerDb), CONTRACT_ID)).toMatchObject({
      kind: "mismatch",
    });
    expect(payerCaptures.find((capture) => capture.table === "payers")?.filters).toContainEqual([
      "or",
      "org_id.is.null,org_id.eq.org-1",
    ]);
    expect(getContractSopAssignment).not.toHaveBeenCalled();
  });

  it("rejects incomplete owner context, wrong SOP type, and stale assignment/version tuples", async () => {
    const { db: incompleteDb } = makeDb({
      ...ownerRows(),
      contracts: [{ data: { id: CONTRACT_ID, group_id: null, payer_id: PAYER_ID, state: "KS" } }],
    });
    expect(await loadContractOwnerContext(ctxFor(incompleteDb), CONTRACT_ID)).toMatchObject({
      kind: "not_configured",
    });

    const { db } = makeDb(ownerRows());
    expect(
      await loadContractOwnerContext(ctxFor(db), CONTRACT_ID, { assignmentId: "wrong-assignment" }),
    ).toMatchObject({ kind: "stale" });
    expect(
      await loadContractOwnerContext(ctxFor(db), CONTRACT_ID, { sopVersion: 3 }),
    ).toMatchObject({ kind: "stale" });
    expect(
      await loadContractOwnerContext(ctxFor(db), CONTRACT_ID, {
        stepIdentity: `${CONTRACT_ID}:wrong-step`,
      }),
    ).toMatchObject({ kind: "mismatch" });

    vi.mocked(getContractSopAssignment).mockResolvedValue({
      ...assignmentDetails(),
      version: { ...assignmentDetails().version, caseType: "enrollment" },
    });
    expect(await loadContractOwnerContext(ctxFor(db), CONTRACT_ID)).toMatchObject({
      kind: "mismatch",
    });
  });

  it("requires active membership in the Contract group and an assigned same-group, same-state facility", async () => {
    const owner: ContractOwnerContext = {
      contract: {
        id: CONTRACT_ID,
        groupId: GROUP_ID,
        payerId: PAYER_ID,
        state: "KS",
        groupName: "G",
      },
      assignment: assignmentDetails().assignment,
      sop: { templateId: TEMPLATE_ID, version: 4, name: "SOP", caseType: "contract" },
      steps: [],
      hasRecordedActivity: false,
    };

    const { db: unassignedDb, captures: unassignedCaptures } = makeDb({
      providers: [{ data: { id: PROVIDER_ID, status: "active" } }],
      provider_group_assignments: [{ data: null }],
    });
    expect(
      await validateContractOwnerSelection(ctxFor(unassignedDb), owner, PROVIDER_ID),
    ).toMatchObject({ kind: "mismatch" });
    expect(unassignedCaptures[1].filters).toEqual([
      ["org_id", "org-1"],
      ["group_id", GROUP_ID],
      ["provider_id", PROVIDER_ID],
    ]);
    expect(unassignedCaptures[0].filters).toEqual([
      ["id", PROVIDER_ID],
      ["org_id", "org-1"],
    ]);

    const validGroupAssignment = {
      data: { provider_id: PROVIDER_ID, start_date: null, end_date: null },
    };
    const { db: wrongGroupDb } = makeDb({
      providers: [{ data: { id: PROVIDER_ID, status: "active" } }],
      provider_group_assignments: [validGroupAssignment],
      provider_facility_assignments: [{ data: { facility_id: FACILITY_ID, start_date: null } }],
      facilities: [{ data: { id: FACILITY_ID, group_id: "other-group", state: "KS" } }],
    });
    expect(
      await validateContractOwnerSelection(ctxFor(wrongGroupDb), owner, PROVIDER_ID, FACILITY_ID),
    ).toMatchObject({ kind: "mismatch" });

    const { db: wrongStateDb } = makeDb({
      providers: [{ data: { id: PROVIDER_ID, status: "active" } }],
      provider_group_assignments: [validGroupAssignment],
      provider_facility_assignments: [{ data: { facility_id: FACILITY_ID, start_date: null } }],
      facilities: [{ data: { id: FACILITY_ID, group_id: GROUP_ID, state: "MO" } }],
    });
    expect(
      await validateContractOwnerSelection(ctxFor(wrongStateDb), owner, PROVIDER_ID, FACILITY_ID),
    ).toMatchObject({ kind: "mismatch" });

    const futureStartDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const { db: futureFacilityDb, captures: futureCaptures } = makeDb({
      providers: [{ data: { id: PROVIDER_ID, status: "active" } }],
      provider_group_assignments: [validGroupAssignment],
      provider_facility_assignments: [
        { data: { facility_id: FACILITY_ID, start_date: futureStartDate } },
      ],
      facilities: [{ data: { id: FACILITY_ID, group_id: GROUP_ID, state: "KS" } }],
    });
    expect(
      await validateContractOwnerSelection(
        ctxFor(futureFacilityDb),
        owner,
        PROVIDER_ID,
        FACILITY_ID,
      ),
    ).toMatchObject({ kind: "mismatch" });
    expect(futureCaptures.some((capture) => capture.table === "facilities")).toBe(false);

    const { db: correctDb } = makeDb({
      providers: [{ data: { id: PROVIDER_ID, status: "active" } }],
      provider_group_assignments: [validGroupAssignment],
      provider_facility_assignments: [{ data: { facility_id: FACILITY_ID, start_date: null } }],
      facilities: [{ data: { id: FACILITY_ID, group_id: GROUP_ID, state: "KS" } }],
    });
    expect(
      await validateContractOwnerSelection(ctxFor(correctDb), owner, PROVIDER_ID, FACILITY_ID),
    ).toEqual({ kind: "ok", providerId: PROVIDER_ID, facilityId: FACILITY_ID });
  });

  it("does not resolve a foreign-org or unrelated facility selection", async () => {
    const owner: ContractOwnerContext = {
      contract: {
        id: CONTRACT_ID,
        groupId: GROUP_ID,
        payerId: PAYER_ID,
        state: "KS",
        groupName: "G",
      },
      assignment: assignmentDetails().assignment,
      sop: { templateId: TEMPLATE_ID, version: 4, name: "SOP", caseType: "contract" },
      steps: [],
      hasRecordedActivity: false,
    };
    const { db, captures } = makeDb({
      providers: [{ data: { id: PROVIDER_ID, status: "active" } }],
      provider_group_assignments: [
        { data: { provider_id: PROVIDER_ID, start_date: null, end_date: null } },
      ],
      provider_facility_assignments: [{ data: null }],
    });

    expect(
      await validateContractOwnerSelection(ctxFor(db), owner, PROVIDER_ID, FACILITY_ID),
    ).toMatchObject({ kind: "mismatch" });
    expect(
      captures.find((capture) => capture.table === "provider_facility_assignments")?.filters,
    ).toContainEqual(["org_id", "org-1"]);
    expect(captures.some((capture) => capture.table === "facilities")).toBe(false);
  });

  it("returns current launch tuples without exposing maps, and keeps an unselected provider manual", async () => {
    const rows = {
      ...ownerRows(),
      providers: [{ data: { id: PROVIDER_ID, status: "active" } }],
      provider_group_assignments: [
        { data: { provider_id: PROVIDER_ID, start_date: null, end_date: null } },
      ],
    };
    const { db } = makeDb(rows);

    const ready = await getContractFormContext(ctxFor(db), CONTRACT_ID, {
      providerId: PROVIDER_ID,
    });

    expect(ready.kind).toBe("ok");
    if (ready.kind === "ok") {
      expect(ready.context.steps).toHaveLength(2);
      expect(ready.context.steps.map((step) => step.stepIdentity)).toEqual([
        `${CONTRACT_ID}:org-1:${ASSIGNMENT_ID}:7:${TEMPLATE_ID}:4:0:0`,
        `${CONTRACT_ID}:org-1:${ASSIGNMENT_ID}:7:${TEMPLATE_ID}:4:0:1`,
      ]);
      expect(ready.context.steps[0].launch.readiness.outcome).toBe("ready_handoff_deferred");
      expect(JSON.stringify(ready)).not.toContain("#name");
    }
    expect(resolveEffectivePortalMaps).toHaveBeenCalledTimes(1);
    expect(resolveEffectivePortalMaps).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
      { portalKey: "payer_contract_key", mapType: "web" },
    );

    vi.mocked(getContractSopAssignment).mockResolvedValue(assignmentDetails());
    const { db: noProviderDb } = makeDb(ownerRows());
    const noProvider = await getContractFormContext(ctxFor(noProviderDb), CONTRACT_ID);
    expect(noProvider.kind).toBe("ok");
    if (noProvider.kind === "ok") {
      expect(noProvider.context.selectedProviderId).toBeNull();
      expect(noProvider.context.steps[0].launch.readiness.outcome).toBe("provider_required");
    }
  });
});
