// E1.5 TE-3/TE-7 — expansion intersection, empty expansion, review defaults
// (archived pre-unchecked), exception exclusion on save, and the derived
// "new expansion available" diff.
import { describe, expect, it } from "vitest";
import {
  expandTargets,
  expansionRowKey,
  newExpansionRows,
  planAttachmentSave,
  reviewExpansion,
} from "./payerExpansion";
import type { Facility, PayerNetworkTarget, ProviderGroup } from "@/types";

const group = (id: string, over: Partial<ProviderGroup> = {}): ProviderGroup =>
  ({ id, orgId: "o-1", name: `Group ${id}`, isActive: true, ...over }) as ProviderGroup;

const facility = (id: string, groupId: string, state: string, isActive = true): Facility =>
  ({
    id,
    orgId: "o-1",
    groupId,
    name: `Facility ${id}`,
    state,
    isActive,
  }) as Facility;

const target = (over: Partial<PayerNetworkTarget>): PayerNetworkTarget => ({
  id: "t-1",
  orgId: "o-1",
  payerId: "p-1",
  groupId: "g-1",
  state: "NC",
  status: "active",
  createdAt: "2026-07-12T00:00:00Z",
  ...over,
});

const groups = [group("g-1"), group("g-2"), group("g-x", { isActive: false })];
const facilities = [
  facility("f-1", "g-1", "NC"),
  facility("f-2", "g-2", "NC"),
  facility("f-3", "g-2", "NC"),
  facility("f-4", "g-2", "KS"),
  facility("f-5", "g-1", "TX", false), // inactive — never counts
  facility("f-6", "g-x", "NC"), // inactive group — never counts
];

describe("expandTargets (TS-41 intersection)", () => {
  it("targets a group in a state with ≥1 active facility where the payer operates", () => {
    expect(expandTargets(["NC"], groups, facilities)).toEqual([
      { groupId: "g-1", state: "NC", facilityCount: 1 },
      { groupId: "g-2", state: "NC", facilityCount: 2 },
    ]);
    expect(expandTargets(["KS"], groups, facilities)).toEqual([
      { groupId: "g-2", state: "KS", facilityCount: 1 },
    ]);
  });

  it("payer operating in none of the groups' states yields an empty expansion", () => {
    expect(expandTargets(["OR"], groups, facilities)).toEqual([]);
    expect(expandTargets([], groups, facilities)).toEqual([]);
    expect(expandTargets(null, groups, facilities)).toEqual([]);
  });

  it("inactive facilities and soft-deleted groups never produce rows", () => {
    expect(expandTargets(["TX"], groups, facilities)).toEqual([]);
  });
});

describe("reviewExpansion (defaults) + planAttachmentSave (exceptions, restore)", () => {
  const expansion = expandTargets(["NC"], groups, facilities);

  it("new rows default checked; previously archived rows are PRE-UNCHECKED", () => {
    const review = reviewExpansion(expansion, [
      target({ id: "t-arch", groupId: "g-1", state: "NC", status: "archived" }),
    ]);
    expect(review).toEqual([
      {
        groupId: "g-1",
        state: "NC",
        facilityCount: 1,
        existing: "archived",
        targetId: "t-arch",
        defaultChecked: false,
      },
      {
        groupId: "g-2",
        state: "NC",
        facilityCount: 2,
        existing: "none",
        targetId: null,
        defaultChecked: true,
      },
    ]);
  });

  it("unchecked rows are excluded; checked archived rows plan restores, not inserts", () => {
    const review = reviewExpansion(expansion, [
      target({ id: "t-arch", groupId: "g-1", state: "NC", status: "archived" }),
    ]);
    const allChecked = new Set(review.map(expansionRowKey));
    expect(planAttachmentSave(review, allChecked)).toEqual({
      inserts: [{ groupId: "g-2", state: "NC" }],
      restoreIds: ["t-arch"],
    });
    // TS-41 exception: unchecking Group 2 × NC saves nothing new.
    expect(planAttachmentSave(review, new Set([expansionRowKey(review[0])]))).toEqual({
      inserts: [],
      restoreIds: ["t-arch"],
    });
  });

  it("already-active rows are never re-written by a save plan", () => {
    const review = reviewExpansion(expansion, [
      target({ id: "t-act", groupId: "g-1", state: "NC", status: "active" }),
    ]);
    const allChecked = new Set(review.map(expansionRowKey));
    expect(planAttachmentSave(review, allChecked)).toEqual({
      inserts: [{ groupId: "g-2", state: "NC" }],
      restoreIds: [],
    });
  });
});

describe("newExpansionRows (TE-7 derived affordance)", () => {
  it("flags only rows with no existing target at all", () => {
    const expansion = expandTargets(["NC", "KS"], groups, facilities);
    const existing = [
      target({ groupId: "g-1", state: "NC", status: "active" }),
      target({ id: "t-2", groupId: "g-2", state: "NC", status: "archived" }),
    ];
    // Adding the KS facility later surfaces exactly the new Group 2 × KS row.
    expect(newExpansionRows(expansion, existing)).toEqual([
      { groupId: "g-2", state: "KS", facilityCount: 1 },
    ]);
    expect(newExpansionRows([], existing)).toEqual([]);
  });
});
