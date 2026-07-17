import { describe, expect, it } from "vitest";
import { computePayerScorecard, type PayerScorecardInput } from "./payerScorecard";
import type {
  CredentialCase,
  FillSession,
  Portal,
  PortalFieldMap,
  StatusConfig,
  StatusHistoryEntry,
} from "@/types";

// --- typed factories (no `any`; only the fields under test vary) ---

function portal(over: Partial<Portal>): Portal {
  return {
    id: "portal",
    orgId: "org",
    portalKey: "k",
    name: "Portal",
    payerId: null,
    formUrl: null,
    isVerified: false,
    lastVerifiedAt: null,
    urlChangedAt: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function fieldMap(over: Partial<PortalFieldMap>): PortalFieldMap {
  return {
    id: "fm",
    orgId: "org",
    portalKey: "k",
    urlPattern: null,
    pageStep: null,
    mapType: "web",
    selector: "#x",
    selectorFallbacks: null,
    source: "token",
    token: "provider.firstName",
    hardcodedValue: null,
    transform: null,
    fieldType: "text",
    notes: null,
    status: "proposed",
    fieldLabel: null,
    formSection: null,
    confidence: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function credCase(over: Partial<CredentialCase>): CredentialCase {
  return {
    id: "c",
    orgId: "org",
    providerId: "prov",
    groupId: null,
    facilityId: null,
    payerId: "payer",
    state: "KS",
    specialty: null,
    credentialingStatusId: null,
    msoId: null,
    submittedDate: null,
    approvedDate: null,
    expectedEffectiveDate: null,
    confirmedEffectiveDate: null,
    terminationDate: null,
    assignedTo: null,
    createdBy: null,
    createdAt: "",
    updatedAt: "",
    caseEmailToken: "tok",
    payerReferenceId: null,
    payerPipelineState: "not_started",
    payerIndividualProviderId: null,
    payerGroupProviderId: null,
    ...over,
  };
}

function statusConfig(over: Partial<StatusConfig>): StatusConfig {
  return {
    id: "s",
    orgId: "org",
    track: "credentialing",
    label: "Status",
    color: "#000000",
    sortOrder: 0,
    requiredFields: [],
    actionBucket: "ours",
    createdAt: "",
    ...over,
  };
}

function history(over: Partial<StatusHistoryEntry>): StatusHistoryEntry {
  return {
    id: "h",
    orgId: "org",
    caseId: "c",
    contractId: null,
    track: "credentialing",
    fromStatusId: null,
    toStatusId: null,
    metadata: null,
    changedBy: null,
    changedAt: "2026-01-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function fill(over: Partial<FillSession>): FillSession {
  return {
    id: "f",
    orgId: "org",
    caseId: "c",
    providerId: null,
    portalKey: "k",
    fillMode: "web",
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: null,
    fieldsFilled: 0,
    fieldsSkipped: null,
    docsAttached: null,
    performedBy: null,
    ...over,
  };
}

function base(over: Partial<PayerScorecardInput> = {}): PayerScorecardInput {
  return {
    payerId: "payer",
    portals: [],
    fieldMaps: [],
    cases: [],
    statusConfigs: [],
    statusHistory: [],
    fillSessions: [],
    ...over,
  };
}

function indicator(input: PayerScorecardInput, key: string) {
  const found = computePayerScorecard(input).indicators.find((i) => i.key === key);
  if (!found) throw new Error(`missing indicator ${key}`);
  return found;
}

describe("computePayerScorecard", () => {
  it("returns the three indicators in a stable order", () => {
    const { indicators } = computePayerScorecard(base());
    expect(indicators.map((i) => i.key)).toEqual([
      "mapping_coverage",
      "first_pass_rate",
      "avg_time_in_bucket",
    ]);
  });

  describe("mapping coverage", () => {
    it("counts approved as mapped and proposed as the remainder over the payer's portals", () => {
      const input = base({
        portals: [portal({ portalKey: "aetna", payerId: "payer" })],
        fieldMaps: [
          fieldMap({ id: "1", portalKey: "aetna", status: "approved" }),
          fieldMap({ id: "2", portalKey: "aetna", status: "approved" }),
          fieldMap({ id: "3", portalKey: "aetna", status: "proposed" }),
          fieldMap({ id: "4", portalKey: "aetna", status: "retired" }), // excluded
        ],
      });
      const i = indicator(input, "mapping_coverage");
      expect(i.available).toBe(true);
      expect(i.numerator).toBe(2);
      expect(i.denominator).toBe(3);
      expect(i.ratio).toBeCloseTo(2 / 3);
    });

    it("ignores field maps for portals belonging to other payers", () => {
      const input = base({
        portals: [
          portal({ portalKey: "mine", payerId: "payer" }),
          portal({ portalKey: "theirs", payerId: "other" }),
        ],
        fieldMaps: [
          fieldMap({ id: "1", portalKey: "mine", status: "approved" }),
          fieldMap({ id: "2", portalKey: "theirs", status: "proposed" }),
          fieldMap({ id: "3", portalKey: "theirs", status: "approved" }),
        ],
      });
      const i = indicator(input, "mapping_coverage");
      expect(i.numerator).toBe(1);
      expect(i.denominator).toBe(1);
      expect(i.ratio).toBe(1);
    });

    it("degrades to n/a when the payer has no field maps", () => {
      const input = base({ portals: [portal({ portalKey: "mine", payerId: "payer" })] });
      const i = indicator(input, "mapping_coverage");
      expect(i.available).toBe(false);
      expect(i.ratio).toBeNull();
      expect(i.numerator).toBeNull();
      expect(i.denominator).toBeNull();
    });

    it("is n/a when only retired maps exist (denominator zero)", () => {
      const input = base({
        portals: [portal({ portalKey: "mine", payerId: "payer" })],
        fieldMaps: [fieldMap({ portalKey: "mine", status: "retired" })],
      });
      expect(indicator(input, "mapping_coverage").available).toBe(false);
    });
  });

  describe("first-pass submission rate", () => {
    it("counts single-fill cases as first-pass and multi-fill cases as not", () => {
      const input = base({
        cases: [
          credCase({ id: "c1", payerId: "payer" }),
          credCase({ id: "c2", payerId: "payer" }),
          credCase({ id: "c3", payerId: "payer" }),
        ],
        fillSessions: [
          fill({ id: "f1", caseId: "c1" }), // one fill -> first-pass
          fill({ id: "f2", caseId: "c2" }), // two fills -> re-fill
          fill({ id: "f3", caseId: "c2" }),
          // c3 never filled -> not counted either way
        ],
      });
      const i = indicator(input, "first_pass_rate");
      expect(i.available).toBe(true);
      expect(i.numerator).toBe(1); // c1
      expect(i.denominator).toBe(2); // c1, c2
      expect(i.ratio).toBe(0.5);
    });

    it("ignores fills on cases belonging to other payers", () => {
      const input = base({
        cases: [
          credCase({ id: "mine", payerId: "payer" }),
          credCase({ id: "theirs", payerId: "other" }),
        ],
        fillSessions: [
          fill({ id: "f1", caseId: "mine" }),
          fill({ id: "f2", caseId: "theirs" }),
          fill({ id: "f3", caseId: "theirs" }),
        ],
      });
      const i = indicator(input, "first_pass_rate");
      expect(i.numerator).toBe(1);
      expect(i.denominator).toBe(1);
      expect(i.ratio).toBe(1);
    });

    it("degrades to n/a when no fills exist for the payer's cases", () => {
      const input = base({ cases: [credCase({ id: "c1", payerId: "payer" })] });
      const i = indicator(input, "first_pass_rate");
      expect(i.available).toBe(false);
      expect(i.ratio).toBeNull();
    });
  });

  describe("avg time-in-bucket", () => {
    const ours = statusConfig({ id: "s-ours", actionBucket: "ours" });
    const waiting = statusConfig({ id: "s-wait", actionBucket: "waiting_payer" });
    const done = statusConfig({ id: "s-done", actionBucket: "complete" });
    const configs = [ours, waiting, done];

    it("averages durations between consecutive changes per bucket and overall", () => {
      // One case: entered `ours` at day 0, moved to `waiting` at day 2 (2d in ours),
      // moved to `complete` at day 12 (10d in waiting). The final `complete`
      // interval is still open and not counted.
      const input = base({
        cases: [credCase({ id: "c1", payerId: "payer" })],
        statusConfigs: configs,
        statusHistory: [
          history({
            id: "h1",
            caseId: "c1",
            toStatusId: "s-ours",
            changedAt: "2026-01-01T00:00:00Z",
          }),
          history({
            id: "h2",
            caseId: "c1",
            toStatusId: "s-wait",
            changedAt: "2026-01-03T00:00:00Z",
          }),
          history({
            id: "h3",
            caseId: "c1",
            toStatusId: "s-done",
            changedAt: "2026-01-13T00:00:00Z",
          }),
        ],
      });
      const i = indicator(input, "avg_time_in_bucket");
      expect(i.available).toBe(true);
      expect(i.buckets).toEqual([
        { bucket: "ours", avgDays: 2, intervals: 1 },
        { bucket: "waiting_payer", avgDays: 10, intervals: 1 },
      ]);
      expect(i.overallAvgDays).toBeCloseTo(6); // (2 + 10) / 2
    });

    it("averages the same bucket across intervals and cases", () => {
      // Two cases, each with two `ours` intervals of differing length.
      const input = base({
        cases: [credCase({ id: "c1", payerId: "payer" }), credCase({ id: "c2", payerId: "payer" })],
        statusConfigs: configs,
        statusHistory: [
          // c1: 2d in ours, then 4d in ours
          history({
            id: "a1",
            caseId: "c1",
            toStatusId: "s-ours",
            changedAt: "2026-01-01T00:00:00Z",
          }),
          history({
            id: "a2",
            caseId: "c1",
            toStatusId: "s-ours",
            changedAt: "2026-01-03T00:00:00Z",
          }),
          history({
            id: "a3",
            caseId: "c1",
            toStatusId: "s-wait",
            changedAt: "2026-01-07T00:00:00Z",
          }),
          // c2: 6d in ours
          history({
            id: "b1",
            caseId: "c2",
            toStatusId: "s-ours",
            changedAt: "2026-02-01T00:00:00Z",
          }),
          history({
            id: "b2",
            caseId: "c2",
            toStatusId: "s-wait",
            changedAt: "2026-02-07T00:00:00Z",
          }),
        ],
      });
      const i = indicator(input, "avg_time_in_bucket");
      // ours intervals: 2, 4, 6 -> avg 4 over 3 intervals
      expect(i.buckets).toEqual([{ bucket: "ours", avgDays: 4, intervals: 3 }]);
      expect(i.overallAvgDays).toBe(4);
    });

    it("sorts entries by time before differencing (out-of-order input)", () => {
      const input = base({
        cases: [credCase({ id: "c1", payerId: "payer" })],
        statusConfigs: configs,
        statusHistory: [
          history({
            id: "h2",
            caseId: "c1",
            toStatusId: "s-wait",
            changedAt: "2026-01-03T00:00:00Z",
          }),
          history({
            id: "h1",
            caseId: "c1",
            toStatusId: "s-ours",
            changedAt: "2026-01-01T00:00:00Z",
          }),
        ],
      });
      const i = indicator(input, "avg_time_in_bucket");
      expect(i.buckets).toEqual([{ bucket: "ours", avgDays: 2, intervals: 1 }]);
    });

    it("ignores unknown statuses, other tracks, and other payers' cases", () => {
      const input = base({
        cases: [credCase({ id: "c1", payerId: "payer" }), credCase({ id: "cx", payerId: "other" })],
        statusConfigs: configs,
        statusHistory: [
          // unknown status id -> the interval leaving it is skipped
          history({
            id: "h1",
            caseId: "c1",
            toStatusId: "s-unknown",
            changedAt: "2026-01-01T00:00:00Z",
          }),
          history({
            id: "h2",
            caseId: "c1",
            toStatusId: "s-ours",
            changedAt: "2026-01-02T00:00:00Z",
          }),
          history({
            id: "h3",
            caseId: "c1",
            toStatusId: "s-wait",
            changedAt: "2026-01-05T00:00:00Z",
          }),
          // contracting-track row on the same case is ignored
          history({
            id: "h4",
            caseId: "c1",
            track: "contracting",
            toStatusId: "s-ours",
            changedAt: "2026-01-06T00:00:00Z",
          }),
          // other payer's case is ignored
          history({
            id: "hx",
            caseId: "cx",
            toStatusId: "s-ours",
            changedAt: "2026-01-01T00:00:00Z",
          }),
          history({
            id: "hx2",
            caseId: "cx",
            toStatusId: "s-wait",
            changedAt: "2026-01-20T00:00:00Z",
          }),
        ],
      });
      const i = indicator(input, "avg_time_in_bucket");
      // Only the ours interval (day 2 -> day 5 = 3d) counts.
      expect(i.buckets).toEqual([{ bucket: "ours", avgDays: 3, intervals: 1 }]);
      expect(i.overallAvgDays).toBe(3);
    });

    it("degrades to n/a when status history is empty", () => {
      const input = base({
        cases: [credCase({ id: "c1", payerId: "payer" })],
        statusConfigs: configs,
        statusHistory: [],
      });
      const i = indicator(input, "avg_time_in_bucket");
      expect(i.available).toBe(false);
      expect(i.overallAvgDays).toBeNull();
      expect(i.buckets).toEqual([]);
    });

    it("degrades to n/a when status history is undefined (no reader)", () => {
      const input = base({
        cases: [credCase({ id: "c1", payerId: "payer" })],
        statusConfigs: configs,
        statusHistory: undefined,
      });
      expect(indicator(input, "avg_time_in_bucket").available).toBe(false);
    });

    it("does not count the single, still-open interval of a one-change case", () => {
      const input = base({
        cases: [credCase({ id: "c1", payerId: "payer" })],
        statusConfigs: configs,
        statusHistory: [
          history({
            id: "h1",
            caseId: "c1",
            toStatusId: "s-ours",
            changedAt: "2026-01-01T00:00:00Z",
          }),
        ],
      });
      expect(indicator(input, "avg_time_in_bucket").available).toBe(false);
    });
  });
});
