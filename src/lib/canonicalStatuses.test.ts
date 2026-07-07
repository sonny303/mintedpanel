import { describe, expect, it } from "vitest";
import {
  ACTION_BUCKETS,
  ALL_CANONICAL_STATUSES,
  CANONICAL_STATUSES,
  STATUS_LABEL_COMPAT,
  canonicalLabel,
} from "./canonicalStatuses";
import {
  APPROVED_LABEL,
  CONTRACTED_LABEL,
  DENIED_LABEL,
  IN_NETWORK_LABEL,
  IN_PROGRESS_LABEL,
  INACTIVE_LABEL,
  INTERVIEWING_LABEL,
  LIVE_LABEL,
  NOT_REQUIRED_LABEL,
  NOT_STARTED_LABEL,
  OON_LABEL,
  PENDING_FULFILLMENT_LABEL,
  PLANNED_LABEL,
  PROSPECT_LABEL,
  READY_FOR_LAUNCH_LABEL,
  SUBMITTED_LABEL,
  WAITING_ON_PROVIDER_LABEL,
} from "./statusLabels";

const TRACKS = ["credentialing", "contracting", "location"] as const;

// Every distinct status-label constant exported by statusLabels.ts.
const STATUS_LABEL_CONSTANTS = [
  NOT_STARTED_LABEL,
  IN_NETWORK_LABEL,
  OON_LABEL,
  IN_PROGRESS_LABEL,
  WAITING_ON_PROVIDER_LABEL,
  SUBMITTED_LABEL,
  APPROVED_LABEL,
  DENIED_LABEL,
  NOT_REQUIRED_LABEL,
  CONTRACTED_LABEL,
  PROSPECT_LABEL,
  PLANNED_LABEL,
  INTERVIEWING_LABEL,
  PENDING_FULFILLMENT_LABEL,
  READY_FOR_LAUNCH_LABEL,
  LIVE_LABEL,
  INACTIVE_LABEL,
];

describe("CANONICAL_STATUSES", () => {
  it("has 22 rows across the three tracks (9 / 6 / 7)", () => {
    expect(CANONICAL_STATUSES.credentialing).toHaveLength(9);
    expect(CANONICAL_STATUSES.contracting).toHaveLength(6);
    expect(CANONICAL_STATUSES.location).toHaveLength(7);
    expect(ALL_CANONICAL_STATUSES).toHaveLength(22);
  });

  it("uses only the four valid action buckets", () => {
    for (const s of ALL_CANONICAL_STATUSES) {
      expect(ACTION_BUCKETS).toContain(s.actionBucket);
    }
  });

  it("tags every row with its own track", () => {
    for (const track of TRACKS) {
      for (const s of CANONICAL_STATUSES[track]) {
        expect(s.track).toBe(track);
      }
    }
  });

  it("sorts each track by a strictly ascending sort order", () => {
    for (const track of TRACKS) {
      const orders = CANONICAL_STATUSES[track].map((s) => s.sortOrder);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
      expect(new Set(orders).size).toBe(orders.length);
    }
  });

  it("stores every color as a 6-digit hex", () => {
    for (const s of ALL_CANONICAL_STATUSES) {
      expect(s.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("labels every row with a named statusLabels constant", () => {
    for (const s of ALL_CANONICAL_STATUSES) {
      expect(STATUS_LABEL_CONSTANTS).toContain(s.label);
    }
  });

  it("mirrors the create_organization seed for representative rows", () => {
    const cred = Object.fromEntries(CANONICAL_STATUSES.credentialing.map((s) => [s.label, s]));
    expect(cred[SUBMITTED_LABEL]).toMatchObject({
      color: "#0891B2",
      sortOrder: 32,
      actionBucket: "waiting_payer",
    });
    expect(cred[IN_NETWORK_LABEL]).toMatchObject({
      color: "#059669",
      sortOrder: 10,
      actionBucket: "complete",
    });
    const loc = Object.fromEntries(CANONICAL_STATUSES.location.map((s) => [s.label, s]));
    expect(loc[LIVE_LABEL]).toMatchObject({
      color: "#059669",
      sortOrder: 60,
      actionBucket: "complete",
    });
    expect(loc[INACTIVE_LABEL]).toMatchObject({
      color: "#9CA3AF",
      sortOrder: 70,
      actionBucket: "complete",
    });
  });
});

describe("canonicalLabel", () => {
  it("is identity for every canonical label", () => {
    for (const s of ALL_CANONICAL_STATUSES) {
      expect(canonicalLabel(s.label)).toBe(s.label);
    }
  });

  it("is identity for an org-added label with no compat entry", () => {
    expect(canonicalLabel("Negotiating")).toBe("Negotiating");
  });

  it("ships an empty compat map today (both live orgs are already canonical)", () => {
    expect(Object.keys(STATUS_LABEL_COMPAT)).toHaveLength(0);
  });

  it("resolves a divergent label through a compat entry when present", () => {
    STATUS_LABEL_COMPAT["In Network"] = IN_NETWORK_LABEL;
    try {
      expect(canonicalLabel("In Network")).toBe(IN_NETWORK_LABEL);
      // Idempotent: the canonical form is not itself a compat key.
      expect(canonicalLabel(IN_NETWORK_LABEL)).toBe(IN_NETWORK_LABEL);
    } finally {
      delete STATUS_LABEL_COMPAT["In Network"];
    }
  });
});
