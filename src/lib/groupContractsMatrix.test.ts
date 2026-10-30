import { describe, expect, it } from "vitest";
import {
  CONTRACT_STATUS_SHORT_LABELS,
  MATRIX_STATUS_ORDER,
  NO_RECORD_FILTER,
  buildContractsMatrix,
  contractDateLine,
  contractStatusDisplay,
  locateMatrixCell,
  payerServesState,
  specialtiesShowingContract,
  type ContractsMatrix,
  type ContractsMatrixCell,
  type ContractsMatrixContract,
  type ContractsMatrixGroupAssignmentInput,
  type ContractsMatrixGroupInput,
  type ContractsMatrixInput,
  type ContractsMatrixOptions,
  type ContractsMatrixPayerInput,
  type ContractsMatrixProviderInput,
  type ContractsMatrixTable,
  type ContractsMatrixTargetInput,
} from "./groupContractsMatrix";
import type {
  FootprintFacilityAssignmentInput,
  FootprintFacilityInput,
  FootprintLicenseInput,
} from "./providerFootprint";
import {
  APPLICATION_SUBMITTED_LABEL,
  CONTRACT_SIGNED_LABEL,
  DENIED_APPEALED_LABEL,
  DENIED_LABEL,
  DENIED_REAPPLIED_LABEL,
  IN_NETWORK_LABEL,
  NOT_STARTED_LABEL,
  OON_LABEL,
  OUT_OF_NETWORK_LABEL,
  PRE_CRED_PAYER_NAME,
} from "./statusLabels";
import type { ContractSpecialty } from "./contractSpecialty";
import type { ContractSpecialtyKey, ContractingStatusLabel } from "@/types";

const TODAY = "2026-10-29";
const PT_CODE = "225100000X";
const DIETITIAN_CODE = "133V00000X";
const OT_CODE = "225X00000X";

const STATUS_IDS: Record<ContractingStatusLabel, string> = {
  [NOT_STARTED_LABEL]: "st-not-started",
  [APPLICATION_SUBMITTED_LABEL]: "st-submitted",
  [CONTRACT_SIGNED_LABEL]: "st-signed",
  [IN_NETWORK_LABEL]: "st-in-network",
  [DENIED_LABEL]: "st-denied",
  [DENIED_APPEALED_LABEL]: "st-appealed",
  [DENIED_REAPPLIED_LABEL]: "st-reapplied",
  [OUT_OF_NETWORK_LABEL]: "st-oon",
};
const LEGACY_OON_ID = "st-legacy-oon";

type TestContract = ContractsMatrixContract;

interface ContractExtra {
  id?: string;
  specialtyKey?: ContractSpecialtyKey;
  effectiveDate?: string;
  tentativeEffectiveDate?: string;
  notes?: string;
  contractingStatusId?: string | null;
}

/** A small org builder: groups, payers, staffed clinics, targets, records. */
function world() {
  const groups: ContractsMatrixGroupInput[] = [];
  const payers: ContractsMatrixPayerInput[] = [];
  const contracts: TestContract[] = [];
  const targets: ContractsMatrixTargetInput[] = [];
  const facilities: FootprintFacilityInput[] = [];
  const facilityAssignments: FootprintFacilityAssignmentInput[] = [];
  const licenses: FootprintLicenseInput[] = [];
  const providers: ContractsMatrixProviderInput[] = [];
  const groupAssignments: ContractsMatrixGroupAssignmentInput[] = [];
  const input: ContractsMatrixInput<TestContract> = {
    today: TODAY,
    groups,
    payers,
    contracts,
    targets,
    statuses: [
      ...Object.entries(STATUS_IDS).map(([label, id]) => ({ id, label })),
      { id: LEGACY_OON_ID, label: OON_LABEL },
    ],
    facilities,
    facilityAssignments,
    licenses,
    providers,
    groupAssignments,
  };
  let seq = 0;
  const facilityFor = (groupId: string, state: string, isActive: boolean) => {
    const id = `f-${groupId}-${state}-${isActive ? "on" : "off"}`;
    if (!facilities.some((f) => f.id === id)) facilities.push({ id, groupId, state, isActive });
    return id;
  };
  const api = {
    input,
    group(id: string, name: string, isActive = true) {
      groups.push({ id, name, tin: `TIN-${id}`, isActive });
      return api;
    },
    payer(id: string, name: string, states: string[] | null, archivedAt: string | null = null) {
      payers.push({ id, name, states, archivedAt });
      return api;
    },
    provider(id: string, taxonomyCode: string, extra: Partial<ContractsMatrixProviderInput> = {}) {
      providers.push({
        id,
        taxonomyCode,
        status: "active",
        verificationState: "verified",
        ...extra,
      });
      return api;
    },
    member(providerId: string, groupId: string, endDate: string | null = null) {
      groupAssignments.push({ providerId, groupId, endDate });
      return api;
    },
    clinic(providerId: string, groupId: string, state: string, isActive = true) {
      facilityAssignments.push({ providerId, facilityId: facilityFor(groupId, state, isActive) });
      return api;
    },
    license(providerId: string, state: string) {
      licenses.push({ providerId, state });
      return api;
    },
    /** A clinic of the group with nobody assigned to it. */
    facility(groupId: string, state: string) {
      facilityFor(groupId, state, true);
      return api;
    },
    /** One provider of `specialty` in the group, at an active clinic in each state. */
    staff(groupId: string, specialty: "pt" | "nutrition", states: string[]) {
      const providerId = `pr-${groupId}-${specialty}`;
      if (!providers.some((p) => p.id === providerId)) {
        api
          .provider(providerId, specialty === "pt" ? PT_CODE : DIETITIAN_CODE)
          .member(providerId, groupId);
      }
      for (const state of states) api.clinic(providerId, groupId, state);
      return api;
    },
    target(
      groupId: string,
      payerId: string,
      state: string,
      status: "active" | "archived" = "active",
    ) {
      targets.push({ groupId, payerId, state, status });
      return api;
    },
    record(
      groupId: string,
      payerId: string,
      state: string,
      label: ContractingStatusLabel | null,
      extra: ContractExtra = {},
    ) {
      seq += 1;
      const statusId = label ? STATUS_IDS[label] : null;
      contracts.push({
        id: extra.id ?? `c-${seq}`,
        groupId,
        payerId,
        state,
        specialtyKey: extra.specialtyKey ?? "pt",
        contractingStatusId:
          extra.contractingStatusId !== undefined ? extra.contractingStatusId : statusId,
        effectiveDate: extra.effectiveDate ?? null,
        tentativeEffectiveDate: extra.tentativeEffectiveDate ?? null,
        notes: extra.notes ?? null,
      });
      return api;
    },
  };
  return api;
}

