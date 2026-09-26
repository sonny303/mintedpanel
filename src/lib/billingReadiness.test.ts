import { describe, expect, it, vi } from "vitest";
import {
  billingFeedWindowStart,
  buildBillingFeed,
  buildNewlyBillableDigestCsv,
  evaluateBillingReadiness,
  filterBillingFeed,
  type BillingReadinessSnapshot,
} from "@/lib/billingReadiness";

const TODAY = "2026-09-25";

function readySnapshot(): BillingReadinessSnapshot {
  return {
    providers: [
      {
        id: "p1",
        firstName: "Ana",
        lastName: "Therapist",
        npi: "1234567893",
        taxonomyCode: "225100000X",
        status: "active",
        verificationState: "verified",
        isTestProvider: false,
      },
    ],
    groups: [
      { id: "g1", name: "North Clinic", tin: "12-3456789", npiType2: "1234567890", isActive: true },
    ],
    facilities: [{ id: "f1", name: "Boulder Clinic", groupId: "g1", state: "CO", isActive: true }],
    payers: [
      { id: "pay1", name: "Acme Health", status: "active", isActive: true, avgDecisionDays: 18 },
    ],
    groupMemberships: [{ providerId: "p1", groupId: "g1", startDate: "2025-01-01", endDate: null }],
    facilityAssignments: [{ providerId: "p1", facilityId: "f1", startDate: "2025-01-01" }],
    licenses: [
      {
        providerId: "p1",
        state: "CO",
        licenseNumber: "PT-123",
        licenseType: "full",
        status: "active",
        verifiedStatus: "verified",
        issueDate: "2020-01-01",
        expirationDate: "2027-01-01",
      },
    ],
    cases: [
      {
        id: "c1",
        providerId: "p1",
        groupId: "g1",
        payerId: "pay1",
        state: "CO",
        caseStatus: "approved",
        submittedDate: "2025-01-01",
        approvedDate: "2025-02-01",
        confirmedEffectiveDate: "2025-02-15",
        expectedEffectiveDate: null,
        terminationDate: null,
        createdAt: "2025-01-01T12:00:00.000Z",
      },
    ],
    caseFacilities: [
      {
        caseId: "c1",
        facilityId: "f1",
        createdAt: "2025-02-01T12:00:00.000Z",
        createdBy: "user-1",
      },
    ],
    statusTransitions: [
      {
        id: "sh1",
        caseId: "c1",
        fromStatus: "in_review",
        toStatus: "approved",
        actorKind: "user",
        changedAt: "2025-02-01T12:00:00.000Z",
      },
    ],
    legacyStatusTransitions: [],
  };
}

const selection = { providerId: "p1", facilityId: "f1", payerId: "pay1" };
const assess = (snapshot: BillingReadinessSnapshot, next: Partial<typeof selection> = {}) =>
  evaluateBillingReadiness(snapshot, { ...selection, ...next }, TODAY);

