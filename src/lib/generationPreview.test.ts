// E2.0 TE-5 unit suite: every key exactly once, archived targets produce no
// rows (F2.0.3), the Q1 facility-assignment candidacy filter, exclusion
// suppression + voided re-proposal, both TE-6 existing-case matching
// branches, the TE-7 status-aware indicator, and the TS-49 delta run.
import { describe, expect, it } from "vitest";
import {
  buildGenerationPreview,
  buildGenerationSkips,
  existingCaseIndicator,
  generationPreviewSummary,
  generationSkipKey,
  previewRowKey,
  splitGenerationPreview,
  type GenerationExclusionInput,
  type GenerationExistingCaseInput,
  type GenerationPreviewInput,
  type GenerationRosterProviderInput,
} from "./generationPreview";

const TODAY = "2026-07-13";

const baseInput = (over: Partial<GenerationPreviewInput> = {}): GenerationPreviewInput => ({
  today: TODAY,
  targets: [
    { groupId: "g1", payerId: "bcbs-nc", state: "NC", status: "active" },
    { groupId: "g2", payerId: "bcbs-nc", state: "NC", status: "active" },
    { groupId: "g2", payerId: "bcbs-ks", state: "KS", status: "active" },
  ],
  groupAssignments: [
    { providerId: "jane", groupId: "g1" },
    { providerId: "jane", groupId: "g2" },
    { providerId: "amir", groupId: "g2" },
  ],
  facilityAssignments: [
    { providerId: "jane", facilityId: "f-g1" },
    { providerId: "jane", facilityId: "f-g2" },
    { providerId: "amir", facilityId: "f-g2" },
  ],
  facilities: [
    { id: "f-g1", groupId: "g1" },
    { id: "f-g2", groupId: "g2" },
  ],
  providers: [
    { providerId: "jane", providerName: "Jane Whitaker" },
    { providerId: "amir", providerName: "Amir Patel" },
  ],
  groups: [
    { id: "g1", name: "Group 1" },
    { id: "g2", name: "Group 2" },
  ],
  payers: [
    { id: "bcbs-nc", name: "BCBS-NC" },
    { id: "bcbs-ks", name: "BCBS-KS" },
  ],
  existingCases: [],
  exclusions: [],
  ...over,
});

const exclusion = (over: Partial<GenerationExclusionInput> = {}): GenerationExclusionInput => ({
  id: "x1",
  providerId: "jane",
  groupId: "g2",
  payerId: "bcbs-nc",
  state: "NC",
  status: "active",
  reason: "already_credentialed",
  note: null,
  ...over,
});

const existingCase = (
  over: Partial<GenerationExistingCaseInput> = {},
): GenerationExistingCaseInput => ({
  id: "c1",
  providerId: "jane",
  payerId: "bcbs-nc",
  state: "NC",
  groupId: null,
  statusLabel: "In Progress",
  actionBucket: "ours",
  ...over,
});

