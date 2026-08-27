// E6.2 F6.2.4 — group-basis attach eligibility: the picker never offers a
// zero-overlap payer, proposed states = payer states ∩ group operating states,
// and the CSV row validation applies the SAME rule (the descriptor delegates
// here, so scan-time errors and the dialog cannot drift).
import { describe, expect, it } from "vitest";
import {
  alreadyAttachedPayerIds,
  attachPlanTotals,
  attachRowKey,
  defaultAttachSelection,
  groupAttachExpansion,
  planMultiAttachSave,
  proposedAttachStates,
  resolveAttachGroup,
  resolveAttachPayer,
  reviewAttachSelection,
  splitAttachPicker,
  validatePayerAttachRow,
  type PayerAttachScanContext,
} from "@/lib/groupPayerAttach";
import type { Facility, Payer, PayerNetworkTarget } from "@/types";

function payer(overrides: Partial<Payer>): Payer {
  return {
    id: "pay1",
    orgId: null,
    name: "Aetna",
    avgDecisionDays: null,
    createdAt: "2026-01-01T00:00:00Z",
    states: ["NC", "SC"],
    status: "active",
    ...overrides,
  } as Payer;
}

const GROUP = { id: "g1", states: ["NC", "CO"] };

describe("proposedAttachStates", () => {
  it("intersects payer coverage with the group's operating states, sorted", () => {
    expect(proposedAttachStates(payer({ states: ["SC", "NC", "CO"] }), GROUP)).toEqual([
      "CO",
      "NC",
    ]);
  });

  it("empty group states → empty proposal", () => {
    expect(proposedAttachStates(payer({}), { states: null })).toEqual([]);
  });
});

describe("splitAttachPicker", () => {
  it("offers overlap payers, names zero-overlap payers as ineligible", () => {
    const a = payer({ id: "a", name: "Aetna", states: ["NC"] });
    const b = payer({ id: "b", name: "BCBS Texas", states: ["TX"] });
    const split = splitAttachPicker([b, a], GROUP);
    expect(split.eligible.map((e) => e.payer.id)).toEqual(["a"]);
    expect(split.eligible[0].overlap).toEqual(["NC"]);
    expect(split.ineligible.map((p) => p.id)).toEqual(["b"]);
  });

  it("retired and merged payers are never offered", () => {
    const split = splitAttachPicker(
      [payer({ id: "r", status: "retired" }), payer({ id: "m", status: "merged" })],
      GROUP,
    );
    expect(split.eligible).toEqual([]);
    expect(split.ineligible).toEqual([]);
  });

  it("archived payers are never offered (E6.8 — reactivate before attaching)", () => {
    const split = splitAttachPicker(
      [payer({ id: "arch", archivedAt: "2026-07-27T00:00:00Z", states: ["NC"] })],
      GROUP,
    );
    expect(split.eligible).toEqual([]);
    expect(split.ineligible).toEqual([]);
  });
});

describe("groupAttachExpansion", () => {
  const facility = (id: string, state: string, groupId = "g1", isActive = true) =>
    ({ id, groupId, state, isActive }) as Facility;

  it("one row per proposed state with the group's active facility count (0 allowed)", () => {
    const rows = groupAttachExpansion(payer({ states: ["NC", "CO"] }), GROUP, [
      facility("f1", "NC"),
      facility("f2", "NC"),
      facility("f3", "CO", "g2"), // other group's facility never counts
      facility("f4", "NC", "g1", false), // inactive never counts
    ]);
    expect(rows).toEqual([
      { groupId: "g1", state: "CO", facilityCount: 0 },
      { groupId: "g1", state: "NC", facilityCount: 2 },
    ]);
  });
});

