// E6.0 — unit tests for the canonical case-status machine: the closed
// eight-value list, edge legality (forward spine + RFI return + terminals +
// reapply, backwards only via correction), the F6.0.3 Add-touch suggestion
// rule table, the TS-104 deterministic legacy migration mapping over EVERY
// (credentialing label × pipeline state) pair, and the transition-shim
// mirrors the RPC keeps in lockstep.
import { describe, expect, it } from "vitest";
import {
  CASE_STATUSES,
  CASE_STATUS_BUCKETS,
  CASE_STATUS_LABELS,
  LEGACY_CREDENTIALING_MIRROR,
  OPEN_CASE_STATUSES,
  PIPELINE_STATE_MIRROR,
  TERMINAL_CASE_STATUSES,
  allowedCaseStatusTransitions,
  canSetCaseStatus,
  caseStatusLabel,
  isCaseStatus,
  isOpenCaseStatus,
  isReapplyCaseTransition,
  isTerminalCaseStatus,
  mapLegacyCaseStatus,
  suggestStatusBump,
  type CaseStatus,
} from "./caseStatus";
import { PAYER_PIPELINE_STATES } from "./payerPipeline";
import { CANONICAL_STATUSES } from "./canonicalStatuses";
import {
  APPROVED_LABEL,
  DENIED_LABEL,
  IN_NETWORK_LABEL,
  IN_PROGRESS_LABEL,
  NOT_REQUIRED_LABEL,
  NOT_STARTED_LABEL,
  OON_LABEL,
  SUBMITTED_LABEL,
  WAITING_ON_PROVIDER_LABEL,
} from "./statusLabels";

describe("case status — vocabulary", () => {
  it("is the closed eight-value list, each with a label and a bucket", () => {
    expect(CASE_STATUSES).toHaveLength(8);
    expect(new Set(CASE_STATUSES).size).toBe(8);
    for (const s of CASE_STATUSES) {
      expect(caseStatusLabel(s)).toBe(CASE_STATUS_LABELS[s]);
      expect(caseStatusLabel(s).length).toBeGreaterThan(0);
      expect(CASE_STATUS_BUCKETS[s]).toBeDefined();
    }
  });

  it("splits exactly into five open + three terminal statuses", () => {
    expect(OPEN_CASE_STATUSES).toHaveLength(5);
    expect(TERMINAL_CASE_STATUSES).toEqual(["approved", "denied", "not_pursuing"]);
    for (const s of CASE_STATUSES) {
      expect(isOpenCaseStatus(s)).toBe(!isTerminalCaseStatus(s));
    }
  });

  it("guards unknown values", () => {
    expect(isCaseStatus("submitted")).toBe(true);
    expect(isCaseStatus("oon")).toBe(false);
    expect(isCaseStatus("drafting")).toBe(false);
    expect(isCaseStatus(null)).toBe(false);
    expect(isCaseStatus(3)).toBe(false);
  });

  it("open statuses bucket open; terminals bucket complete", () => {
    for (const s of OPEN_CASE_STATUSES) {
      expect(CASE_STATUS_BUCKETS[s]).not.toBe("complete");
    }
    for (const s of TERMINAL_CASE_STATUSES) {
      expect(CASE_STATUS_BUCKETS[s]).toBe("complete");
    }
    expect(CASE_STATUS_BUCKETS.submitted).toBe("waiting_payer");
    expect(CASE_STATUS_BUCKETS.in_review).toBe("waiting_payer");
    expect(CASE_STATUS_BUCKETS.action_required).toBe("ours");
  });
});

describe("case status — transitions", () => {
  it("moves forward along the spine, skips allowed", () => {
    expect(canSetCaseStatus("not_started", "in_progress")).toBe(true);
    expect(canSetCaseStatus("not_started", "submitted")).toBe(true);
    expect(canSetCaseStatus("in_progress", "submitted")).toBe(true);
    expect(canSetCaseStatus("in_progress", "in_review")).toBe(true);
    expect(canSetCaseStatus("submitted", "in_review")).toBe(true);
    expect(canSetCaseStatus("submitted", "action_required")).toBe(true);
    expect(canSetCaseStatus("in_review", "action_required")).toBe(true);
  });

  it("closes to any terminal from any open status", () => {
    for (const from of OPEN_CASE_STATUSES) {
      for (const to of TERMINAL_CASE_STATUSES) {
        expect(canSetCaseStatus(from, to)).toBe(true);
      }
    }
  });

  it("allows the one backward open edge: action_required → in_review", () => {
    expect(canSetCaseStatus("action_required", "in_review")).toBe(true);
  });

  it("rejects backward open moves (correction-only)", () => {
    expect(canSetCaseStatus("in_progress", "not_started")).toBe(false);
    expect(canSetCaseStatus("submitted", "in_progress")).toBe(false);
    expect(canSetCaseStatus("in_review", "submitted")).toBe(false);
    expect(canSetCaseStatus("action_required", "submitted")).toBe(false);
    expect(canSetCaseStatus("action_required", "in_progress")).toBe(false);
  });

  it("rejects self-transitions", () => {
    for (const s of CASE_STATUSES) {
      expect(canSetCaseStatus(s, s)).toBe(false);
    }
  });

  it("reapply is the only normal edge out of a terminal", () => {
    expect(allowedCaseStatusTransitions("denied")).toEqual(["in_progress"]);
    expect(allowedCaseStatusTransitions("approved")).toEqual([]);
    expect(allowedCaseStatusTransitions("not_pursuing")).toEqual([]);
    expect(isReapplyCaseTransition("denied", "in_progress")).toBe(true);
    expect(isReapplyCaseTransition("denied", "submitted")).toBe(false);
    expect(isReapplyCaseTransition("approved", "in_progress")).toBe(false);
  });
});

