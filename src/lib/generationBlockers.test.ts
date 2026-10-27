// The Generate "not on this list" explanations and the pair lookup, built on
// the brief's scenario: one group in CO + KS, two Blues in KS (BCBS Kansas
// and Blue KC), a PT with clinics in both states and a PT in CO only.
import { describe, expect, it } from "vitest";
import {
  buildBlockerIndex,
  buildGenerationBlockers,
  diagnoseGenerationKey,
  scopeGenerationBlockers,
  type GenerationBlockerInput,
} from "./generationBlockers";
import { buildGenerationPreview, type GenerationPreviewInput } from "./generationPreview";

const TODAY = "2026-10-27";

const baseInput = (over: Partial<GenerationBlockerInput> = {}): GenerationBlockerInput => ({
  today: TODAY,
  targets: [
    { groupId: "g1", payerId: "bcbs-ks", state: "KS", status: "active" },
    { groupId: "g1", payerId: "blue-kc", state: "KS", status: "active" },
    { groupId: "g1", payerId: "aetna", state: "CO", status: "active" },
    { groupId: "g1", payerId: "medicaid-co", state: "CO", status: "active" },
  ],
  payers: [
    { id: "bcbs-ks", name: "BCBS Kansas", states: ["KS"] },
    { id: "blue-kc", name: "Blue KC", states: ["KS", "MO"] },
    { id: "aetna", name: "Aetna", states: ["CO", "KS", "TX"] },
    { id: "medicaid-co", name: "Colorado Medicaid", states: ["CO"] },
  ],
  groups: [{ id: "g1", name: "Shelby PT", states: ["CO", "KS"] }],
  groupAssignments: [
    { providerId: "taylor", groupId: "g1" },
    { providerId: "casey", groupId: "g1" },
  ],
  facilityAssignments: [
    { providerId: "taylor", facilityId: "f-co" },
    { providerId: "taylor", facilityId: "f-ks" },
    { providerId: "casey", facilityId: "f-co" },
  ],
  facilities: [
    { id: "f-co", groupId: "g1", state: "CO" },
    { id: "f-ks", groupId: "g1", state: "KS" },
  ],
  licenses: [],
  roster: [
    {
      providerId: "taylor",
      providerName: "Taylor Example",
      pendingVerification: false,
      skipEligible: true,
    },
    {
      providerId: "casey",
      providerName: "Casey Example",
      pendingVerification: false,
      skipEligible: true,
    },
  ],
  ...over,
});

const key = (providerId: string, payerId: string, state: string, groupId = "g1") => ({
  providerId,
  groupId,
  payerId,
  state,
});

const previewInputFrom = (input: GenerationBlockerInput): GenerationPreviewInput => ({
  today: input.today,
  targets: input.targets,
  groupAssignments: input.groupAssignments,
  facilityAssignments: input.facilityAssignments,
  facilities: input.facilities,
  licenses: input.licenses,
  providers: input.roster.map((p) => ({ providerId: p.providerId, providerName: p.providerName })),
  groups: input.groups.map((g) => ({ id: g.id, name: g.name })),
  payers: input.payers.map((p) => ({ id: p.id, name: p.name })),
  existingCases: [],
  exclusions: [],
});