function table(
  matrix: ContractsMatrix<TestContract>,
  specialty: ContractSpecialty,
): ContractsMatrixTable<TestContract> {
  const found = matrix.tables.find((t) => t.specialty === specialty);
  if (!found) throw new Error(`no ${specialty} table`);
  return found;
}

function cell(
  t: ContractsMatrixTable<TestContract>,
  payerName: string,
  groupId: string,
  state: string,
): ContractsMatrixCell<TestContract> {
  const row = t.rows.find((r) => r.payerName === payerName);
  if (!row) throw new Error(`no row ${payerName}`);
  const found = row.cells.find((c) => c.columnKey === `${groupId}|${state}`);
  if (!found) throw new Error(`no column ${groupId}|${state}`);
  return found;
}

function shortLabels(t: ContractsMatrixTable<TestContract>, payerName: string): string[] {
  const row = t.rows.find((r) => r.payerName === payerName);
  return (row?.cells ?? []).map((c) => (c.kind === "record" ? c.shortLabel : c.kind));
}

// ---------- the sketch: Group Name 1 (CO), Group Name 2 (KS, MO), Group Name 3 (TX) ----------

const SKETCH_STATES = ["CO", "KS", "MO", "TX"];

function sketch() {
  const w = world()
    .group("g1", "Group Name 1")
    .group("g2", "Group Name 2")
    .group("g3", "Group Name 3")
    .staff("g1", "pt", ["CO"])
    .staff("g2", "pt", ["KS", "MO"])
    .staff("g3", "pt", ["TX"]);
  for (let n = 1; n <= 6; n += 1)
    w.payer(`p${n}`, `Payer ${n}`, SKETCH_STATES).target("g2", `p${n}`, "KS");
  return w
    .record("g1", "p1", "CO", IN_NETWORK_LABEL, { effectiveDate: "2026-01-01" })
    .record("g2", "p1", "KS", IN_NETWORK_LABEL, { effectiveDate: "2026-03-01" })
    .record("g2", "p1", "MO", CONTRACT_SIGNED_LABEL, { tentativeEffectiveDate: "2026-12-01" })
    .record("g3", "p1", "TX", APPLICATION_SUBMITTED_LABEL)
    .record("g1", "p2", "CO", APPLICATION_SUBMITTED_LABEL)
    .record("g2", "p2", "MO", NOT_STARTED_LABEL)
    .record("g3", "p2", "TX", IN_NETWORK_LABEL, { effectiveDate: "2025-07-01" })
    .record("g1", "p3", "CO", DENIED_LABEL, {
      notes: "Panel closed for PT in this area. Reapply after Jan 1, 2027.",
    })
    .record("g2", "p3", "KS", DENIED_APPEALED_LABEL)
    .record("g2", "p3", "MO", APPLICATION_SUBMITTED_LABEL)
    .record("g3", "p3", "TX", OUT_OF_NETWORK_LABEL)
    .record("g1", "p4", "CO", IN_NETWORK_LABEL, { effectiveDate: "2025-10-01" })
    .record("g2", "p4", "KS", IN_NETWORK_LABEL, { effectiveDate: "2026-02-01" })
    .record("g2", "p4", "MO", IN_NETWORK_LABEL, { effectiveDate: "2026-02-01" })
    .record("g3", "p4", "TX", CONTRACT_SIGNED_LABEL, {
      tentativeEffectiveDate: "2027-01-01",
      notes: "Loads only after the Medicare enrollment is complete.",
    })
    .record("g1", "p5", "CO", DENIED_REAPPLIED_LABEL)
    .record("g2", "p5", "KS", APPLICATION_SUBMITTED_LABEL)
    .record("g2", "p6", "KS", CONTRACT_SIGNED_LABEL, { tentativeEffectiveDate: "2026-11-15" })
    .record("g2", "p6", "MO", APPLICATION_SUBMITTED_LABEL)
    .record("g3", "p6", "TX", IN_NETWORK_LABEL, { effectiveDate: "2026-02-01" });
}

function build(
  w: ReturnType<typeof world>,
  options: ContractsMatrixOptions = {},
): ContractsMatrix<TestContract> {
  return buildContractsMatrix(w.input, options);
}