describe("case status — F6.0.3 Add-touch suggestion", () => {
  it("a successful submission-capable contact pre-submission suggests Submitted", () => {
    for (const touchType of ["portal", "fax", "mail", "email"]) {
      expect(
        suggestStatusBump({ touchType, outcome: "successful", currentStatus: "in_progress" }),
      ).toBe("submitted");
      expect(
        suggestStatusBump({ touchType, outcome: "successful", currentStatus: "not_started" }),
      ).toBe("submitted");
    }
  });

  it("a call never implies a submission", () => {
    expect(
      suggestStatusBump({ touchType: "call", outcome: "successful", currentStatus: "in_progress" }),
    ).toBeNull();
  });

  it("a successful payer contact at Submitted suggests In Review", () => {
    expect(
      suggestStatusBump({ touchType: "call", outcome: "successful", currentStatus: "submitted" }),
    ).toBe("in_review");
    expect(
      suggestStatusBump({ touchType: "email", outcome: "successful", currentStatus: "submitted" }),
    ).toBe("in_review");
  });

  it("responding at Action Required suggests the return to In Review", () => {
    expect(
      suggestStatusBump({
        touchType: "portal",
        outcome: "successful",
        currentStatus: "action_required",
      }),
    ).toBe("in_review");
  });

  it("a voicemail implies nothing (TS-137)", () => {
    expect(
      suggestStatusBump({ touchType: "call", outcome: "attempted", currentStatus: "submitted" }),
    ).toBeNull();
    expect(
      suggestStatusBump({ touchType: "call", outcome: "no_response", currentStatus: "submitted" }),
    ).toBeNull();
  });

  it("internal touch types imply nothing", () => {
    for (const touchType of ["internal_sync", "provider_outreach", "caqh_update"]) {
      expect(
        suggestStatusBump({ touchType, outcome: "successful", currentStatus: "submitted" }),
      ).toBeNull();
    }
  });

  it("in_review and terminals never get a casual bump", () => {
    for (const currentStatus of ["in_review", "approved", "denied", "not_pursuing"] as const) {
      expect(
        suggestStatusBump({ touchType: "call", outcome: "successful", currentStatus }),
      ).toBeNull();
    }
  });

  it("missing type or outcome implies nothing", () => {
    expect(
      suggestStatusBump({ touchType: null, outcome: "successful", currentStatus: "submitted" }),
    ).toBeNull();
    expect(
      suggestStatusBump({ touchType: "call", outcome: null, currentStatus: "submitted" }),
    ).toBeNull();
  });
});

