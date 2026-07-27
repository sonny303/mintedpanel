import { describe, expect, it } from "vitest";
import {
  EMPTY_PAYER_FORM,
  addAlias,
  hasPayerFormErrors,
  isPayerDraftDirty,
  normalizeStates,
  payerDraftFromPayer,
  payerFormErrors,
  removeAlias,
  toPayerWriteInput,
  toggleState,
  type PayerFormDraft,
} from "@/lib/payerForm";
import type { Payer } from "@/types";

function payer(over: Partial<Payer> = {}): Payer {
  return {
    id: "p-1",
    orgId: null,
    name: "Aetna (CVS Health)",
    isActive: true,
    avgDecisionDays: null,
    createdAt: "2026-07-12T00:00:00Z",
    payerKind: "commercial",
    states: ["AZ", "CA"],
    aliases: ["Aetna"],
    status: "active",
    ...over,
  } as Payer;
}

const VALID: PayerFormDraft = {
  ...EMPTY_PAYER_FORM,
  name: "Banner Health Plans",
  payerKind: "medicare_advantage",
  states: ["AZ"],
};

describe("payerFormErrors", () => {
  it("a blank form names every required field", () => {
    const errors = payerFormErrors(EMPTY_PAYER_FORM);
    expect(hasPayerFormErrors(errors)).toBe(true);
    expect(errors.name).toBeDefined();
    expect(errors.payerKind).toBeDefined();
    expect(errors.states).toBeDefined();
  });

  it("a minimally complete form passes", () => {
    expect(payerFormErrors(VALID)).toEqual({});
    expect(hasPayerFormErrors(payerFormErrors(VALID))).toBe(false);
  });

  it("whitespace is not a name", () => {
    expect(payerFormErrors({ ...VALID, name: "   " }).name).toBeDefined();
  });

  it("a ticked ID expectation requires the payer's own label", () => {
    const group = payerFormErrors({ ...VALID, groupIdExpected: true });
    expect(group.groupIdLabel).toBeDefined();
    const provider = payerFormErrors({ ...VALID, providerIdExpected: true });
    expect(provider.providerIdLabel).toBeDefined();
    expect(
      payerFormErrors({
        ...VALID,
        groupIdExpected: true,
        groupIdLabel: "Group PIN",
        providerIdExpected: true,
        providerIdLabel: "Provider Number",
      }),
    ).toEqual({});
  });

  it("an unticked expectation never demands a label", () => {
    expect(payerFormErrors({ ...VALID, groupIdLabel: "", providerIdLabel: "" })).toEqual({});
  });
});

describe("normalizeStates / toggleState", () => {
  it("uppercases, de-duplicates, sorts, and drops junk", () => {
    expect(normalizeStates([" tx ", "az", "TX", "", "bad"])).toEqual(["AZ", "TX"]);
  });

  it("toggle adds normalized and removes exact", () => {
    expect(toggleState([], "co")).toEqual(["CO"]);
    expect(toggleState(["AZ", "CO"], "CO")).toEqual(["AZ"]);
    expect(toggleState(["CO"], "az")).toEqual(["AZ", "CO"]);
  });
});

describe("aliases", () => {
  it("adds trimmed values and ignores blanks", () => {
    expect(addAlias([], "  Aetna JV  ")).toEqual(["Aetna JV"]);
    expect(addAlias(["Aetna JV"], "   ")).toEqual(["Aetna JV"]);
  });

  it("de-duplicates case-insensitively", () => {
    expect(addAlias(["Aetna JV"], "aetna jv")).toEqual(["Aetna JV"]);
  });

  it("never lets an alias repeat the payer name", () => {
    expect(addAlias([], "Banner Health Plans", "banner health plans")).toEqual([]);
  });

  it("removes by exact value", () => {
    expect(removeAlias(["A", "B"], "A")).toEqual(["B"]);
  });
});