describe("buildContractsMatrix — every group in one table (US-1, GCM-1 to 6)", () => {
  it("lays the groups side by side under one Physical therapy table", () => {
    const matrix = build(sketch());
    expect(matrix.tables.map((t) => t.specialty)).toEqual(["pt"]);
    const pt = table(matrix, "pt");
    expect(pt.headerSegments).toEqual([
      {
        kind: "group",
        key: "g1",
        groupId: "g1",
        groupName: "Group Name 1",
        groupTin: "TIN-g1",
        span: 1,
      },
      {
        kind: "group",
        key: "g2",
        groupId: "g2",
        groupName: "Group Name 2",
        groupTin: "TIN-g2",
        span: 2,
      },
      {
        kind: "group",
        key: "g3",
        groupId: "g3",
        groupName: "Group Name 3",
        groupTin: "TIN-g3",
        span: 1,
      },
    ]);
    expect(pt.columns.map((c) => c.headerLabel)).toEqual(["CO", "KS", "MO", "TX"]);
    expect(pt.columns.map((c) => c.segmentStart)).toEqual([true, true, false, true]);
    expect(pt.rows.map((r) => r.payerName)).toEqual([
      "Payer 1",
      "Payer 2",
      "Payer 3",
      "Payer 4",
      "Payer 5",
      "Payer 6",
    ]);
  });

  it("reads Payer 1 across every state in one row, with short labels and date lines", () => {
    const pt = table(build(sketch()), "pt");
    expect(shortLabels(pt, "Payer 1")).toEqual(["In network", "In network", "Signed", "Submitted"]);
    const row = pt.rows.find((r) => r.payerName === "Payer 1");
    expect(row?.cells.map((c) => (c.kind === "record" ? c.dateLine : null))).toEqual([
      "Eff Jan 1, 2026",
      "Eff Mar 1, 2026",
      "Tent Dec 1, 2026",
      null,
    ]);
    expect(shortLabels(pt, "Payer 2")).toEqual(["Submitted", "empty", "Not started", "In network"]);
  });

  it("labels every cell for assistive tech (GCM-23)", () => {
    const pt = table(build(sketch()), "pt");
    expect(cell(pt, "Payer 1", "g2", "MO").ariaLabel).toBe(
      "Payer 1, Physical therapy, Group Name 2, MO: In Progress (Contract Signed)",
    );
    expect(cell(pt, "Payer 2", "g2", "KS").ariaLabel).toBe(
      "Payer 2, Physical therapy, Group Name 2, KS: No contract record",
    );
  });

  it("counts records and in-network once for what is shown (GCM-1, GCM-18, GCM-28)", () => {
    const matrix = build(sketch());
    expect(matrix.counts).toEqual({
      groups: 3,
      specialties: 1,
      states: 4,
      payers: 6,
      records: 20,
      inNetwork: 7,
    });
    expect(table(matrix, "pt").counts).toEqual({
      groups: 3,
      states: 4,
      payers: 6,
      records: 20,
      inNetwork: 7,
    });
  });

  it("lists every note in one card, labelled and sorted by payer (GCM-19)", () => {
    const matrix = build(sketch());
    expect(matrix.notes.map((n) => [n.label, n.note])).toEqual([
      [
        "Payer 3 · Physical therapy · Group Name 1 · CO",
        "Panel closed for PT in this area. Reapply after Jan 1, 2027.",
      ],
      [
        "Payer 4 · Physical therapy · Group Name 3 · TX",
        "Loads only after the Medicare enrollment is complete.",
      ],
    ]);
    const denied = cell(table(matrix, "pt"), "Payer 3", "g1", "CO");
    expect(denied.kind === "record" && denied.hasNote).toBe(true);
  });

  it("rows are only payers we target or hold a record with; never the sentinel", () => {
    const w = sketch()
      .payer("untargeted", "Payer 0 Untargeted", SKETCH_STATES)
      .payer("recorded", "Payer 7 Recorded", SKETCH_STATES)
      .payer("archived-target", "Payer 8 Archived Target", SKETCH_STATES)
      .payer("precred", PRE_CRED_PAYER_NAME, SKETCH_STATES)
      .record("g3", "recorded", "TX", APPLICATION_SUBMITTED_LABEL)
      .target("g1", "archived-target", "CO", "archived")
      .target("g1", "precred", "CO")
      .record("g1", "precred", "CO", NOT_STARTED_LABEL);
    const matrix = build(w);
    const names = table(matrix, "pt").rows.map((r) => r.payerName);
    expect(names).toContain("Payer 7 Recorded");
    expect(names).not.toContain("Payer 0 Untargeted");
    expect(names).not.toContain("Payer 8 Archived Target");
    expect(names).not.toContain(PRE_CRED_PAYER_NAME);
    expect(matrix.addablePayers.map((p) => p.name)).not.toContain(PRE_CRED_PAYER_NAME);
  });
});

describe("filters (GCM-11 to 14, US-3)", () => {
  it("turning Group Name 1 off removes the CO column and keeps everything else", () => {
    const matrix = build(sketch(), { selectedGroupIds: ["g2", "g3"] });
    const pt = table(matrix, "pt");
    expect(pt.columns.map((c) => c.key)).toEqual(["g2|KS", "g2|MO", "g3|TX"]);
    expect(pt.rows).toHaveLength(6);
    expect(matrix.selectedGroupIds).toEqual(["g2", "g3"]);
  });

  it("Status = Signed leaves Payers 1, 4 and 6 and fades the other cells", () => {
    const matrix = build(sketch(), { statusFilter: CONTRACT_SIGNED_LABEL });
    const pt = table(matrix, "pt");
    expect(pt.rows.map((r) => r.payerName)).toEqual(["Payer 1", "Payer 4", "Payer 6"]);
    expect(cell(pt, "Payer 1", "g2", "MO").dimmed).toBe(false);
    expect(cell(pt, "Payer 1", "g1", "CO").dimmed).toBe(true);
    expect(cell(pt, "Payer 6", "g1", "CO").dimmed).toBe(true);
    // Columns never depend on the status filter.
    expect(pt.columns).toHaveLength(4);
    // Counts cover the cells still on screen, faded ones included.
    expect(matrix.counts.records).toBe(11);
    expect(matrix.counts.payers).toBe(3);
  });

  it("Status = No record keeps payers with an empty cell", () => {
    const pt = table(build(sketch(), { statusFilter: NO_RECORD_FILTER }), "pt");
    expect(pt.rows.map((r) => r.payerName)).toEqual(["Payer 2", "Payer 5", "Payer 6"]);
    expect(cell(pt, "Payer 2", "g2", "KS").dimmed).toBe(false);
    expect(cell(pt, "Payer 2", "g1", "CO").dimmed).toBe(true);
  });

  it("payer search matches the name, case-insensitively", () => {
    const pt = table(build(sketch(), { payerSearch: "  PAYER 4 " }), "pt");
    expect(pt.rows.map((r) => r.payerName)).toEqual(["Payer 4"]);
    expect(pt.columns).toHaveLength(4);
  });

  it("the States filter removes other states' columns from every table", () => {
    const matrix = build(sketch(), { selectedStates: ["ks", "MO"] });
    expect(matrix.stateOptions).toEqual(SKETCH_STATES);
    expect(table(matrix, "pt").columns.map((c) => c.key)).toEqual(["g2|KS", "g2|MO"]);
    expect(matrix.counts.groups).toBe(1);
    // A filter that removes every column leaves no table.
    expect(build(sketch(), { selectedStates: ["NE"] }).tables).toEqual([]);
  });

  it("with every group off there are no tables", () => {
    const matrix = build(sketch(), { selectedGroupIds: [] });
    expect(matrix.selectedGroupIds).toEqual([]);
    expect(matrix.tables).toEqual([]);
    expect(matrix.groupsWithoutColumns).toEqual([]);
  });
});