describe("buildGenerationPreview", () => {
  it("derives every valid combination exactly once, sorted, all proposed", () => {
    const rows = buildGenerationPreview(baseInput());
    expect(rows.map(previewRowKey)).toEqual([
      "amir|g2|bcbs-ks|KS",
      "amir|g2|bcbs-nc|NC",
      "jane|g2|bcbs-ks|KS",
      "jane|g1|bcbs-nc|NC",
      "jane|g2|bcbs-nc|NC",
    ]);
    expect(new Set(rows.map(previewRowKey)).size).toBe(rows.length);
    expect(rows.every((r) => r.disposition === "proposed")).toBe(true);
  });

  it("writes a human-readable derivation reason with resolved names", () => {
    const rows = buildGenerationPreview(baseInput());
    const jane = rows.find((r) => previewRowKey(r) === "jane|g1|bcbs-nc|NC");
    expect(jane?.reason).toBe(
      "Jane Whitaker works at a Group 1 clinic; Group 1 targets BCBS-NC in NC",
    );
  });

  it("archived targets produce no rows (F2.0.3)", () => {
    const input = baseInput({
      targets: [{ groupId: "g1", payerId: "bcbs-nc", state: "NC", status: "archived" }],
    });
    expect(buildGenerationPreview(input)).toEqual([]);
  });

  it("Q1 candidacy: group membership without a facility assignment under the group yields no row", () => {
    // Jane is a MEMBER of g2 but only works at a g1 clinic — the epic's own
    // example. Her g2 rows must not be proposed; her g1 row must be.
    const input = baseInput({
      facilityAssignments: [{ providerId: "jane", facilityId: "f-g1" }],
      groupAssignments: [
        { providerId: "jane", groupId: "g1" },
        { providerId: "jane", groupId: "g2" },
      ],
      providers: [{ providerId: "jane", providerName: "Jane Whitaker" }],
    });
    const keys = buildGenerationPreview(input).map(previewRowKey);
    expect(keys).toEqual(["jane|g1|bcbs-nc|NC"]);
  });

  it("a facility assignment alone (no group membership) yields no row", () => {
    const input = baseInput({
      groupAssignments: [{ providerId: "jane", groupId: "g1" }],
      facilityAssignments: [
        { providerId: "jane", facilityId: "f-g1" },
        { providerId: "amir", facilityId: "f-g2" },
      ],
    });
    const keys = buildGenerationPreview(input).map(previewRowKey);
    expect(keys).toEqual(["jane|g1|bcbs-nc|NC"]);
  });

  it("an assignment end-dated before today drops the provider from that group's keys", () => {
    const input = baseInput({
      groupAssignments: [
        { providerId: "jane", groupId: "g1", endDate: "2026-07-12" },
        { providerId: "jane", groupId: "g2", endDate: "2026-07-13" }, // runs through today
      ],
      providers: [{ providerId: "jane", providerName: "Jane Whitaker" }],
      facilityAssignments: [
        { providerId: "jane", facilityId: "f-g1" },
        { providerId: "jane", facilityId: "f-g2" },
      ],
    });
    const keys = buildGenerationPreview(input).map(previewRowKey);
    expect(keys).toEqual(["jane|g2|bcbs-ks|KS", "jane|g2|bcbs-nc|NC"]);
  });

  it("terminated/unknown providers never produce rows", () => {
    const input = baseInput({
      providers: [{ providerId: "amir", providerName: "Amir Patel" }],
    });
    const rows = buildGenerationPreview(input);
    expect(rows.every((r) => r.providerId === "amir")).toBe(true);
  });

  it("an active exclusion suppresses its exact 4-part key only", () => {
    const rows = buildGenerationPreview(baseInput({ exclusions: [exclusion()] }));
    const excluded = rows.find((r) => previewRowKey(r) === "jane|g2|bcbs-nc|NC");
    expect(excluded?.disposition).toBe("excluded");
    expect(excluded?.exclusion).toEqual({
      exclusionId: "x1",
      reason: "already_credentialed",
      note: null,
    });
    // The same provider/payer/state under the OTHER group stays proposed.
    expect(rows.find((r) => previewRowKey(r) === "jane|g1|bcbs-nc|NC")?.disposition).toBe(
      "proposed",
    );
  });

  it("a voided exclusion re-proposes the row (TE-2 restore)", () => {
    const rows = buildGenerationPreview(
      baseInput({ exclusions: [exclusion({ status: "voided" })] }),
    );
    expect(rows.find((r) => previewRowKey(r) === "jane|g2|bcbs-nc|NC")?.disposition).toBe(
      "proposed",
    );
  });

  it("TE-6: a NULL-group case covers ALL candidate rows at its (provider, payer, state)", () => {
    const rows = buildGenerationPreview(baseInput({ existingCases: [existingCase()] }));
    for (const key of ["jane|g1|bcbs-nc|NC", "jane|g2|bcbs-nc|NC"]) {
      const row = rows.find((r) => previewRowKey(r) === key);
      expect(row?.disposition).toBe("existing");
      expect(row?.existingCase?.caseId).toBe("c1");
    }
    // A different payer/state for the same provider is untouched.
    expect(rows.find((r) => previewRowKey(r) === "jane|g2|bcbs-ks|KS")?.disposition).toBe(
      "proposed",
    );
  });

  it("TE-6: a group-stamped case covers only its exact 4-part key", () => {
    const rows = buildGenerationPreview(
      baseInput({ existingCases: [existingCase({ groupId: "g1" })] }),
    );
    expect(rows.find((r) => previewRowKey(r) === "jane|g1|bcbs-nc|NC")?.disposition).toBe(
      "existing",
    );
    expect(rows.find((r) => previewRowKey(r) === "jane|g2|bcbs-nc|NC")?.disposition).toBe(
      "proposed",
    );
  });

  it("an existing case wins over an exclusion at the same key (an exclusion never touches cases)", () => {
    const rows = buildGenerationPreview(
      baseInput({ existingCases: [existingCase()], exclusions: [exclusion()] }),
    );
    const row = rows.find((r) => previewRowKey(r) === "jane|g2|bcbs-nc|NC");
    expect(row?.disposition).toBe("existing");
    expect(row?.exclusion).toBeNull();
  });

  it("status-linked suppression derives live: a status flip off complete resurfaces the in-flight wording", () => {
    const denied = existingCase({ statusLabel: "Denied", actionBucket: "complete" });
    const before = buildGenerationPreview(baseInput({ existingCases: [denied] }));
    const row = before.find((r) => previewRowKey(r) === "jane|g1|bcbs-nc|NC");
    expect(row?.existingCase?.complete).toBe(true);
    // The SAME case re-read after a status change (nothing stored in between).
    const reopened = existingCase({ statusLabel: "In Progress", actionBucket: "ours" });
    const after = buildGenerationPreview(baseInput({ existingCases: [reopened] }));
    expect(
      after.find((r) => previewRowKey(r) === "jane|g1|bcbs-nc|NC")?.existingCase?.complete,
    ).toBe(false);
  });

  it("TS-49 delta run: adding providers proposes only genuinely new keys; the exclusion holds", () => {
    const withExclusion = baseInput({ exclusions: [exclusion()] });
    const firstRun = buildGenerationPreview(withExclusion);
    const secondRun = buildGenerationPreview({
      ...withExclusion,
      providers: [
        ...withExclusion.providers,
        { providerId: "nora", providerName: "Nora Vance" },
        { providerId: "theo", providerName: "Theo Marsh" },
      ],
      groupAssignments: [
        ...withExclusion.groupAssignments,
        { providerId: "nora", groupId: "g2" },
        { providerId: "theo", groupId: "g1" },
      ],
      facilityAssignments: [
        ...withExclusion.facilityAssignments,
        { providerId: "nora", facilityId: "f-g2" },
        { providerId: "theo", facilityId: "f-g1" },
      ],
    });
    const firstKeys = new Set(firstRun.map(previewRowKey));
    const newRows = secondRun.filter((r) => !firstKeys.has(previewRowKey(r)));
    expect(newRows.map(previewRowKey).sort()).toEqual([
      "nora|g2|bcbs-ks|KS",
      "nora|g2|bcbs-nc|NC",
      "theo|g1|bcbs-nc|NC",
    ]);
    expect(newRows.every((r) => r.disposition === "proposed")).toBe(true);
    // The prior exclusion still suppresses its key on the re-run.
    expect(secondRun.find((r) => previewRowKey(r) === "jane|g2|bcbs-nc|NC")?.disposition).toBe(
      "excluded",
    );
  });
});

