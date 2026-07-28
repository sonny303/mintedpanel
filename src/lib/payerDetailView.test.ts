import { describe, expect, it } from "vitest";
import {
  PAYER_DETAIL_TABS,
  buildPayerCaseRows,
  buildPayerEnrollmentRows,
  parsePayerDetailTab,
  payerMergeCandidates,
  payerTemplateRows,
  templateIntentForNextAction,
  templateNextStep,
  templateStateCoverage,
  type PayerCaseSlice,
  type PayerEnrollmentCaseSlice,
} from "@/lib/payerDetailView";
import { TEMPLATE_EDITOR_INTENTS } from "@/lib/templateEditorIntent";
import type { EnrollmentFact, Payer, SOPTemplate } from "@/types";

const PAYER_ID = "p-1";
const OTHER_PAYER = "p-2";

function payer(over: Partial<Payer> = {}): Payer {
  return {
    id: PAYER_ID,
    orgId: null,
    name: "Aetna (CVS Health)",
    isActive: true,
    avgDecisionDays: null,
    createdAt: "2026-07-12T00:00:00Z",
    payerKind: "commercial",
    states: ["AZ"],
    status: "active",
    ...over,
  } as Payer;
}

function fact(over: Partial<EnrollmentFact> = {}): EnrollmentFact {
  return {
    id: "f-1",
    orgId: "o-1",
    providerId: "prov-1",
    groupId: "g-1",
    payerId: PAYER_ID,
    state: "AZ",
    effectiveDate: "2026-05-01",
    payerIssuedId: "PIN-1",
    expiredAt: null,
    createdAt: "2026-05-01T00:00:00Z",
    ...over,
  } as EnrollmentFact;
}

function caseRow(over: Partial<PayerEnrollmentCaseSlice & PayerCaseSlice> = {}) {
  return {
    id: "c-1",
    providerId: "prov-2",
    payerId: PAYER_ID,
    state: "AZ",
    caseStatus: "approved",
    confirmedEffectiveDate: "2026-06-01",
    payerIndividualProviderId: "PRV-9",
    caseNumber: 1042,
    ...over,
  } as PayerEnrollmentCaseSlice & PayerCaseSlice;
}

const NAMES = new Map([
  ["prov-1", "Ada Provider"],
  ["prov-2", "Boone Provider"],
]);

describe("tabs", () => {
  it("carries the six designed tabs and defaults unknown values to overview", () => {
    expect(PAYER_DETAIL_TABS).toEqual([
      "overview",
      "enrollments",
      "cases",
      "templates",
      "scorecard",
      "manage",
    ]);
    expect(parsePayerDetailTab("manage")).toBe("manage");
    expect(parsePayerDetailTab("nope")).toBe("overview");
    expect(parsePayerDetailTab(undefined)).toBe("overview");
  });
});

describe("template intent mapping", () => {
  it("maps every form-setup action to a REAL Template Editor intent", () => {
    // Spelling drift here breaks the deep link silently, so assert against
    // Slice F's shipped union rather than string literals alone.
    for (const action of [
      "register_portal",
      "train_mappings",
      "repair_drift",
      "run_dry_test",
    ] as const) {
      const intent = templateIntentForNextAction(action);
      expect(intent).not.toBeNull();
      expect(TEMPLATE_EDITOR_INTENTS).toContain(intent);
    }
    expect(templateIntentForNextAction("register_portal")).toBe("register");
    expect(templateIntentForNextAction("train_mappings")).toBe("train");
    expect(templateIntentForNextAction("repair_drift")).toBe("repair");
    expect(templateIntentForNextAction("run_dry_test")).toBe("prove");
  });

  it("authoring and ready carry no intent", () => {
    expect(templateIntentForNextAction("author_sop")).toBeNull();
    expect(templateIntentForNextAction("ready")).toBeNull();
  });

  it("templateNextStep carries label, ladder position, target and intent", () => {
    expect(templateNextStep({ nextAction: "repair_drift", sopTemplateId: "t-1" })).toEqual({
      action: "repair_drift",
      label: "Repair drift",
      position: "Form setup · drift",
      templateId: "t-1",
      intent: "repair",
    });
    expect(templateNextStep({ nextAction: "author_sop", sopTemplateId: null })).toMatchObject({
      label: "Author template",
      templateId: null,
      intent: null,
    });
  });
});