describe("arrangement (GCM-15, US-4)", () => {
  it("By state puts the state on top and the groups under it, same cells", () => {
    const w = sketch().staff("g3", "pt", ["CO"]);
    const byGroup = table(build(w), "pt");
    const byState = table(build(w, { arrange: "state" }), "pt");
    expect(byState.headerSegments).toEqual([
      { kind: "state", key: "CO", state: "CO", groupCount: 2, span: 2 },
      { kind: "state", key: "KS", state: "KS", groupCount: 1, span: 1 },
      { kind: "state", key: "MO", state: "MO", groupCount: 1, span: 1 },
      { kind: "state", key: "TX", state: "TX", groupCount: 1, span: 1 },
    ]);
    expect(byState.columns.map((c) => c.headerLabel)).toEqual([
      "Group Name 1",
      "Group Name 3",
      "Group Name 2",
      "Group Name 2",
      "Group Name 3",
    ]);
    expect(byState.columns.map((c) => c.segmentStart)).toEqual([true, false, true, true, true]);
    expect(byGroup.columns.map((c) => c.key)).toEqual([
      "g1|CO",
      "g2|KS",
      "g2|MO",
      "g3|CO",
      "g3|TX",
    ]);

    const cellsByKey = (t: ContractsMatrixTable<TestContract>) =>
      Object.fromEntries(
        t.rows.flatMap((r) => r.cells.map((c) => [`${r.payerId}|${c.columnKey}`, c])),
      );
    expect(cellsByKey(byState)).toEqual(cellsByKey(byGroup));
  });
});

// ---------- specialties: PT in CO, KS, LA, MO, NE, NM; Nutrition in KS, MO, NE ----------

const SPECIALTY_STATES = ["CO", "KS", "LA", "MO", "NE", "NM"];

function specialties() {
  const w = world()
    .group("g1", "Group Name 1")
    .group("g2", "Group Name 2")
    .group("g3", "Group Name 3")
    .staff("g1", "pt", ["CO", "NM"])
    .staff("g2", "pt", ["KS", "MO"])
    .staff("g3", "pt", ["LA", "NE"])
    .staff("g2", "nutrition", ["KS", "MO"])
    .staff("g3", "nutrition", ["NE"]);
  for (let n = 1; n <= 5; n += 1) {
    w.payer(`p${n}`, `Payer ${n}`, SPECIALTY_STATES).target("g2", `p${n}`, "KS");
  }
  return w
    .record("g2", "p1", "KS", IN_NETWORK_LABEL, {
      id: "p1-ks-all",
      specialtyKey: "all",
      effectiveDate: "2026-03-01",
    })
    .record("g2", "p2", "KS", IN_NETWORK_LABEL, { id: "p2-ks-pt", effectiveDate: "2026-02-01" })
    .record("g2", "p2", "KS", DENIED_LABEL, {
      id: "p2-ks-nutrition",
      specialtyKey: "nutrition",
      notes: "Does not contract dietitians in KS. Recheck at the 2027 renewal.",
    })
    .record("g1", "p3", "NM", DENIED_LABEL, {
      id: "p3-nm-pt",
      notes: "Panel closed for PT in this area. Reapply after Jan 1, 2027.",
    })
    .record("g2", "p3", "MO", APPLICATION_SUBMITTED_LABEL, {
      id: "p3-mo-all",
      specialtyKey: "all",
      notes: "One agreement for every specialty.",
    })
    .record("g2", "p4", "KS", IN_NETWORK_LABEL, {
      id: "p4-ks-all",
      specialtyKey: "all",
      effectiveDate: "2026-02-01",
    });
}