describe("existingCaseIndicator (TE-7)", () => {
  it("in-flight cases read 'already exists — in progress'", () => {
    expect(
      existingCaseIndicator({ caseId: "c", statusLabel: "Submitted", complete: false }),
    ).toEqual({ label: "already exists — in progress", reapply: false });
  });

  it("status-less cases count as open", () => {
    const rows = buildGenerationPreview(
      baseInput({ existingCases: [existingCase({ statusLabel: null, actionBucket: null })] }),
    );
    const row = rows.find((r) => previewRowKey(r) === "jane|g1|bcbs-nc|NC");
    expect(row?.existingCase?.complete).toBe(false);
  });

  it("complete-bucket cases carry the status label and the reapply flag", () => {
    expect(existingCaseIndicator({ caseId: "c", statusLabel: "Denied", complete: true })).toEqual({
      label: "already exists — Denied",
      reapply: true,
    });
    expect(existingCaseIndicator({ caseId: "c", statusLabel: null, complete: true })).toEqual({
      label: "already exists — closed",
      reapply: true,
    });
  });
});

describe("splitGenerationPreview / generationPreviewSummary", () => {
  it("splits excluded rows out of the checklist and counts dispositions", () => {
    const rows = buildGenerationPreview(
      baseInput({ exclusions: [exclusion()], existingCases: [existingCase({ groupId: "g1" })] }),
    );
    const split = splitGenerationPreview(rows);
    expect(split.excluded.map(previewRowKey)).toEqual(["jane|g2|bcbs-nc|NC"]);
    expect(split.checklist).toHaveLength(4);
    expect(generationPreviewSummary(rows)).toEqual({
      candidates: 5,
      proposed: 3,
      existing: 1,
      excluded: 1,
    });
  });
});