describe("payerDraftFromPayer", () => {
  it("hydrates identity, states, and aliases", () => {
    expect(payerDraftFromPayer(payer())).toMatchObject({
      name: "Aetna (CVS Health)",
      payerKind: "commercial",
      states: ["AZ", "CA"],
      aliases: ["Aetna"],
      delegationNote: "",
    });
  });

  it("reads the E6.7 ID pairs when present", () => {
    const draft = payerDraftFromPayer(
      payer({
        groupIdExpected: true,
        groupIdLabel: "Group PIN",
        providerIdExpected: true,
        providerIdLabel: "Provider Number",
      }),
    );
    expect(draft).toMatchObject({
      groupIdExpected: true,
      groupIdLabel: "Group PIN",
      providerIdExpected: true,
      providerIdLabel: "Provider Number",
    });
  });

  it("a NULL-column payer hydrates provider-EXPECTED with the generic label (the resolver default)", () => {
    // Every pre-E6.7 catalog row carries NULL in both expectation columns,
    // and the system-wide chain (resolveIdentifierConfig, mirrored by
    // set_case_status's COALESCE) treats that as EXPECTED. The form must
    // show what the close dialog will actually require.
    const draft = payerDraftFromPayer(
      payer({
        providerIdExpected: null,
        providerIdLabel: null,
        groupIdExpected: null,
        groupIdLabel: null,
        resolutionIdExpected: null,
        resolutionIdLabel: null,
      }),
    );
    expect(draft.providerIdExpected).toBe(true);
    expect(draft.providerIdLabel).toBe("Payer-issued ID");
    // The group chain defaults NOT expected — off, with no seeded label.
    expect(draft.groupIdExpected).toBe(false);
    expect(draft.groupIdLabel).toBe("");
  });

  it("round-trip: hydrate a NULL-column payer, change nothing, save — the effective expectation never regresses", () => {
    const draft = payerDraftFromPayer(
      payer({
        providerIdExpected: null,
        providerIdLabel: null,
        groupIdExpected: null,
        groupIdLabel: null,
        resolutionIdExpected: null,
        resolutionIdLabel: null,
      }),
    );
    // Valid as-hydrated: the seeded label satisfies the tick-⇒-name rule, so
    // the first edit of a legacy row is never blocked.
    expect(payerFormErrors(draft)).toEqual({});
    const input = toPayerWriteInput(draft);
    // The save MATERIALIZES the resolved config verbatim — never a flip to
    // false, never a dropped label (which would regress Approved-close +
    // Awaiting-ID for every org on the global row).
    expect(input.providerIdExpected).toBe(true);
    expect(input.providerIdLabel).toBe("Payer-issued ID");
    expect(input.groupIdExpected).toBe(false);
    expect(input.groupIdLabel).toBeNull();
  });

  it("falls back to the deprecated legacy pair for a pre-E6.7 payer", () => {
    const draft = payerDraftFromPayer(
      payer({ resolutionIdLabel: "Aetna PIN", resolutionIdExpected: true }),
    );
    expect(draft.providerIdExpected).toBe(true);
    expect(draft.providerIdLabel).toBe("Aetna PIN");
    // The group side has no legacy source — it defaults to "not issued".
    expect(draft.groupIdExpected).toBe(false);
  });

  it("a payer that GENUINELY issues nothing (explicit false, not NULL) hydrates both rows off", () => {
    const draft = payerDraftFromPayer(payer({ providerIdExpected: false, groupIdExpected: false }));
    expect(draft.groupIdExpected).toBe(false);
    expect(draft.providerIdExpected).toBe(false);
    // An off row never smuggles a label into the draft, even if columns
    // carry one.
    const off = payerDraftFromPayer(
      payer({ providerIdExpected: false, providerIdLabel: "Stale", groupIdExpected: false }),
    );
    expect(off.providerIdLabel).toBe("");
  });

  it("missing kind/states/aliases degrade to safe defaults", () => {
    const draft = payerDraftFromPayer(payer({ payerKind: undefined, states: null, aliases: null }));
    expect(draft).toMatchObject({ payerKind: "commercial", states: [], aliases: [] });
  });
});

describe("toPayerWriteInput", () => {
  it("trims and normalizes the payload", () => {
    const input = toPayerWriteInput({
      ...VALID,
      name: "  Banner Health Plans  ",
      states: ["az", "CA"],
      aliases: [" Banner ", "  "],
      delegationNote: "  Delegates to X  ",
    });
    expect(input).toEqual({
      name: "Banner Health Plans",
      payerKind: "medicare_advantage",
      states: ["AZ", "CA"],
      aliases: ["Banner"],
      groupIdExpected: false,
      groupIdLabel: null,
      providerIdExpected: false,
      providerIdLabel: null,
      delegationNote: "Delegates to X",
    });
  });

  it("carries a label only while its expectation is ticked", () => {
    const on = toPayerWriteInput({
      ...VALID,
      groupIdExpected: true,
      groupIdLabel: " Group PIN ",
      providerIdExpected: true,
      providerIdLabel: "Provider Number",
    });
    expect(on).toMatchObject({ groupIdLabel: "Group PIN", providerIdLabel: "Provider Number" });
    // Unticking CLEARS the stored label — the draft's leftover text never rides.
    const off = toPayerWriteInput({
      ...VALID,
      groupIdExpected: false,
      groupIdLabel: "Group PIN",
      providerIdExpected: false,
      providerIdLabel: "Provider Number",
    });
    expect(off).toMatchObject({
      groupIdExpected: false,
      groupIdLabel: null,
      providerIdExpected: false,
      providerIdLabel: null,
    });
  });

  it("a blank delegation note is NULL, never an empty string", () => {
    expect(toPayerWriteInput({ ...VALID, delegationNote: "   " }).delegationNote).toBeNull();
  });
});

describe("isPayerDraftDirty", () => {
  it("is false for an untouched hydration and true after any edit", () => {
    const original = payerDraftFromPayer(payer());
    expect(isPayerDraftDirty({ ...original }, original)).toBe(false);
    expect(isPayerDraftDirty({ ...original, name: "Aetna" }, original)).toBe(true);
    expect(isPayerDraftDirty({ ...original, states: ["AZ"] }, original)).toBe(true);
  });
});