describe("one table per specialty (US-12 to US-15, GCM-28 to 36)", () => {
  it("gives each specialty its own columns from its providers' footprint", () => {
    const matrix = build(specialties());
    expect(matrix.tables.map((t) => [t.specialty, t.label])).toEqual([
      ["pt", "Physical therapy"],
      ["nutrition", "Nutrition"],
    ]);
    expect(table(matrix, "pt").columns.map((c) => c.key)).toEqual([
      "g1|CO",
      "g1|NM",
      "g2|KS",
      "g2|MO",
      "g3|LA",
      "g3|NE",
    ]);
    expect(table(matrix, "nutrition").columns.map((c) => c.key)).toEqual([
      "g2|KS",
      "g2|MO",
      "g3|NE",
    ]);
    expect(matrix.stateOptions).toEqual(SPECIALTY_STATES);
  });

  it("holds a different status per specialty in the same group and state (US-13)", () => {
    const matrix = build(specialties());
    const ptCell = cell(table(matrix, "pt"), "Payer 2", "g2", "KS");
    const nutritionCell = cell(table(matrix, "nutrition"), "Payer 2", "g2", "KS");
    expect(ptCell).toMatchObject({ kind: "record", shortLabel: "In network", shared: false });
    expect(nutritionCell).toMatchObject({ kind: "record", shortLabel: "Denied", shared: false });
    expect(nutritionCell.ariaLabel).toBe("Payer 2, Nutrition, Group Name 2, KS: Denied");
  });

  it("shows one all-specialties record in both tables, tagged shared, counted once (US-14)", () => {
    const matrix = build(specialties());
    const pt = cell(table(matrix, "pt"), "Payer 1", "g2", "KS");
    const nutrition = cell(table(matrix, "nutrition"), "Payer 1", "g2", "KS");
    for (const shared of [pt, nutrition]) {
      expect(shared).toMatchObject({ kind: "record", shared: true, shortLabel: "In network" });
      expect(shared.kind === "record" && shared.contract.id).toBe("p1-ks-all");
    }
    expect(nutrition.ariaLabel).toBe(
      "Payer 1, Nutrition, Group Name 2, KS: In-Network (All specialties)",
    );
    expect(table(matrix, "pt").counts).toMatchObject({ records: 5, inNetwork: 3 });
    expect(table(matrix, "nutrition").counts).toMatchObject({ records: 4, inNetwork: 2 });
    expect(matrix.counts).toEqual({
      groups: 3,
      specialties: 2,
      states: 6,
      payers: 5,
      records: 6,
      inNetwork: 3,
    });
  });

  it("labels notes with the specialty and lists a shared record once (GCM-34)", () => {
    const matrix = build(specialties());
    expect(matrix.notes.map((n) => n.label)).toEqual([
      "Payer 2 · Nutrition · Group Name 2 · KS",
      "Payer 3 · All specialties · Group Name 2 · MO",
      "Payer 3 · Physical therapy · Group Name 1 · NM",
    ]);
    expect(matrix.notes[1]).toMatchObject({ shared: true, specialtyKey: "all" });
  });

  it("the Specialties chips choose which tables show; the others stay as they were", () => {
    const all = build(specialties());
    const ptOnly = build(specialties(), { specialties: ["pt"] });
    expect(ptOnly.tables.map((t) => t.specialty)).toEqual(["pt"]);
    expect(table(ptOnly, "pt")).toEqual(table(all, "pt"));
    expect(ptOnly.stateOptions).toEqual(SPECIALTY_STATES);
    expect(build(specialties(), { specialties: ["nutrition"] }).stateOptions).toEqual([
      "KS",
      "MO",
      "NE",
    ]);
  });

  it("a specialty's own record adds its column to that table only", () => {
    const w = specialties()
      .record("g1", "p5", "CO", NOT_STARTED_LABEL, { id: "p5-co-nut", specialtyKey: "nutrition" })
      .record("g1", "p5", "NM", IN_NETWORK_LABEL, { id: "p5-nm-ot", specialtyKey: "ot" });
    const matrix = build(w);
    expect(table(matrix, "nutrition").columns.map((c) => c.key)).toContain("g1|CO");
    expect(table(matrix, "pt").columns.filter((c) => c.key === "g1|CO")).toHaveLength(1);
    // A record for a specialty with no table is the only thing left unplaced.
    expect(matrix.unplacedRecords.map((c) => c.id)).toEqual(["p5-nm-ot"]);
  });

  it("an all-specialties record with no column anywhere adds it to every table (GCM-5)", () => {
    // A planned launch: the group has a clinic in TX and a signed agreement,
    // but no PT or dietitian works there yet.
    const w = specialties().facility("g1", "TX").record("g1", "p5", "TX", IN_NETWORK_LABEL, {
      id: "p5-tx-all",
      specialtyKey: "all",
      effectiveDate: "2026-06-01",
    });
    const matrix = build(w);
    for (const specialty of ["pt", "nutrition"] as const) {
      const t = table(matrix, specialty);
      expect(t.columns.map((c) => c.key)).toContain("g1|TX");
      const shared = cell(t, "Payer 5", "g1", "TX");
      expect(shared).toMatchObject({ kind: "record", shared: true, shortLabel: "In network" });
      expect(shared.kind === "record" && shared.contract.id).toBe("p5-tx-all");
    }
    expect(table(matrix, "nutrition").columns.map((c) => c.key)).toEqual([
      "g1|TX",
      "g2|KS",
      "g2|MO",
      "g3|NE",
    ]);
    // Six records before, plus this one, counted once across both tables.
    expect(matrix.counts).toMatchObject({ records: 7, inNetwork: 4 });
    expect(matrix.unplacedRecords).toEqual([]);
    expect(matrix.groupsWithoutColumns).toEqual([]);
    // The Groups and States filters still apply to it.
    expect(
      build(w, { selectedStates: ["KS"] }).tables.flatMap((t) => t.columns.map((c) => c.key)),
    ).not.toContain("g1|TX");
    expect(
      build(w, { selectedGroupIds: ["g2"] }).tables.flatMap((t) => t.columns.map((c) => c.key)),
    ).not.toContain("g1|TX");
  });

  it("an all-specialties record where one specialty has a column adds nothing elsewhere", () => {
    // Group Name 1 has a PT clinic in CO and no dietitian anywhere.
    const w = specialties().record("g1", "p5", "CO", IN_NETWORK_LABEL, {
      id: "p5-co-all",
      specialtyKey: "all",
      effectiveDate: "2026-06-01",
    });
    const matrix = build(w);
    expect(cell(table(matrix, "pt"), "Payer 5", "g1", "CO")).toMatchObject({
      kind: "record",
      shared: true,
    });
    expect(table(matrix, "nutrition").columns.map((c) => c.key)).toEqual([
      "g2|KS",
      "g2|MO",
      "g3|NE",
    ]);
    expect(matrix.counts).toMatchObject({ records: 7, inNetwork: 4 });
    expect(matrix.unplacedRecords).toEqual([]);
  });

  describe("an all-specialties record split by one specialty (GCM-5)", () => {
    // Group Name 2 has only PT clinicians in KS, and one agreement for every
    // specialty with Payer 1 there.
    function kansas() {
      return world()
        .group("g2", "Group Name 2")
        .staff("g2", "pt", ["KS"])
        .payer("p1", "Payer 1", ["KS"])
        .target("g2", "p1", "KS")
        .record("g2", "p1", "KS", IN_NETWORK_LABEL, {
          id: "all-rec",
          specialtyKey: "all",
          effectiveDate: "2026-03-01",
        });
    }

    it("shows the shared record in the PT table only while no specialty has split", () => {
      const matrix = build(kansas());
      expect(matrix.tables.map((t) => t.specialty)).toEqual(["pt"]);
      expect(specialtiesShowingContract(matrix, "all-rec")).toEqual(["pt"]);
    });

    it("after a PT-only split, the shared record moves to a Nutrition column", () => {
      const w = kansas().record("g2", "p1", "KS", DENIED_LABEL, { id: "pt1rec" });
      const matrix = build(w);
      expect(cell(table(matrix, "pt"), "Payer 1", "g2", "KS")).toMatchObject({
        kind: "record",
        shared: false,
        shortLabel: "Denied",
      });
      expect(table(matrix, "nutrition").columns.map((c) => c.key)).toEqual(["g2|KS"]);
      const shared = cell(table(matrix, "nutrition"), "Payer 1", "g2", "KS");
      expect(shared).toMatchObject({ kind: "record", shared: true, shortLabel: "In network" });
      expect(shared.kind === "record" && shared.contract.id).toBe("all-rec");
      expect(matrix.counts).toMatchObject({ records: 2, inNetwork: 1 });
      expect(matrix.unplacedRecords).toEqual([]);
      expect(specialtiesShowingContract(matrix, "all-rec")).toEqual(["nutrition"]);
      expect(specialtiesShowingContract(matrix, "pt1rec")).toEqual(["pt"]);
      expect(specialtiesShowingContract(matrix, "no-such-record")).toEqual([]);
    });

    it("names a shared record that both specialties have split, instead of hiding it", () => {
      const w = kansas()
        .record("g2", "p1", "KS", DENIED_LABEL, { id: "pt1rec" })
        .record("g2", "p1", "KS", IN_NETWORK_LABEL, { id: "nu1rec", specialtyKey: "nutrition" });
      const matrix = build(w);
      expect(specialtiesShowingContract(matrix, "all-rec")).toEqual([]);
      expect(matrix.supersededSharedRecords).toEqual([
        {
          contract: expect.objectContaining({ id: "all-rec" }),
          label: "Payer 1 · Group Name 2 · KS",
        },
      ]);
      expect(matrix.unplacedRecords).toEqual([]);
    });

    it("lists nothing as replaced while any specialty still shows the shared record", () => {
      const w = kansas().record("g2", "p1", "KS", DENIED_LABEL, { id: "pt1rec" });
      expect(build(w).supersededSharedRecords).toEqual([]);
    });

    it("adds no column where another payer's split leaves the shared record visible", () => {
      const w = kansas()
        .payer("p2", "Payer 2", ["KS"])
        .record("g2", "p2", "KS", DENIED_LABEL, { id: "p2-pt" });
      const matrix = build(w);
      expect(matrix.tables.map((t) => t.specialty)).toEqual(["pt"]);
      expect(specialtiesShowingContract(matrix, "all-rec")).toEqual(["pt"]);
    });

    it("follows the filters when naming where a record shows", () => {
      const w = kansas().record("g2", "p1", "KS", DENIED_LABEL, { id: "pt1rec" });
      const matrix = build(w, { specialties: ["pt"] });
      expect(specialtiesShowingContract(matrix, "all-rec")).toEqual([]);
    });
  });

  it("a group whose only footprint is an all-specialties record is not 'Not shown'", () => {
    const w = sketch()
      .group("g9", "Group Name 9 Planned")
      .record("g9", "p1", "NE", NOT_STARTED_LABEL, { specialtyKey: "all" });
    const matrix = build(w);
    expect(matrix.groupsWithoutColumns).toEqual([]);
    expect(matrix.tables.map((t) => t.specialty)).toEqual(["pt", "nutrition"]);
    expect(table(matrix, "nutrition").columns.map((c) => c.key)).toEqual(["g9|NE"]);
  });

  it("a column added this session appears in that specialty's table only (US-15)", () => {
    const matrix = build(specialties(), {
      addedColumns: [
        { specialty: "nutrition", groupId: "g3", state: "la" },
        { specialty: "nutrition", groupId: "unknown-group", state: "TX" },
      ],
    });
    expect(table(matrix, "nutrition").columns.map((c) => c.key)).toEqual([
      "g2|KS",
      "g2|MO",
      "g3|LA",
      "g3|NE",
    ]);
    expect(cell(table(matrix, "nutrition"), "Payer 1", "g3", "LA").kind).toBe("empty");
    expect(table(matrix, "pt").columns.filter((c) => c.groupId === "g3")).toHaveLength(2);
  });

  it("omits a specialty with no columns", () => {
    const matrix = build(sketch());
    expect(matrix.tables.map((t) => t.specialty)).toEqual(["pt"]);
  });
});