describe("diagnoseGenerationKey — one exact key, first missing link", () => {
  it("lets both Blues through for the provider with a Kansas clinic", () => {
    const index = buildBlockerIndex(baseInput());
    expect(diagnoseGenerationKey(index, key("taylor", "bcbs-ks", "KS"))).toBeNull();
    expect(diagnoseGenerationKey(index, key("taylor", "blue-kc", "KS"))).toBeNull();
  });

  it("names the missing Kansas clinic for a Colorado-only provider", () => {
    const block = diagnoseGenerationKey(
      buildBlockerIndex(baseInput()),
      key("casey", "bcbs-ks", "KS"),
    );
    expect(block?.reason).toBe("out_of_state");
    expect(block?.message).toBe("Casey Example has no clinic or license in KS.");
    expect(block?.fix).toEqual({ kind: "provider", providerId: "casey" });
  });

  it("treats a license in the state as a footprint (the preview's rule)", () => {
    const index = buildBlockerIndex(
      baseInput({ licenses: [{ providerId: "casey", state: "KS" }] }),
    );
    expect(diagnoseGenerationKey(index, key("casey", "bcbs-ks", "KS"))).toBeNull();
  });

  it("names a missing target when payer and group both cover the state", () => {
    const block = diagnoseGenerationKey(
      buildBlockerIndex(baseInput()),
      key("taylor", "aetna", "KS"),
    );
    expect(block?.reason).toBe("no_target");
    expect(block?.message).toBe("Shelby PT isn't set up with Aetna in KS.");
    expect(block?.fix).toEqual({ kind: "groupPayers", groupId: "g1" });
  });

  it("names the group's operating states when the state is missing there", () => {
    const index = buildBlockerIndex(
      baseInput({ groups: [{ id: "g1", name: "Shelby PT", states: ["CO"] }] }),
    );
    const block = diagnoseGenerationKey(index, key("taylor", "aetna", "KS"));
    expect(block?.reason).toBe("group_state");
    expect(block?.fix).toEqual({ kind: "groupFacts", groupId: "g1" });
  });

  it("names the payer's states before the group's when the payer doesn't list it", () => {
    const index = buildBlockerIndex(
      baseInput({ groups: [{ id: "g1", name: "Shelby PT", states: ["CO"] }] }),
    );
    const block = diagnoseGenerationKey(index, key("taylor", "medicaid-co", "KS"));
    expect(block?.reason).toBe("payer_state");
    expect(block?.message).toBe("Colorado Medicaid doesn't list KS in its states.");
  });

  it("names an archived target", () => {
    const index = buildBlockerIndex(
      baseInput({
        targets: [
          ...baseInput().targets,
          { groupId: "g1", payerId: "aetna", state: "KS", status: "archived" },
        ],
      }),
    );
    expect(diagnoseGenerationKey(index, key("taylor", "aetna", "KS"))?.reason).toBe(
      "target_archived",
    );
  });

  it("lets an active target win even when the group's states no longer list it", () => {
    const index = buildBlockerIndex(
      baseInput({ groups: [{ id: "g1", name: "Shelby PT", states: ["CO"] }] }),
    );
    expect(diagnoseGenerationKey(index, key("taylor", "bcbs-ks", "KS"))).toBeNull();
  });

  it("names an archived payer, and a merged payer's successor", () => {
    const index = buildBlockerIndex(
      baseInput({
        payers: [
          ...baseInput().payers.filter((p) => p.id !== "bcbs-ks"),
          { id: "bcbs-ks", name: "BCBS Kansas", states: ["KS"], archivedAt: "2026-10-01" },
          { id: "bcbs", name: "BCBS", states: ["KS"], status: "merged", mergedIntoId: "blue-kc" },
        ],
      }),
    );
    const archived = diagnoseGenerationKey(index, key("taylor", "bcbs-ks", "KS"));
    expect(archived?.reason).toBe("payer_archived");
    expect(archived?.fix).toEqual({
      kind: "payerSetup",
      payerId: "bcbs-ks",
      tab: "manage",
      edit: false,
    });
    const merged = diagnoseGenerationKey(index, key("taylor", "bcbs", "KS"));
    expect(merged?.reason).toBe("payer_unavailable");
    expect(merged?.message).toContain("merged into Blue KC");
  });

  it("checks the provider before anything else", () => {
    const index = buildBlockerIndex(
      baseInput({
        roster: [
          {
            providerId: "taylor",
            providerName: "Taylor Example",
            pendingVerification: true,
            skipEligible: true,
          },
          {
            providerId: "casey",
            providerName: "Casey Example",
            pendingVerification: false,
            skipEligible: false,
          },
        ],
      }),
    );
    expect(diagnoseGenerationKey(index, key("taylor", "bcbs-ks", "KS"))?.reason).toBe(
      "pending_verification",
    );
    expect(diagnoseGenerationKey(index, key("casey", "bcbs-ks", "KS"))?.reason).toBe(
      "provider_inactive",
    );
    expect(diagnoseGenerationKey(index, key("nobody", "bcbs-ks", "KS"))?.reason).toBe(
      "provider_inactive",
    );
  });

  it("names group membership and the missing clinic assignment", () => {
    const index = buildBlockerIndex(
      baseInput({
        groupAssignments: [
          { providerId: "taylor", groupId: "g1", endDate: "2026-01-01" },
          { providerId: "casey", groupId: "g1" },
        ],
        facilityAssignments: [],
      }),
    );
    expect(diagnoseGenerationKey(index, key("taylor", "bcbs-ks", "KS"))?.reason).toBe(
      "not_in_group",
    );
    expect(diagnoseGenerationKey(index, key("casey", "bcbs-ks", "KS"))?.reason).toBe("no_facility");
  });

  it("agrees with the preview: a key with no block is exactly a preview row", () => {
    const input = baseInput({ licenses: [{ providerId: "casey", state: "TX" }] });
    const index = buildBlockerIndex(input);
    const rows = new Set(
      buildGenerationPreview(previewInputFrom(input)).map(
        (r) => `${r.providerId}|${r.groupId}|${r.payerId}|${r.state}`,
      ),
    );
    for (const providerId of ["taylor", "casey"]) {
      for (const t of input.targets) {
        const k = key(providerId, t.payerId, t.state);
        const passes = diagnoseGenerationKey(index, k) === null;
        expect(passes).toBe(rows.has(`${providerId}|g1|${t.payerId}|${t.state}`));
      }
    }
  });
});