describe("buildGenerationSkips — GEN-SILENT", () => {
  const roster = (
    over: Partial<GenerationRosterProviderInput> &
      Pick<GenerationRosterProviderInput, "providerId">,
  ): GenerationRosterProviderInput => ({
    providerName: over.providerName ?? "Provider",
    pendingVerification: false,
    skipEligible: true,
    ...over,
  });

  it("explains membership without a facility under the target group", () => {
    // Same Q1 example as candidacy: Jane is a g2 member but only at a g1 clinic.
    const input = baseInput({
      facilityAssignments: [{ providerId: "jane", facilityId: "f-g1" }],
      groupAssignments: [
        { providerId: "jane", groupId: "g1" },
        { providerId: "jane", groupId: "g2" },
      ],
      providers: [{ providerId: "jane", providerName: "Jane Whitaker" }],
    });
    const skips = buildGenerationSkips(input, [
      roster({ providerId: "jane", providerName: "Jane Whitaker" }),
    ]);
    expect(buildGenerationPreview(input).map(previewRowKey)).toEqual(["jane|g1|bcbs-nc|NC"]);
    expect(skips.map(generationSkipKey)).toEqual([
      "jane|g2|bcbs-ks|KS|no_facility",
      "jane|g2|bcbs-nc|NC|no_facility",
    ]);
    expect(skips[0]?.reasonLabel).toMatch(/facility/i);
  });

  it("explains pending_verification members the facts fence drops", () => {
    const input = baseInput({
      groupAssignments: [{ providerId: "pending", groupId: "g1" }],
      facilityAssignments: [{ providerId: "pending", facilityId: "f-g1" }],
      providers: [], // fence: absent from readiness facts
    });
    const skips = buildGenerationSkips(input, [
      roster({
        providerId: "pending",
        providerName: "Pat Pending",
        pendingVerification: true,
      }),
    ]);
    expect(buildGenerationPreview(input)).toEqual([]);
    expect(skips).toEqual([
      expect.objectContaining({
        providerId: "pending",
        groupId: "g1",
        payerId: "bcbs-nc",
        state: "NC",
        reason: "pending_verification",
      }),
    ]);
  });

  it("does not emit skips for providers who already candidacy-succeed", () => {
    const skips = buildGenerationSkips(baseInput(), [
      roster({ providerId: "jane", providerName: "Jane Whitaker" }),
      roster({ providerId: "amir", providerName: "Amir Patel" }),
    ]);
    expect(skips).toEqual([]);
  });

  it("ignores terminated / ineligible roster rows", () => {
    const input = baseInput({
      groupAssignments: [{ providerId: "gone", groupId: "g1" }],
      facilityAssignments: [],
      providers: [],
    });
    expect(
      buildGenerationSkips(input, [
        roster({ providerId: "gone", providerName: "Gone", skipEligible: false }),
      ]),
    ).toEqual([]);
  });
});
