// E6.2/E6.3 F6.3.1 — the candidate buffer math: candidates = targets ×
// eligible providers − enrollment facts − existing cases − exclusions,
// composed over the LOCKED buildGenerationPreview derivation (cases +
// exclusions already subtracted there) plus the E6.2 facts subtraction. The
// board banner and E6.3's grid consume this same function, so the counts can
// never disagree. Cause derivation is timestamp-max over the candidates' own
// contributing changes.
import { describe, expect, it } from "vitest";
import {
  bufferCause,
  generationCandidates,
  groupCandidates,
  type BufferFactInput,
} from "@/lib/generationBuffer";
import type { GenerationPreviewInput } from "@/lib/generationPreview";

const TODAY = "2026-07-19";

function baseInput(overrides: Partial<GenerationPreviewInput> = {}): GenerationPreviewInput {
  return {
    today: TODAY,
    targets: [
      { groupId: "g1", payerId: "pay1", state: "NC", status: "active" },
      { groupId: "g1", payerId: "pay2", state: "NC", status: "active" },
    ],
    groupAssignments: [{ providerId: "prov1", groupId: "g1", endDate: null }],
    facilityAssignments: [{ providerId: "prov1", facilityId: "fac1" }],
    facilities: [{ id: "fac1", groupId: "g1" }],
    providers: [{ providerId: "prov1", providerName: "Dr. Chen" }],
    groups: [{ id: "g1", name: "Outer Banks Rehab Group" }],
    payers: [
      { id: "pay1", name: "Aetna" },
      { id: "pay2", name: "Cigna" },
    ],
    existingCases: [],
    exclusions: [],
    ...overrides,
  };
}

const liveFact = (payerId: string): BufferFactInput => ({
  providerId: "prov1",
  groupId: "g1",
  payerId,
  state: "NC",
  expiredAt: null,
});

describe("generationCandidates", () => {
  it("zero providers → zero candidates (day-1 board: targets exist, buffer empty)", () => {
    const input = baseInput({ groupAssignments: [], facilityAssignments: [], providers: [] });
    expect(generationCandidates(input, [])).toEqual([]);
  });

  it("an eligible provider yields one candidate per target", () => {
    const rows = generationCandidates(baseInput(), []);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.payerId).sort()).toEqual(["pay1", "pay2"]);
  });

  it("a LIVE enrollment fact suppresses its candidate; others survive", () => {
    const rows = generationCandidates(baseInput(), [liveFact("pay1")]);
    expect(rows.map((r) => r.payerId)).toEqual(["pay2"]);
  });

  it("an EXPIRED fact suppresses nothing — expiry re-opens the candidate immediately", () => {
    const rows = generationCandidates(baseInput(), [
      { ...liveFact("pay1"), expiredAt: "2026-07-10T00:00:00Z" },
    ]);
    expect(rows).toHaveLength(2);
  });

  it("existing cases and active exclusions never reach the buffer (preview subtraction)", () => {
    const input = baseInput({
      existingCases: [
        {
          id: "c1",
          providerId: "prov1",
          groupId: "g1",
          payerId: "pay1",
          state: "NC",
          statusLabel: "In Progress",
          actionBucket: "ours",
        },
      ],
      exclusions: [
        {
          id: "x1",
          providerId: "prov1",
          groupId: "g1",
          payerId: "pay2",
          state: "NC",
          status: "active",
          reason: "panel_closed",
          note: null,
        },
      ],
    });
    expect(generationCandidates(input, [])).toEqual([]);
  });

  it("groupCandidates slices one group's buffer", () => {
    const input = baseInput({
      targets: [
        { groupId: "g1", payerId: "pay1", state: "NC", status: "active" },
        { groupId: "g2", payerId: "pay1", state: "NC", status: "active" },
      ],
      groupAssignments: [
        { providerId: "prov1", groupId: "g1", endDate: null },
        { providerId: "prov1", groupId: "g2", endDate: null },
      ],
      facilityAssignments: [
        { providerId: "prov1", facilityId: "fac1" },
        { providerId: "prov1", facilityId: "fac2" },
      ],
      facilities: [
        { id: "fac1", groupId: "g1" },
        { id: "fac2", groupId: "g2" },
      ],
      groups: [
        { id: "g1", name: "Group One" },
        { id: "g2", name: "Group Two" },
      ],
    });
    const all = generationCandidates(input, []);
    expect(all).toHaveLength(2);
    expect(groupCandidates(all, "g2").map((r) => r.groupId)).toEqual(["g2"]);
  });
});

describe("bufferCause", () => {
  const causeBase = {
    assignments: [
      { providerId: "prov1", groupId: "g1", startDate: "2026-07-01", createdAt: "2026-06-20" },
    ],
    targets: [
      { groupId: "g1", payerId: "pay1", state: "NC", createdAt: "2026-06-01T00:00:00Z" },
      { groupId: "g1", payerId: "pay2", state: "NC", createdAt: "2026-06-01T00:00:00Z" },
    ],
    facts: [] as BufferFactInput[],
  };

  it("empty buffer → no cause", () => {
    expect(bufferCause([], causeBase)).toBeNull();
  });

  it("names the provider join when it is the newest contributing change", () => {
    const cause = bufferCause(generationCandidates(baseInput(), []), causeBase);
    expect(cause).toEqual({
      kind: "provider_joined",
      label: "Dr. Chen joined",
      date: "2026-07-01",
    });
  });

  it("a later payer attach beats the join date", () => {
    const cause = bufferCause(generationCandidates(baseInput(), []), {
      ...causeBase,
      targets: [
        { groupId: "g1", payerId: "pay1", state: "NC", createdAt: "2026-07-15T00:00:00Z" },
        { groupId: "g1", payerId: "pay2", state: "NC", createdAt: "2026-06-01T00:00:00Z" },
      ],
    });
    expect(cause?.kind).toBe("payer_attached");
    expect(cause?.label).toBe("Aetna attached");
  });

  it("an expired fact at a candidate key can be the newest cause (re-opened candidate)", () => {
    const facts: BufferFactInput[] = [
      {
        providerId: "prov1",
        groupId: "g1",
        payerId: "pay1",
        state: "NC",
        expiredAt: "2026-07-18T09:00:00Z",
      },
    ];
    const cause = bufferCause(generationCandidates(baseInput(), facts), {
      ...causeBase,
      facts,
    });
    expect(cause?.kind).toBe("fact_expired");
    expect(cause?.label).toBe("Aetna enrollment fact expired");
  });

  it("candidates with no dated inputs still explain themselves", () => {
    const cause = bufferCause(generationCandidates(baseInput(), []), {
      assignments: [],
      targets: [],
      facts: [],
    });
    expect(cause).toEqual({
      kind: "provider_joined",
      label: "Candidates awaiting review",
      date: null,
    });
  });
});