describe("buildGenerationBlockers — the page's 'not on this list' section", () => {
  it("folds a provider's out-of-state targets into one line", () => {
    const input = baseInput();
    const { outOfState } = buildGenerationBlockers(buildBlockerIndex(input), input.targets);
    expect(outOfState).toHaveLength(1);
    expect(outOfState[0]).toMatchObject({
      providerId: "casey",
      states: ["KS"],
      payerNames: ["BCBS Kansas", "Blue KC"],
    });
    expect(outOfState[0]?.block.message).toBe("Casey Example has no clinic or license in KS.");
    expect(outOfState[0]?.keys).toHaveLength(2);
  });

  it("lists a missing target for a payer the group already works with", () => {
    const input = baseInput();
    const { setup } = buildGenerationBlockers(buildBlockerIndex(input), input.targets);
    // Aetna covers KS, the group has a KS clinic, no Aetna-KS target.
    // Colorado Medicaid doesn't list KS, so it is not expected there.
    expect(setup.map((s) => `${s.payerName} ${s.state} ${s.block.reason}`)).toEqual([
      "Aetna KS no_target",
    ]);
    expect(setup[0]?.providerNames).toEqual(["Taylor Example"]);
  });

  it("reports the group's operating states when that is the gap", () => {
    const input = baseInput({ groups: [{ id: "g1", name: "Shelby PT", states: ["CO"] }] });
    const { setup } = buildGenerationBlockers(buildBlockerIndex(input), input.targets);
    expect(setup.map((s) => s.block.reason)).toEqual(["group_state"]);
  });

  it("lists an archived payer's active targets instead of dropping them", () => {
    const input = baseInput({
      payers: [
        ...baseInput().payers.filter((p) => p.id !== "blue-kc"),
        { id: "blue-kc", name: "Blue KC", states: ["KS", "MO"], archivedAt: "2026-10-01" },
      ],
    });
    const blockers = buildGenerationBlockers(buildBlockerIndex(input), input.targets);
    expect(blockers.archivedPayers).toMatchObject([{ payerName: "Blue KC", states: ["KS"] }]);
    // Its targets are not counted as out-of-state or setup gaps too.
    expect(blockers.outOfState[0]?.payerNames).toEqual(["BCBS Kansas"]);
  });

  it("never repeats what buildGenerationSkips already names", () => {
    const input = baseInput({
      roster: [
        {
          providerId: "taylor",
          providerName: "Taylor Example",
          pendingVerification: false,
          skipEligible: true,
        },
        {
          providerId: "casey",
          providerName: "Casey Example",
          pendingVerification: true,
          skipEligible: true,
        },
      ],
    });
    const { outOfState } = buildGenerationBlockers(buildBlockerIndex(input), input.targets);
    expect(outOfState).toEqual([]);
  });

  it("every listed key diagnoses to the same reason as the lookup", () => {
    const input = baseInput();
    const index = buildBlockerIndex(input);
    const blockers = buildGenerationBlockers(index, input.targets);
    for (const entry of blockers.outOfState) {
      for (const k of entry.keys) {
        expect(diagnoseGenerationKey(index, k)?.reason).toBe("out_of_state");
      }
    }
    for (const entry of blockers.setup) {
      for (const providerId of entry.providerIds) {
        expect(
          diagnoseGenerationKey(index, key(providerId, entry.payerId, entry.state, entry.groupId))
            ?.reason,
        ).toBe(entry.block.reason);
      }
    }
  });
});

describe("scopeGenerationBlockers", () => {
  const input = baseInput();
  const blockers = buildGenerationBlockers(buildBlockerIndex(input), input.targets);

  it("narrows by payer, rewriting the folded line", () => {
    const scoped = scopeGenerationBlockers(blockers, { payerId: "blue-kc" });
    expect(scoped.outOfState[0]?.payerNames).toEqual(["Blue KC"]);
    expect(scoped.outOfState[0]?.keys).toHaveLength(1);
    expect(scoped.setup).toEqual([]);
  });

  it("narrows by provider and by facility", () => {
    expect(scopeGenerationBlockers(blockers, { providerId: "taylor" }).outOfState).toEqual([]);
    const facilities = new Map([
      ["taylor", new Set(["f-co", "f-ks"])],
      ["casey", new Set(["f-co"])],
    ]);
    const atKs = scopeGenerationBlockers(blockers, { facilityId: "f-ks" }, facilities);
    expect(atKs.outOfState).toEqual([]);
    expect(atKs.setup.map((s) => s.providerNames)).toEqual([["Taylor Example"]]);
  });

  it("narrows by group", () => {
    const other = scopeGenerationBlockers(blockers, { groupId: "g2" });
    expect(other).toEqual({ outOfState: [], setup: [], archivedPayers: [] });
  });
});