describe("multi-payer attach review", () => {
  const facility = (id: string, state: string) =>
    ({ id, groupId: "g1", state, isActive: true }) as Facility;
  const target = (overrides: Partial<PayerNetworkTarget>): PayerNetworkTarget =>
    ({
      id: "t1",
      orgId: "org1",
      groupId: "g1",
      payerId: "a",
      state: "NC",
      status: "active",
      ...overrides,
    }) as PayerNetworkTarget;

  const aetna = payer({ id: "a", name: "Aetna", states: ["NC", "CO", "SC"] });
  const bcbs = payer({ id: "b", name: "BCBS", states: ["CO"] });
  const FACILITIES = [facility("f1", "NC"), facility("f2", "CO")];

  it("builds one name-sorted block per payer, each scoped to its OWN targets", () => {
    const reviews = reviewAttachSelection([aetna, bcbs], GROUP, FACILITIES, [
      target({ id: "t-a-nc", payerId: "a", state: "NC", status: "active" }),
      // BCBS's CO row is archived — it must not make Aetna's CO row look used.
      target({ id: "t-b-co", payerId: "b", state: "CO", status: "archived" }),
      // Another group's row is invisible here.
      target({ id: "t-x", payerId: "a", state: "CO", groupId: "g2", status: "active" }),
    ]);
    expect(reviews.map((r) => r.payer.id)).toEqual(["a", "b"]);
    expect(reviews[0].rows.map((r) => [r.state, r.existing])).toEqual([
      ["CO", "none"],
      ["NC", "active"],
    ]);
    expect(reviews[1].rows.map((r) => [r.state, r.existing])).toEqual([["CO", "archived"]]);
  });

  it("fullyAttached only when every proposed state is already active", () => {
    const [full] = reviewAttachSelection([bcbs], GROUP, FACILITIES, [
      target({ id: "t-b-co", payerId: "b", state: "CO", status: "active" }),
    ]);
    expect(full.fullyAttached).toBe(true);
    const [partial] = reviewAttachSelection([aetna], GROUP, FACILITIES, [
      target({ id: "t-a-nc", payerId: "a", state: "NC", status: "active" }),
    ]);
    expect(partial.fullyAttached).toBe(false);
  });

  it("alreadyAttachedPayerIds is every payer with ≥1 active target for the group", () => {
    expect(
      [
        ...alreadyAttachedPayerIds(
          [
            target({ id: "t1", payerId: "a", state: "NC", status: "active" }),
            target({ id: "t2", payerId: "a", state: "CO", status: "active" }),
            target({ id: "t3", payerId: "b", state: "CO", status: "archived" }),
            target({ id: "t4", payerId: "c", groupId: "other", state: "NC", status: "active" }),
          ],
          "g1",
        ),
      ].sort(),
    ).toEqual(["a"]);
  });

  it("defaults pre-check new facility-backed rows only, payer-scoped", () => {
    const reviews = reviewAttachSelection([aetna, bcbs], GROUP, [facility("f1", "NC")], []);
    // Aetna: NC has a facility (checked), CO has none (visible, unchecked).
    expect([...defaultAttachSelection(reviews)]).toEqual(["a|g1|NC"]);
  });

  it("plans one entry per payer with work, dropping payers with nothing to save", () => {
    const reviews = reviewAttachSelection([aetna, bcbs], GROUP, FACILITIES, [
      target({ id: "t-a-nc", payerId: "a", state: "NC", status: "active" }),
      target({ id: "t-b-co", payerId: "b", state: "CO", status: "archived" }),
    ]);
    const checked = new Set([
      attachRowKey("a", { groupId: "g1", state: "CO" }),
      attachRowKey("b", { groupId: "g1", state: "CO" }),
    ]);
    const plans = planMultiAttachSave(reviews, checked);
    expect(plans).toEqual([
      { payerId: "a", plan: { inserts: [{ groupId: "g1", state: "CO" }], restoreIds: [] } },
      { payerId: "b", plan: { inserts: [], restoreIds: ["t-b-co"] } },
    ]);
    expect(attachPlanTotals(plans)).toEqual({ payerCount: 2, stateCount: 2 });

    // Nothing checked → no payer carries work at all.
    expect(planMultiAttachSave(reviews, new Set())).toEqual([]);
  });

  it("one payer's checked state never leaks into another payer's plan", () => {
    const reviews = reviewAttachSelection([aetna, bcbs], GROUP, FACILITIES, []);
    // Only BCBS's CO is checked; Aetna also proposes CO and must stay out.
    const plans = planMultiAttachSave(
      reviews,
      new Set([attachRowKey("b", { groupId: "g1", state: "CO" })]),
    );
    expect(plans).toEqual([
      { payerId: "b", plan: { inserts: [{ groupId: "g1", state: "CO" }], restoreIds: [] } },
    ]);
  });
});