// ---------- BCBS: each Blue plan a row, open only where it serves ----------

function bcbs() {
  return world()
    .group("g1", "Group Name 1")
    .group("g2", "Group Name 2")
    .staff("g1", "pt", ["KS", "MO"])
    .staff("g2", "pt", ["ID"])
    .payer("bcbs-ks", "Blue Cross and Blue Shield of Kansas", ["KS"])
    .payer("blue-kc", "Blue Cross and Blue Shield of Kansas City (Blue KC)", ["KS", "MO"])
    .payer("anthem-mo", "Anthem Blue Cross and Blue Shield of Missouri (Elevance)", ["MO"])
    .payer("healthy-ks", "Healthy Blue Kansas (Medicaid)", ["KS"])
    .payer("bc-id", "Blue Cross of Idaho", ["ID"])
    .payer("regence", "Regence BlueShield of Idaho (Cambia Health Solutions)", ["ID"])
    .payer("aetna", "Aetna", ["KS", "MO", "ID"])
    .payer("tx-only", "Texas Only Plan", ["TX"])
    .payer("retired", "Retired Plan", ["KS"], "2026-01-01T00:00:00Z")
    .target("g1", "bcbs-ks", "KS")
    .target("g1", "blue-kc", "KS")
    .target("g1", "blue-kc", "MO")
    .target("g1", "anthem-mo", "MO")
    .target("g2", "bc-id", "ID")
    .target("g2", "regence", "ID")
    .target("g2", "tx-only", "ID")
    .record("g1", "bcbs-ks", "KS", IN_NETWORK_LABEL, { effectiveDate: "2026-01-01" })
    .record("g1", "blue-kc", "KS", IN_NETWORK_LABEL, {
      effectiveDate: "2026-03-01",
      notes: "One agreement covers KS and MO. MO loads after countersignature.",
    })
    .record("g1", "blue-kc", "MO", CONTRACT_SIGNED_LABEL, { tentativeEffectiveDate: "2026-12-01" })
    .record("g1", "anthem-mo", "MO", APPLICATION_SUBMITTED_LABEL)
    .record("g2", "bc-id", "ID", IN_NETWORK_LABEL, { effectiveDate: "2025-07-01" })
    .record("g2", "regence", "ID", APPLICATION_SUBMITTED_LABEL);
}

describe("not in the plan's area (GCM-26, US-11)", () => {
  it("one row per Blue plan, with only the states it serves open", () => {
    const matrix = build(bcbs());
    const pt = table(matrix, "pt");
    expect(pt.rows.map((r) => r.payerName)).toEqual([
      "Anthem Blue Cross and Blue Shield of Missouri (Elevance)",
      "Blue Cross and Blue Shield of Kansas",
      "Blue Cross and Blue Shield of Kansas City (Blue KC)",
      "Blue Cross of Idaho",
      "Regence BlueShield of Idaho (Cambia Health Solutions)",
    ]);
    const bcbsKs = "Blue Cross and Blue Shield of Kansas";
    expect(shortLabels(pt, bcbsKs)).toEqual(["In network", "outside", "outside"]);
    expect(cell(pt, bcbsKs, "g1", "MO").ariaLabel).toBe(
      "Blue Cross and Blue Shield of Kansas, Physical therapy, Group Name 1, MO: Not in the plan's area",
    );
    expect(shortLabels(pt, "Blue Cross and Blue Shield of Kansas City (Blue KC)")).toEqual([
      "In network",
      "Signed",
      "outside",
    ]);
    expect(matrix.counts).toMatchObject({ records: 6, inNetwork: 3, payers: 5 });
  });

  it("drops a payer that serves none of the table's states and holds no record there", () => {
    const names = table(build(bcbs()), "pt").rows.map((r) => r.payerName);
    expect(names).not.toContain("Texas Only Plan");
    expect(names).not.toContain("Healthy Blue Kansas (Medicaid)");
  });

  it("always shows a record, even in a state the catalog does not list", () => {
    const w = bcbs().record("g1", "bcbs-ks", "MO", DENIED_LABEL, { id: "ks-in-mo" });
    const outside = cell(table(build(w), "pt"), "Blue Cross and Blue Shield of Kansas", "g1", "MO");
    expect(outside).toMatchObject({ kind: "record", shortLabel: "Denied", outsideArea: true });

    const tx = bcbs().record("g2", "tx-only", "ID", NOT_STARTED_LABEL);
    expect(table(build(tx), "pt").rows.map((r) => r.payerName)).toContain("Texas Only Plan");
  });

  it("searching 'blue' lists every Blue plan together", () => {
    const pt = table(build(bcbs(), { payerSearch: "blue" }), "pt");
    expect(pt.rows).toHaveLength(5);
  });

  it("treats a payer with no catalog states as serving every state", () => {
    expect(payerServesState({ states: null }, "KS")).toBe(true);
    expect(payerServesState({ states: [] }, "KS")).toBe(true);
    expect(payerServesState({ states: ["ks"] }, "KS ")).toBe(true);
    expect(payerServesState({ states: ["MO"] }, "KS")).toBe(false);
  });
});