describe("billing readiness evaluator", () => {
  it("requires the full exact key and returns ready for complete current evidence", () => {
    const snapshot = readySnapshot();
    expect(assess(snapshot)).toMatchObject({
      status: "ready",
      label: "Billable Ready",
      state: "CO",
      retroEligibility: "Not recorded",
    });
    snapshot.cases[0].groupId = null;
    expect(assess(snapshot)?.status).toBe("stop");
  });

  it("rejects malformed assessment dates and unknown or missing current case status", () => {
    const snapshot = readySnapshot();
    expect(evaluateBillingReadiness(snapshot, selection, "2026-02-30")).toBeNull();
    snapshot.cases[0].caseStatus = null;
    expect(assess(snapshot)?.status).toBe("hold");
    snapshot.cases[0].caseStatus = "unknown-status";
    Object.assign(snapshot.cases[0], { credentialingStatusLabel: "In-Network" });
    expect(assess(snapshot)?.status).toBe("hold");
    snapshot.cases[0].caseStatus = "in_network";
    expect(assess(snapshot)?.status).toBe("ready");
  });

  it("uses facility group/state and requires current group membership, started assignment, and explicit case linkage", () => {
    const snapshot = readySnapshot();
    snapshot.facilities[0].state = "CA";
    expect(assess(snapshot)?.state).toBe("CA");
    expect(assess(snapshot)?.status).toBe("stop");
    snapshot.facilities[0].state = "CO";
    snapshot.groupMemberships[0].startDate = "2026-09-26";
    expect(assess(snapshot)?.status).toBe("hold");
    snapshot.groupMemberships[0].startDate = "2025-01-01";
    snapshot.groupMemberships[0].endDate = "2026-09-24";
    expect(assess(snapshot)?.status).toBe("hold");
    snapshot.groupMemberships[0].endDate = null;
    snapshot.facilityAssignments[0].startDate = "2026-09-26";
    expect(assess(snapshot)?.status).toBe("hold");
    snapshot.facilityAssignments[0].startDate = "2025-01-01";
    snapshot.caseFacilities = [];
    expect(assess(snapshot)?.status).toBe("hold");
  });

  it("honors effective-date and termination day boundaries and invalid dates", () => {
    const snapshot = readySnapshot();
    snapshot.cases[0].confirmedEffectiveDate = TODAY;
    expect(assess(snapshot)?.status).toBe("ready");
    snapshot.cases[0].confirmedEffectiveDate = "2026-09-26";
    expect(assess(snapshot)?.status).toBe("hold");
    snapshot.cases[0].confirmedEffectiveDate = "2026-02-30";
    expect(assess(snapshot)?.status).toBe("hold");
    snapshot.cases[0].confirmedEffectiveDate = "2025-02-15";
    snapshot.cases[0].terminationDate = TODAY;
    expect(assess(snapshot)?.status).toBe("stop");
    snapshot.cases[0].terminationDate = "2026-09-26";
    expect(assess(snapshot)?.status).toBe("ready");
    snapshot.cases[0].approvedDate = "2026-09-26";
    expect(assess(snapshot)?.status).toBe("hold");
  });

  it("requires an active verified valid license and fails closed on future, malformed, expired, or conflicting rows", () => {
    const snapshot = readySnapshot();
    snapshot.licenses[0].expirationDate = TODAY;
    expect(assess(snapshot)?.status).toBe("ready");
    snapshot.licenses[0].issueDate = "2026-09-26";
    expect(assess(snapshot)?.status).toBe("hold");
    snapshot.licenses[0].issueDate = "2020-01-01";
    snapshot.licenses.push({
      ...snapshot.licenses[0],
      licenseNumber: "PT-456",
      verifiedStatus: "failed",
    });
    expect(assess(snapshot)?.status).toBe("hold");
    snapshot.licenses = [snapshot.licenses[0]];
    snapshot.licenses[0].expirationDate = "2026-09-24";
    expect(assess(snapshot)?.status).toBe("stop");
    snapshot.licenses[0].verifiedStatus = "unverified";
    expect(assess(snapshot)?.status).toBe("hold");
    snapshot.licenses = [];
    expect(assess(snapshot)?.status).toBe("hold");
  });

  it("returns a labeled estimate only for a reached submitted date and never uses expected date as confirmed", () => {
    const snapshot = readySnapshot();
    snapshot.cases[0].caseStatus = "submitted";
    snapshot.cases[0].confirmedEffectiveDate = null;
    snapshot.cases[0].expectedEffectiveDate = "2027-01-01";
    snapshot.cases[0].submittedDate = "2026-09-01";
    expect(assess(snapshot)).toMatchObject({
      status: "hold",
      estimatedDecisionDate: "2026-09-19",
      confirmedEffectiveDate: null,
    });
    snapshot.cases[0].submittedDate = "2026-09-26";
    expect(assess(snapshot)?.estimatedDecisionDate).toBeNull();
  });

  it("keeps PTA on hold and lists only eligible same-facility PT candidates", () => {
    const snapshot = readySnapshot();
    snapshot.providers[0].taxonomyCode = "225200000X";
    snapshot.providers.push(
      {
        id: "pt-specialty",
        firstName: "Bea",
        lastName: "PT",
        npi: "1098765432",
        taxonomyCode: "2251X0800X",
        status: "active",
        verificationState: "verified",
        isTestProvider: false,
      },
      {
        id: "pt-inactive",
        firstName: "Cal",
        lastName: "Inactive",
        npi: null,
        taxonomyCode: "225100000X",
        status: "terminated",
        verificationState: "verified",
        isTestProvider: false,
      },
    );
    snapshot.groupMemberships.push({
      providerId: "pt-specialty",
      groupId: "g1",
      startDate: "2025-01-01",
      endDate: null,
    });
    snapshot.groupMemberships.push({
      providerId: "pt-inactive",
      groupId: "g1",
      startDate: "2025-01-01",
      endDate: null,
    });
    snapshot.facilityAssignments.push({
      providerId: "pt-specialty",
      facilityId: "f1",
      startDate: "2025-01-01",
    });
    snapshot.facilityAssignments.push({
      providerId: "pt-inactive",
      facilityId: "f1",
      startDate: "2025-01-01",
    });
    snapshot.licenses.push({ ...snapshot.licenses[0], providerId: "pt-specialty" });
    snapshot.licenses.push({ ...snapshot.licenses[0], providerId: "pt-inactive" });
    expect(assess(snapshot)).toMatchObject({
      status: "hold",
      isPta: true,
      reasons: expect.arrayContaining([
        expect.objectContaining({ label: expect.stringContaining("supervision is unverified") }),
      ]),
      supervisorCandidates: [{ providerId: "pt-specialty", taxonomyCode: "2251X0800X" }],
    });
    snapshot.providers[0].taxonomyCode = "224Z00000X";
    expect(assess(snapshot)).toMatchObject({ status: "hold", isOta: true });
  });
});