describe("case status — TS-104 legacy migration mapping", () => {
  const CRED_LABELS = CANONICAL_STATUSES.credentialing.map((s) => s.label);

  it("maps every (credentialing label × pipeline state) pair deterministically", () => {
    for (const label of [...CRED_LABELS, null, "Some Divergent Label"]) {
      for (const pipeline of [...PAYER_PIPELINE_STATES, null]) {
        const mapped = mapLegacyCaseStatus(label, pipeline);
        expect(isCaseStatus(mapped)).toBe(true);
      }
    }
  });

  it("the pipeline wins once it progressed past not_started", () => {
    for (const label of [...CRED_LABELS, null]) {
      expect(mapLegacyCaseStatus(label, "assigned")).toBe("in_progress");
      expect(mapLegacyCaseStatus(label, "drafting")).toBe("in_progress");
      expect(mapLegacyCaseStatus(label, "submitted")).toBe("submitted");
      expect(mapLegacyCaseStatus(label, "in_review")).toBe("in_review");
      expect(mapLegacyCaseStatus(label, "action_required")).toBe("action_required");
      expect(mapLegacyCaseStatus(label, "approved")).toBe("approved");
      expect(mapLegacyCaseStatus(label, "denied")).toBe("denied");
      expect(mapLegacyCaseStatus(label, "oon")).toBe("not_pursuing");
    }
  });

  it("a never-started pipeline maps from the internal label", () => {
    expect(mapLegacyCaseStatus(NOT_STARTED_LABEL, "not_started")).toBe("not_started");
    expect(mapLegacyCaseStatus(IN_PROGRESS_LABEL, "not_started")).toBe("in_progress");
    expect(mapLegacyCaseStatus(WAITING_ON_PROVIDER_LABEL, "not_started")).toBe("in_progress");
    expect(mapLegacyCaseStatus(SUBMITTED_LABEL, "not_started")).toBe("submitted");
    expect(mapLegacyCaseStatus(APPROVED_LABEL, "not_started")).toBe("approved");
    expect(mapLegacyCaseStatus(IN_NETWORK_LABEL, "not_started")).toBe("approved");
    expect(mapLegacyCaseStatus(DENIED_LABEL, "not_started")).toBe("denied");
    expect(mapLegacyCaseStatus(OON_LABEL, "not_started")).toBe("not_pursuing");
    expect(mapLegacyCaseStatus(NOT_REQUIRED_LABEL, "not_started")).toBe("not_pursuing");
    expect(mapLegacyCaseStatus(null, "not_started")).toBe("not_started");
    expect(mapLegacyCaseStatus(null, null)).toBe("not_started");
    expect(mapLegacyCaseStatus("Some Divergent Label", null)).toBe("not_started");
  });
});

describe("case status — transition-shim mirrors", () => {
  it("mirrors every canonical status to a canonical credentialing label", () => {
    const CRED_LABELS = new Set(CANONICAL_STATUSES.credentialing.map((s) => s.label));
    for (const s of CASE_STATUSES) {
      expect(CRED_LABELS.has(LEGACY_CREDENTIALING_MIRROR[s])).toBe(true);
    }
  });

  it("mirror labels keep the open/closed split", () => {
    const bucketByLabel = new Map(
      CANONICAL_STATUSES.credentialing.map((s) => [s.label, s.actionBucket]),
    );
    for (const s of OPEN_CASE_STATUSES) {
      expect(bucketByLabel.get(LEGACY_CREDENTIALING_MIRROR[s])).not.toBe("complete");
    }
    // Approved / Not Pursuing mirror to complete labels; Denied's legacy label
    // keeps its legacy 'ours' bucket — identical to today's live behavior.
    expect(bucketByLabel.get(LEGACY_CREDENTIALING_MIRROR.approved)).toBe("complete");
    expect(bucketByLabel.get(LEGACY_CREDENTIALING_MIRROR.not_pursuing)).toBe("complete");
  });

  it("mirrors every canonical status into the payer-pipeline enum", () => {
    for (const s of CASE_STATUSES) {
      expect(PAYER_PIPELINE_STATES).toContain(PIPELINE_STATE_MIRROR[s]);
    }
    expect(PIPELINE_STATE_MIRROR.not_pursuing).toBe("oon");
    expect(PIPELINE_STATE_MIRROR.in_progress).toBe("drafting");
  });

  it("mirror → migration mapping round-trips every canonical status", () => {
    // A case written by the RPC (canonical + both mirrors) must map back to
    // the same canonical status under the migration rule — so re-running the
    // backfill over post-E6.0 rows is a no-op.
    for (const s of CASE_STATUSES) {
      const label = LEGACY_CREDENTIALING_MIRROR[s];
      const pipeline = PIPELINE_STATE_MIRROR[s];
      const roundTripped = mapLegacyCaseStatus(label, pipeline);
      if (s === "in_review" || s === "action_required") {
        expect(roundTripped).toBe(s); // pipeline carries the distinction
      } else {
        expect(roundTripped).toBe(s);
      }
    }
  });
});

describe("case status — allowed-transition menu order", () => {
  it("lists spine-forward moves, then the RFI return, then the terminals", () => {
    expect(allowedCaseStatusTransitions("submitted")).toEqual([
      "in_review",
      "action_required",
      "approved",
      "denied",
      "not_pursuing",
    ]);
    expect(allowedCaseStatusTransitions("action_required")).toEqual([
      "in_review",
      "approved",
      "denied",
      "not_pursuing",
    ]);
    expect(allowedCaseStatusTransitions("not_started")).toEqual([
      "in_progress",
      "submitted",
      "in_review",
      "action_required",
      "approved",
      "denied",
      "not_pursuing",
    ]);
  });

  it("every listed move validates as a CaseStatus edge", () => {
    for (const from of CASE_STATUSES) {
      for (const to of allowedCaseStatusTransitions(from)) {
        expect(canSetCaseStatus(from, to as CaseStatus)).toBe(true);
      }
    }
  });
});