describe("+ Add payer (GCM-6, US-9)", () => {
  it("offers catalog payers that would gain a row, and adds an empty row", () => {
    const before = build(bcbs());
    expect(before.addablePayers.map((p) => p.name)).toEqual([
      "Aetna",
      "Healthy Blue Kansas (Medicaid)",
    ]);

    const after = build(bcbs(), { addedPayerIds: ["healthy-ks", "missing-payer"] });
    const row = table(after, "pt").rows.find((r) => r.payerId === "healthy-ks");
    expect(row?.addedInSession).toBe(true);
    expect(row?.cells.map((c) => c.kind)).toEqual(["empty", "outside", "outside"]);
    expect(after.addablePayers.map((p) => p.name)).toEqual(["Aetna"]);
  });

  it("an added row still answers to the payer search and status filter", () => {
    const options = { addedPayerIds: ["aetna"] };
    expect(
      table(build(bcbs(), { ...options, payerSearch: "idaho" }), "pt").rows.map((r) => r.payerId),
    ).not.toContain("aetna");
    expect(
      table(build(bcbs(), { ...options, statusFilter: NO_RECORD_FILTER }), "pt").rows.map(
        (r) => r.payerId,
      ),
    ).toEqual(["aetna"]);
  });
});

describe("groups (GCM-4, D4)", () => {
  function withInactive() {
    return sketch()
      .group("g0", "Group Name 0 Dormant", false)
      .staff("g0", "pt", ["OK"])
      .group("g5", "Group Name 5 Empty");
  }

  it("shows all active groups by default and hides inactive ones", () => {
    const matrix = build(withInactive());
    expect(matrix.selectedGroupIds).toEqual(["g1", "g2", "g3", "g5"]);
    expect(matrix.groupOptions.map((g) => [g.id, g.isActive, g.selected])).toEqual([
      ["g0", false, false],
      ["g1", true, true],
      ["g2", true, true],
      ["g3", true, true],
      ["g5", true, true],
    ]);
    expect(table(matrix, "pt").columns.map((c) => c.state)).not.toContain("OK");
  });

  it("shows an inactive group when picked", () => {
    const matrix = build(withInactive(), { selectedGroupIds: ["g0", "g1"] });
    expect(table(matrix, "pt").columns.map((c) => c.key)).toEqual(["g0|OK", "g1|CO"]);
  });

  it("adds a deep link's inactive group to the untouched default, never narrowing", () => {
    const linked = build(withInactive(), { contextGroupId: "g0" });
    expect(linked.selectedGroupIds).toEqual(["g1", "g2", "g3", "g0", "g5"]);
    expect(table(linked, "pt").columns.map((c) => c.key)).toContain("g0|OK");
    expect(table(linked, "pt").columns).toHaveLength(5);
    const picked = build(withInactive(), { contextGroupId: "g0", selectedGroupIds: ["g1"] });
    expect(picked.selectedGroupIds).toEqual(["g1"]);
  });

  it("names a selected group with no columns in any table, whatever the chips say", () => {
    const matrix = build(withInactive());
    expect(matrix.groupsWithoutColumns.map((g) => g.name)).toEqual(["Group Name 5 Empty"]);
    const nutritionOnly = build(specialties(), { specialties: ["nutrition"] });
    expect(nutritionOnly.groupsWithoutColumns).toEqual([]);
    expect(nutritionOnly.counts.groups).toBe(2);
  });
});

describe("which providers add columns (GCM-30)", () => {
  function base() {
    return world()
      .group("g1", "Group Name 1")
      .group("g2", "Group Name 2")
      .payer("p1", "Payer 1", null);
  }
  const ptStates = (w: ReturnType<typeof world>) =>
    build(w).tables.flatMap((t) => (t.specialty === "pt" ? t.columns.map((c) => c.key) : []));

  it("counts onboarding and active providers, not terminated, pending or test ones", () => {
    const w = base()
      .provider("onboarding", PT_CODE, { status: "onboarding" })
      .member("onboarding", "g1")
      .clinic("onboarding", "g1", "CO")
      .provider("terminated", PT_CODE, { status: "terminated" })
      .member("terminated", "g1")
      .clinic("terminated", "g1", "WY")
      .provider("pending", PT_CODE, { verificationState: "pending_verification" })
      .member("pending", "g1")
      .clinic("pending", "g1", "UT")
      .provider("test", PT_CODE, { isTestProvider: true })
      .member("test", "g1")
      .clinic("test", "g1", "ID");
    expect(ptStates(w)).toEqual(["g1|CO"]);
  });

  it("ignores ended memberships, inactive clinics and other groups' clinics", () => {
    const w = base()
      .provider("ended", PT_CODE)
      .member("ended", "g1", "2026-01-31")
      .clinic("ended", "g1", "WY")
      .provider("ends-today", PT_CODE)
      .member("ends-today", "g1", TODAY)
      .clinic("ends-today", "g1", "CO")
      .provider("inactive-clinic", PT_CODE)
      .member("inactive-clinic", "g1")
      .clinic("inactive-clinic", "g1", "UT", false)
      .provider("elsewhere", PT_CODE)
      .member("elsewhere", "g1")
      .clinic("elsewhere", "g2", "KS");
    expect(ptStates(w)).toEqual(["g1|CO"]);
  });

  it("counts a license on file, and maps taxonomy to the specialty's table only", () => {
    const w = base()
      .provider("licensed", PT_CODE)
      .member("licensed", "g1")
      .license("licensed", "NM")
      .provider("ot", OT_CODE)
      .member("ot", "g1")
      .clinic("ot", "g1", "TX")
      .provider("rd", DIETITIAN_CODE)
      .member("rd", "g2")
      .clinic("rd", "g2", "NE");
    const matrix = build(w);
    expect(ptStates(w)).toEqual(["g1|NM"]);
    expect(table(matrix, "nutrition").columns.map((c) => c.key)).toEqual(["g2|NE"]);
  });
});

