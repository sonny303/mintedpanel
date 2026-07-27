import { describe, expect, it } from "vitest";
import {
  awaitingGroupIdCases,
  enrollmentIdBadge,
  groupIdNotIssued,
  type GroupIdCaseSlice,
} from "./payerIssuedIds";
import type { Payer } from "@/types";

const basePayer: Payer = {
  id: "p1",
  orgId: null,
  name: "Aetna (CVS Health)",
  isActive: true,
  avgDecisionDays: null,
  createdAt: "2026-07-01T00:00:00Z",
};

const approvedCase = (over: Partial<GroupIdCaseSlice> & { id: string }): GroupIdCaseSlice => ({
  state: "NC",
  caseStatus: "approved",
  payerGroupProviderId: null,
  caseNumber: null,
  ...over,
});

describe("enrollmentIdBadge (provider-side Awaiting ID)", () => {
  it("shows the captured value under the payer's own provider label", () => {
    const payer = { ...basePayer, providerIdLabel: "Provider Number", providerIdExpected: true };
    expect(enrollmentIdBadge(payer, "A1234567")).toEqual({
      kind: "value",
      label: "Provider Number",
      value: "A1234567",
    });
  });

  it("expected + approved + NULL id derives Awaiting ID (never stored)", () => {
    const payer = { ...basePayer, providerIdLabel: "Provider Number", providerIdExpected: true };
    expect(enrollmentIdBadge(payer, null)).toEqual({ kind: "awaiting", label: "Provider Number" });
  });

  it("falls through the legacy resolution pair exactly like the RPC's COALESCE", () => {
    const payer = { ...basePayer, resolutionIdLabel: "PTAN", resolutionIdExpected: true };
    expect(enrollmentIdBadge(payer, null)).toEqual({ kind: "awaiting", label: "PTAN" });
  });

  it("an unconfigured payer defaults to expected (the RPC's NULL→true default)", () => {
    expect(enrollmentIdBadge(basePayer, null)).toEqual({
      kind: "awaiting",
      label: "Payer-issued ID",
    });
    expect(enrollmentIdBadge(null, null)).toEqual({ kind: "awaiting", label: "Payer-issued ID" });
  });

  it("a payer that issues no provider ID reads not_issued, never Awaiting", () => {
    const payer = { ...basePayer, providerIdExpected: false };
    expect(enrollmentIdBadge(payer, null)).toEqual({ kind: "not_issued" });
  });

  it("a blank stored value counts as missing", () => {
    const payer = { ...basePayer, providerIdExpected: true };
    expect(enrollmentIdBadge(payer, "   ")).toEqual({
      kind: "awaiting",
      label: "Payer-issued ID",
    });
  });
});

describe("awaitingGroupIdCases (group-side Awaiting ID)", () => {
  const expecting: Payer = { ...basePayer, groupIdLabel: "Group PIN", groupIdExpected: true };

  it("expected + approved + NULL payer_group_provider_id derives the wait, linking the capturing case", () => {
    const out = awaitingGroupIdCases(
      expecting,
      [approvedCase({ id: "c-1", caseNumber: 1042 })],
      [{ state: "NC", payerIssuedId: null }],
    );
    expect(out).toEqual([{ caseId: "c-1", caseNumber: 1042, state: "NC" }]);
  });

  it("the group default is NOT expected (RPC NULL→false) — unconfigured payers never wait", () => {
    expect(awaitingGroupIdCases(basePayer, [approvedCase({ id: "c-1" })], [])).toEqual([]);
    expect(awaitingGroupIdCases(null, [approvedCase({ id: "c-1" })], [])).toEqual([]);
  });

  it("a captured case ID resolves the wait", () => {
    const out = awaitingGroupIdCases(
      expecting,
      [approvedCase({ id: "c-1", payerGroupProviderId: "GP-448210" })],
      [],
    );
    expect(out).toEqual([]);
  });

  it("open cases never wait — only Approved derives", () => {
    const out = awaitingGroupIdCases(
      expecting,
      [approvedCase({ id: "c-1", caseStatus: "in_review" })],
      [],
    );
    expect(out).toEqual([]);
  });

  it("a stored target PIN for the state is the set-later back-fill — it resolves the wait", () => {
    const out = awaitingGroupIdCases(
      expecting,
      [approvedCase({ id: "c-nc" }), approvedCase({ id: "c-sc", state: "SC" })],
      [
        { state: "NC", payerIssuedId: "GP-771034" },
        { state: "SC", payerIssuedId: null },
      ],
    );
    expect(out).toEqual([{ caseId: "c-sc", caseNumber: null, state: "SC" }]);
  });

  it("dedupes per state deterministically — lowest case number then id wins", () => {
    const out = awaitingGroupIdCases(
      expecting,
      [
        approvedCase({ id: "c-b", caseNumber: 1055 }),
        approvedCase({ id: "c-a", caseNumber: 1042 }),
        approvedCase({ id: "c-z", caseNumber: null }),
      ],
      [],
    );
    expect(out).toEqual([{ caseId: "c-a", caseNumber: 1042, state: "NC" }]);
  });

  it("orders multi-state waits by state for a stable render", () => {
    const out = awaitingGroupIdCases(
      expecting,
      [approvedCase({ id: "c-sc", state: "SC" }), approvedCase({ id: "c-nc", state: "NC" })],
      [],
    );
    expect(out.map((e) => e.state)).toEqual(["NC", "SC"]);
  });
});

describe("groupIdNotIssued", () => {
  it("true only when approved evidence exists AND the payer issues no group ID", () => {
    const none: Payer = { ...basePayer, groupIdExpected: false };
    expect(groupIdNotIssued(none, 1)).toBe(true);
    expect(groupIdNotIssued(none, 0)).toBe(false);
    // Unconfigured group side defaults to not-expected — but the chip still
    // only shows once there is an approval to hang it on.
    expect(groupIdNotIssued(basePayer, 2)).toBe(true);
    expect(groupIdNotIssued({ ...basePayer, groupIdExpected: true }, 2)).toBe(false);
  });
});