describe("billing change feed and digest", () => {
  it("excludes migration snapshot seeds while retaining recorded legacy approvals", () => {
    const snapshot = readySnapshot();
    snapshot.statusTransitions = [
      {
        id: "migration-seed",
        caseId: "c1",
        fromStatus: null,
        toStatus: "approved",
        actorKind: "system",
        changedAt: "2026-09-23T12:00:00.000Z",
      },
    ];
    snapshot.caseFacilities[0].createdAt = "2026-09-23T12:00:00.000Z";
    snapshot.caseFacilities[0].createdBy = null;
    snapshot.legacyStatusTransitions = [
      {
        id: "real-legacy-approval",
        caseId: "c1",
        track: "credentialing",
        toStatusLabel: "Approved",
        changedAt: "2026-09-24T12:00:00.000Z",
      },
    ];

    const feed = buildBillingFeed(snapshot, TODAY);
    expect(feed.filter((event) => event.kind === "approval")).toMatchObject([
      { title: "Enrollment approved (legacy record)", eventDate: "2026-09-24T12:00:00.000Z" },
    ]);
    expect(feed.some((event) => event.kind === "facility_added")).toBe(false);
    expect(buildNewlyBillableDigestCsv(snapshot, feed, TODAY).split("\r\n")).toHaveLength(2);
    snapshot.legacyStatusTransitions = [];
    const backfillOnlyFeed = buildBillingFeed(snapshot, TODAY);
    expect(backfillOnlyFeed).toHaveLength(0);
    expect(
      buildNewlyBillableDigestCsv(snapshot, backfillOnlyFeed, TODAY).split("\r\n"),
    ).toHaveLength(1);
  });

  it("uses local calendar boundaries for timestamp events and date-only warnings", () => {
    vi.stubEnv("TZ", "America/Denver");
    try {
      const snapshot = readySnapshot();
      snapshot.statusTransitions = [
        {
          id: "local-evening",
          caseId: "c1",
          fromStatus: "in_review",
          toStatus: "approved",
          actorKind: "user",
          changedAt: "2026-09-26T01:00:00.000Z", // Sep 25 at 7 p.m. MDT.
        },
        {
          id: "next-local-day",
          caseId: "c1",
          fromStatus: "in_review",
          toStatus: "approved",
          actorKind: "user",
          changedAt: "2026-09-26T06:00:00.000Z", // Sep 26 at midnight MDT.
        },
      ];
      snapshot.cases[0].terminationDate = TODAY;
      const feed = buildBillingFeed(snapshot, TODAY);
      const filtered = filterBillingFeed(feed, { range: 7 }, TODAY);
      expect(filtered.map((event) => event.id)).toContain(
        "approval:c1:f1:2026-09-26T01:00:00.000Z",
      );
      expect(filtered.map((event) => event.id)).not.toContain(
        "approval:c1:f1:2026-09-26T06:00:00.000Z",
      );
      expect(
        filtered.some((event) => event.kind === "termination" && event.eventDate === TODAY),
      ).toBe(true);

      const digestSnapshot = readySnapshot();
      digestSnapshot.statusTransitions = [snapshot.statusTransitions[0]];
      const digestEvents = filterBillingFeed(
        buildBillingFeed(digestSnapshot, TODAY),
        { range: 7 },
        TODAY,
      );
      const csv = buildNewlyBillableDigestCsv(digestSnapshot, digestEvents, TODAY);
      expect(csv.split("\r\n")[1]).toContain(',"2026-09-25","2026-09-25"');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("deduplicates matching legacy approvals, preserves distinct transitions, and labels date-derived events", () => {
    const snapshot = readySnapshot();
    snapshot.statusTransitions = [
      {
        id: "new",
        caseId: "c1",
        fromStatus: "in_review",
        toStatus: "approved",
        actorKind: "user",
        changedAt: "2026-09-24T12:00:00.000Z",
      },
      {
        id: "older",
        caseId: "c1",
        fromStatus: "in_review",
        toStatus: "approved",
        actorKind: "user",
        changedAt: "2026-09-20T12:00:00.000Z",
      },
    ];
    snapshot.legacyStatusTransitions = [
      {
        id: "legacy-duplicate",
        caseId: "c1",
        track: "credentialing",
        toStatusLabel: "In-Network",
        changedAt: "2026-09-24T12:00:00.000Z",
      },
      {
        id: "legacy-distinct",
        caseId: "c1",
        track: "credentialing",
        toStatusLabel: "In-Network",
        changedAt: "2026-09-21T12:00:00.000Z",
      },
    ];
    snapshot.caseFacilities[0].createdAt = "2026-09-22T12:00:00.000Z";
    snapshot.cases[0].terminationDate = "2026-09-23";
    snapshot.licenses[0].expirationDate = "2026-09-24";
    const feed = buildBillingFeed(snapshot, TODAY);
    expect(feed.filter((event) => event.kind === "approval")).toHaveLength(3);
    expect(feed[0].eventDate.slice(0, 10)).toBe("2026-09-25");
    expect(feed.some((event) => event.kind === "termination" && !event.recorded)).toBe(true);
    expect(
      feed.some(
        (event) =>
          event.kind === "license_expiration" && event.eventDate === TODAY && !event.recorded,
      ),
    ).toBe(true);
  });

  it("applies 7/30/90-day and facility/payer filters inclusively", () => {
    const snapshot = readySnapshot();
    snapshot.statusTransitions = [
      {
        id: "a",
        caseId: "c1",
        fromStatus: "in_review",
        toStatus: "approved",
        actorKind: "user",
        changedAt: "2026-09-19T12:00:00.000Z",
      },
      {
        id: "b",
        caseId: "c1",
        fromStatus: "in_review",
        toStatus: "approved",
        actorKind: "user",
        changedAt: "2026-08-27T12:00:00.000Z",
      },
      {
        id: "c",
        caseId: "c1",
        fromStatus: "in_review",
        toStatus: "approved",
        actorKind: "user",
        changedAt: "2026-06-27T12:00:00.000Z",
      },
    ];
    const feed = buildBillingFeed(snapshot, TODAY);
    expect(filterBillingFeed(feed, { range: 7 }, TODAY)).toHaveLength(1);
    expect(
      filterBillingFeed(feed, { range: 30, facilityId: "f1", payerId: "pay1" }, TODAY),
    ).toHaveLength(2);
    expect(filterBillingFeed(feed, { range: 90, facilityId: "other" }, TODAY)).toHaveLength(0);
    expect(billingFeedWindowStart(TODAY)).toBe("2026-06-28");
  });

  it("exports only currently ready matching approval/link events, once per case/facility, with formula-safe values", () => {
    const snapshot = readySnapshot();
    snapshot.providers[0].npi = '=HYPERLINK("bad")';
    const events = buildBillingFeed(snapshot, TODAY);
    events.push({
      ...events[0],
      id: "duplicate-event",
      kind: "facility_added",
      eventDate: "2026-09-24T12:00:00.000Z",
    });
    events.push({ ...events[0], id: "wrong-case", caseId: "other-case" });
    events.push({ ...events[0], id: "wrong-group", groupId: "other-group" });
    const csv = buildNewlyBillableDigestCsv(snapshot, events, TODAY);
    expect(csv.split("\r\n")).toHaveLength(2);
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    snapshot.cases[0].caseStatus = "denied";
    expect(buildNewlyBillableDigestCsv(snapshot, events, TODAY).split("\r\n")).toHaveLength(1);
  });
});