describe("status display", () => {
  it("has a short label for each of the 8 governed statuses, in legend order", () => {
    expect(MATRIX_STATUS_ORDER.map((label) => CONTRACT_STATUS_SHORT_LABELS[label])).toEqual([
      "In network",
      "Signed",
      "Submitted",
      "Appealed",
      "Reapplied",
      "Denied",
      "Out of network",
      "Not started",
    ]);
  });

  it("shows a legacy or missing status in full with the neutral tone", () => {
    expect(contractStatusDisplay(OON_LABEL)).toEqual({
      label: OON_LABEL,
      canonical: null,
      shortLabel: OON_LABEL,
      tone: "other",
    });
    expect(contractStatusDisplay(null)).toMatchObject({ label: null, shortLabel: "No status" });
    const w = sketch()
      .payer("legacy", "Legacy Payer", SKETCH_STATES)
      .record("g3", "legacy", "TX", null, { contractingStatusId: LEGACY_OON_ID })
      .payer("blank", "Blank Payer", SKETCH_STATES)
      .record("g3", "blank", "TX", null);
    const pt = table(build(w), "pt");
    expect(cell(pt, "Legacy Payer", "g3", "TX")).toMatchObject({
      shortLabel: "OON",
      tone: "other",
    });
    expect(cell(pt, "Blank Payer", "g3", "TX").ariaLabel).toBe(
      "Blank Payer, Physical therapy, Group Name 3, TX: No status",
    );
    expect(
      table(build(w, { statusFilter: OUT_OF_NETWORK_LABEL }), "pt").rows.map((r) => r.payerName),
    ).toEqual(["Payer 3"]);
  });

  it("writes one date line per GCM-8", () => {
    const dates = { effectiveDate: "2026-01-01", tentativeEffectiveDate: "2025-12-15" };
    expect(contractDateLine(dates, IN_NETWORK_LABEL)).toBe("Eff Jan 1, 2026");
    expect(contractDateLine({ ...dates, effectiveDate: null }, IN_NETWORK_LABEL)).toBe(
      "Tent Dec 15, 2025",
    );
    expect(contractDateLine(dates, CONTRACT_SIGNED_LABEL)).toBe("Tent Dec 15, 2025");
    expect(
      contractDateLine({ ...dates, tentativeEffectiveDate: null }, APPLICATION_SUBMITTED_LABEL),
    ).toBeNull();
    expect(
      contractDateLine({ effectiveDate: null, tentativeEffectiveDate: "not a date" }, null),
    ).toBeNull();
  });
});

describe("locateMatrixCell (GCM-20, US-8)", () => {
  it("lands a case link in the first table holding the column and the payer", () => {
    const matrix = build(sketch());
    expect(locateMatrixCell(matrix, { groupId: "g2", payerId: "p3", state: "ks" })).toEqual({
      specialty: "pt",
      specialtyLabel: "Physical therapy",
      columnKey: "g2|KS",
      groupId: "g2",
      groupName: "Group Name 2",
      payerId: "p3",
      payerName: "Payer 3",
      state: "KS",
    });
  });

  it("falls through to a later specialty when only it holds the row", () => {
    const w = specialties()
      .payer("nutri", "Nutrition Plan", ["MO"])
      .record("g2", "nutri", "MO", APPLICATION_SUBMITTED_LABEL, { specialtyKey: "nutrition" });
    const matrix = build(w);
    expect(table(matrix, "pt").rows.map((r) => r.payerId)).not.toContain("nutri");
    expect(
      locateMatrixCell(matrix, { groupId: "g2", payerId: "nutri", state: "MO" })?.specialty,
    ).toBe("nutrition");
  });

  it("prefers the case's specialty table, falling back to the first match", () => {
    const matrix = build(specialties());
    const link = { groupId: "g2", payerId: "p2", state: "KS" };
    expect(locateMatrixCell(matrix, link)?.specialty).toBe("pt");
    expect(locateMatrixCell(matrix, { ...link, specialty: "nutrition" })?.specialty).toBe(
      "nutrition",
    );
    expect(locateMatrixCell(matrix, { ...link, specialty: null })?.specialty).toBe("pt");
    // Nutrition has no Group Name 1 column, so a Nutrition link to it lands in PT.
    expect(
      locateMatrixCell(matrix, {
        groupId: "g1",
        payerId: "p3",
        state: "NM",
        specialty: "nutrition",
      })?.specialty,
    ).toBe("pt");
    // A specialty whose table is hidden by the chips falls back too.
    const ptOnly = build(specialties(), { specialties: ["pt"] });
    expect(locateMatrixCell(ptOnly, { ...link, specialty: "nutrition" })?.specialty).toBe("pt");
  });

  it("returns null when the link is incomplete or matches no table", () => {
    const matrix = build(sketch());
    expect(locateMatrixCell(matrix, { groupId: "g2", payerId: "p3", state: "" })).toBeNull();
    expect(locateMatrixCell(matrix, { groupId: "g1", payerId: "p3", state: "KS" })).toBeNull();
    expect(locateMatrixCell(matrix, { groupId: "g2", payerId: "nobody", state: "KS" })).toBeNull();
  });
});

describe("largest client size (spec §7: 15 groups, 25 states, ~60 payers)", () => {
  it("derives every column and row", () => {
    const states = Array.from({ length: 25 }, (_, i) => `S${String.fromCharCode(65 + i)}`);
    const w = world();
    for (let g = 0; g < 15; g += 1) {
      const groupId = `g${String(g).padStart(2, "0")}`;
      w.group(groupId, `Group ${String(g).padStart(2, "0")}`).staff(
        groupId,
        "pt",
        states.slice(g, g + 10),
      );
    }
    for (let p = 0; p < 60; p += 1) {
      const payerId = `p${String(p).padStart(2, "0")}`;
      w.payer(payerId, `Payer ${String(p).padStart(2, "0")}`, states).target("g00", payerId, "SA");
      w.record(`g${String(p % 15).padStart(2, "0")}`, payerId, states[p % 15], IN_NETWORK_LABEL);
    }
    const matrix = build(w);
    const pt = table(matrix, "pt");
    expect(pt.columns).toHaveLength(150);
    expect(pt.rows).toHaveLength(60);
    expect(matrix.counts).toMatchObject({ groups: 15, states: 24, payers: 60, records: 60 });
  });
});