describe("payerTemplateRows", () => {
  const tpl = (over: Partial<SOPTemplate>): SOPTemplate =>
    ({
      id: "t",
      orgId: null,
      name: "T",
      groupId: null,
      state: "AZ",
      specialty: null,
      payerId: PAYER_ID,
      taskDefinitions: [{ title: "a", steps: [] }],
      isArchived: false,
      archived: false,
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-02T00:00:00Z",
      ...over,
    }) as SOPTemplate;

  it("keeps this payer's live rows, group-scoped first", () => {
    const rows = payerTemplateRows(
      [
        tpl({ id: "t-any", name: "Any group", groupId: null }),
        tpl({ id: "t-grp", name: "Group scoped", groupId: "g-1" }),
        tpl({ id: "t-arch", name: "Archived", archived: true }),
        tpl({ id: "t-other", name: "Other payer", payerId: OTHER_PAYER }),
      ],
      PAYER_ID,
    );
    expect(rows.map((r) => r.id)).toEqual(["t-grp", "t-any"]);
    expect(rows[0]).toMatchObject({ taskCount: 1, state: "AZ" });
  });

  it("flags the row the LOCKED resolver actually runs — an org override shadows the global row on the same key", () => {
    const rows = payerTemplateRows(
      [
        tpl({ id: "t-global", name: "Global", orgId: null, groupId: null }),
        tpl({ id: "t-org", name: "Org override", orgId: "o-1", groupId: null }),
      ],
      PAYER_ID,
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("t-org")?.isActiveMatch).toBe(true);
    expect(byId.get("t-global")?.isActiveMatch).toBe(false);
  });

  it("a legacy state-less row is never an active match (pickTemplate needs an exact state)", () => {
    const rows = payerTemplateRows([tpl({ id: "t-nostate", state: null })], PAYER_ID);
    expect(rows[0].isActiveMatch).toBe(false);
  });
});

describe("templateStateCoverage", () => {
  const row = (state: string | null, id = state ?? "none") => ({
    id,
    name: id,
    state,
    groupId: null,
    taskCount: 1,
    updatedAt: "",
    isActiveMatch: true,
  });

  it("counts only the payer's own states and reads as a sentence", () => {
    const coverage = templateStateCoverage(payer({ states: ["AZ", "CO", "NV"] }), [
      row("AZ"),
      row("CO"),
      // Out of footprint — must never inflate coverage past the total.
      row("TX"),
    ]);
    expect(coverage).toEqual({ covered: 2, total: 3, label: "2 of 3 states covered" });
  });

  it("stays silent for a single-state payer (nothing to compare)", () => {
    expect(templateStateCoverage(payer({ states: ["AZ"] }), [row("AZ")]).label).toBe("");
    expect(templateStateCoverage(null, []).label).toBe("");
  });

  it("a state-less template covers nothing", () => {
    expect(templateStateCoverage(payer({ states: ["AZ", "CO"] }), [row(null)])).toMatchObject({
      covered: 0,
      label: "0 of 2 states covered",
    });
  });
});