describe("CSV row resolution + eligibility", () => {
  const ctx: PayerAttachScanContext = {
    groups: [
      { id: "g1", name: "Outer Banks Rehab Group", tin: "123456789", states: ["NC", "CO"] },
      { id: "g2", name: "Shelby Group Two", tin: "987654321", states: ["SC"] },
    ],
    payers: [
      {
        id: "pay1",
        name: "Aetna",
        payerSlug: "aetna",
        aliases: ["Aetna Health"],
        states: ["NC", "SC"],
        status: "active",
      },
      { id: "pay2", name: "Old Payer", payerSlug: "old", states: ["NC"], status: "retired" },
    ],
  };

  it("resolves the group by TIN first (dashed tolerated), then name", () => {
    expect(resolveAttachGroup(ctx.groups, null, "12-3456789")?.id).toBe("g1");
    expect(resolveAttachGroup(ctx.groups, "outer banks rehab group", null)?.id).toBe("g1");
    expect(resolveAttachGroup(ctx.groups, "nope", null)).toBeNull();
  });

  it("resolves the payer by slug, name, then alias — case-insensitive", () => {
    expect(resolveAttachPayer(ctx.payers, "AETNA")?.id).toBe("pay1");
    expect(resolveAttachPayer(ctx.payers, "aetna health")?.id).toBe("pay1");
    expect(resolveAttachPayer(ctx.payers, "unknown")).toBeNull();
  });

  it("a valid row resolves ids", () => {
    const result = validatePayerAttachRow(
      { groupName: null, groupTin: "123456789", payer: "Aetna", states: ["NC"] },
      ctx,
    );
    expect(result).toEqual({ ok: { groupId: "g1", payerId: "pay1", states: ["NC"] } });
  });

  it("names per-row eligibility errors: unknown group/payer, retired payer, out-of-coverage and out-of-operating states", () => {
    expect(
      validatePayerAttachRow(
        { groupName: "nope", groupTin: null, payer: "Aetna", states: ["NC"] },
        ctx,
      ),
    ).toMatchObject({ error: { column: "group_name" } });
    expect(
      validatePayerAttachRow(
        { groupName: "Outer Banks Rehab Group", groupTin: null, payer: "ghost", states: ["NC"] },
        ctx,
      ),
    ).toMatchObject({ error: { column: "payer", reason: 'No catalog payer matches "ghost"' } });
    expect(
      validatePayerAttachRow(
        {
          groupName: "Outer Banks Rehab Group",
          groupTin: null,
          payer: "Old Payer",
          states: ["NC"],
        },
        ctx,
      ),
    ).toMatchObject({ error: { column: "payer" } });
    expect(
      validatePayerAttachRow(
        { groupName: "Outer Banks Rehab Group", groupTin: null, payer: "Aetna", states: ["TX"] },
        ctx,
      ),
    ).toMatchObject({ error: { column: "states", reason: "Aetna does not cover TX" } });
    // SC is in Aetna's coverage but NOT Outer Banks' operating states.
    expect(
      validatePayerAttachRow(
        { groupName: "Outer Banks Rehab Group", groupTin: null, payer: "Aetna", states: ["SC"] },
        ctx,
      ),
    ).toMatchObject({
      error: {
        column: "states",
        reason: "SC is not one of Outer Banks Rehab Group's operating states",
      },
    });
  });

  it("an archived payer fails the row with a reactivate pointer (E6.8)", () => {
    const archivedCtx: PayerAttachScanContext = {
      groups: ctx.groups,
      payers: [
        {
          id: "pay3",
          name: "Sleepy Health",
          states: ["NC"],
          status: "active",
          archivedAt: "2026-07-27T00:00:00Z",
        },
      ],
    };
    expect(
      validatePayerAttachRow(
        {
          groupName: "Outer Banks Rehab Group",
          groupTin: null,
          payer: "Sleepy Health",
          states: ["NC"],
        },
        archivedCtx,
      ),
    ).toMatchObject({
      error: {
        column: "payer",
        reason: "Sleepy Health is archived — reactivate it before attaching",
      },
    });
  });
});