describe("buildPayerEnrollmentRows", () => {
  it("carries live facts and APPROVED cases, sorted by provider", () => {
    const rows = buildPayerEnrollmentRows(PAYER_ID, payer(), [fact()], [caseRow()], NAMES);
    expect(rows.map((r) => r.key)).toEqual(["fact:f-1", "case:c-1"]);
    expect(rows[0]).toMatchObject({ providerName: "Ada Provider", source: "fact" });
    expect(rows[1]).toMatchObject({ caseId: "c-1", caseNumber: 1042, source: "case" });
  });

  it("excludes other payers, expired facts, and non-approved cases", () => {
    const rows = buildPayerEnrollmentRows(
      PAYER_ID,
      payer(),
      [
        fact({ id: "f-other", payerId: OTHER_PAYER }),
        fact({ id: "f-expired", expiredAt: "2026-07-01T00:00:00Z" }),
      ],
      [
        caseRow({ id: "c-open", caseStatus: "in_progress" }),
        caseRow({ id: "c-x", payerId: OTHER_PAYER }),
      ],
      NAMES,
    );
    expect(rows).toEqual([]);
  });

  it("renders the captured value under the payer's own label", () => {
    const rows = buildPayerEnrollmentRows(
      PAYER_ID,
      payer({ providerIdExpected: true, providerIdLabel: "Provider Number" }),
      [],
      [caseRow()],
      NAMES,
    );
    expect(rows[0].badge).toEqual({ kind: "value", label: "Provider Number", value: "PRV-9" });
  });

  it("a NULL-column payer with no captured ID reads Awaiting ID (resolver default is EXPECTED)", () => {
    const rows = buildPayerEnrollmentRows(
      PAYER_ID,
      payer({ providerIdExpected: null, providerIdLabel: null }),
      [],
      [caseRow({ payerIndividualProviderId: null })],
      NAMES,
    );
    expect(rows[0].badge).toEqual({ kind: "awaiting", label: "Payer-issued ID" });
  });

  it("a payer that issues nothing shows the honest not-issued state", () => {
    const rows = buildPayerEnrollmentRows(
      PAYER_ID,
      payer({ providerIdExpected: false }),
      [],
      [caseRow({ payerIndividualProviderId: null })],
      NAMES,
    );
    expect(rows[0].badge).toEqual({ kind: "not_issued" });
  });

  it("an unknown provider id degrades to a label, never a crash", () => {
    const rows = buildPayerEnrollmentRows(
      PAYER_ID,
      payer(),
      [fact({ providerId: "ghost" })],
      [],
      NAMES,
    );
    expect(rows[0].providerName).toBe("Unknown provider");
  });
});

describe("buildPayerCaseRows", () => {
  it("keeps this payer's OPEN cases, newest case number first", () => {
    const rows = buildPayerCaseRows(
      PAYER_ID,
      [
        caseRow({ id: "c-open-1", caseStatus: "submitted", caseNumber: 1001 }),
        caseRow({ id: "c-open-2", caseStatus: "in_review", caseNumber: 1009 }),
        caseRow({ id: "c-done", caseStatus: "approved", caseNumber: 1010 }),
        caseRow({ id: "c-other", caseStatus: "submitted", payerId: OTHER_PAYER }),
      ],
      NAMES,
    );
    expect(rows.map((r) => r.id)).toEqual(["c-open-2", "c-open-1"]);
  });

  it("defaults a missing pipeline state instead of rendering undefined", () => {
    const rows = buildPayerCaseRows(
      PAYER_ID,
      [caseRow({ caseStatus: "not_started", payerPipelineState: undefined })],
      NAMES,
    );
    expect(rows[0].pipelineState).toBe("not_started");
  });
});

describe("payerMergeCandidates", () => {
  it("offers every other ACTIVE, non-archived payer", () => {
    const candidates = payerMergeCandidates(
      [
        payer(),
        payer({ id: "p-b", name: "Banner" }),
        payer({ id: "p-arch", name: "Archived", archivedAt: "2026-07-25T00:00:00Z" }),
        payer({ id: "p-merged", name: "Merged", status: "merged" }),
        payer({ id: "p-retired", name: "Retired", status: "retired" }),
      ],
      PAYER_ID,
    );
    expect(candidates.map((p) => p.id)).toEqual(["p-b"]);
  });
});
