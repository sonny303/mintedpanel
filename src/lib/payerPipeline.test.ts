// E4.0 TE-8 — unit tests for the pure payer-pipeline state machine: edge
// legality (the forward spine + Denied/OON reachability + reapply), the terminal
// set, and that illegal/backwards moves are rejected by canTransition (so they
// can only happen via an admin correction, never a normal transition).
import { describe, expect, it } from "vitest";
import {
  PAYER_PIPELINE_LABELS,
  PAYER_PIPELINE_STATES,
  TERMINAL_PAYER_PIPELINE_STATES,
  allowedTransitions,
  canTransition,
  isReapplyTransition,
  isTerminalPipelineState,
  pipelineLabel,
  type PayerPipelineState,
} from "./payerPipeline";

const OPEN_PRETERMINAL: PayerPipelineState[] = [
  "drafting",
  "submitted",
  "in_review",
  "action_required",
];

describe("payer pipeline — vocabulary", () => {
  it("has nine states, each with a label", () => {
    expect(PAYER_PIPELINE_STATES).toHaveLength(9);
    for (const s of PAYER_PIPELINE_STATES) {
      expect(pipelineLabel(s)).toBe(PAYER_PIPELINE_LABELS[s]);
      expect(pipelineLabel(s).length).toBeGreaterThan(0);
    }
  });

  it("marks exactly approved/denied/oon terminal", () => {
    expect([...TERMINAL_PAYER_PIPELINE_STATES].sort()).toEqual(["approved", "denied", "oon"]);
    for (const s of PAYER_PIPELINE_STATES) {
      expect(isTerminalPipelineState(s)).toBe(
        (TERMINAL_PAYER_PIPELINE_STATES as readonly string[]).includes(s),
      );
    }
  });
});

describe("payer pipeline — forward spine", () => {
  it("walks Not Started → Assigned → Drafting → Submitted → In Review ↔ Action Required", () => {
    expect(canTransition("not_started", "assigned")).toBe(true);
    expect(canTransition("assigned", "drafting")).toBe(true);
    expect(canTransition("drafting", "submitted")).toBe(true);
    expect(canTransition("submitted", "in_review")).toBe(true);
    expect(canTransition("in_review", "action_required")).toBe(true);
    expect(canTransition("action_required", "in_review")).toBe(true);
  });

  it("does not skip stages (no not_started → drafting, no drafting → in_review)", () => {
    expect(canTransition("not_started", "drafting")).toBe(false);
    expect(canTransition("not_started", "submitted")).toBe(false);
    expect(canTransition("drafting", "in_review")).toBe(false);
    expect(canTransition("assigned", "submitted")).toBe(false);
  });
});

describe("payer pipeline — terminal closes", () => {
  it("Approved is reachable only from In Review / Action Required", () => {
    expect(canTransition("in_review", "approved")).toBe(true);
    expect(canTransition("action_required", "approved")).toBe(true);
    expect(canTransition("drafting", "approved")).toBe(false);
    expect(canTransition("submitted", "approved")).toBe(false);
    expect(canTransition("not_started", "approved")).toBe(false);
    expect(canTransition("assigned", "approved")).toBe(false);
  });

  it("Denied and OON are reachable from every open pre-terminal state, symmetrically", () => {
    for (const from of OPEN_PRETERMINAL) {
      expect(canTransition(from, "denied")).toBe(true);
      expect(canTransition(from, "oon")).toBe(true);
    }
    // ...but NOT from not_started/assigned (nothing has been sent to the payer).
    expect(canTransition("not_started", "denied")).toBe(false);
    expect(canTransition("not_started", "oon")).toBe(false);
    expect(canTransition("assigned", "denied")).toBe(false);
    expect(canTransition("assigned", "oon")).toBe(false);
  });
});

describe("payer pipeline — terminal read-only except reapply", () => {
  it("Approved and OON have no forward edges", () => {
    expect(allowedTransitions("approved")).toEqual([]);
    expect(allowedTransitions("oon")).toEqual([]);
  });

  it("Denied's only forward edge is Drafting (reapply)", () => {
    expect(allowedTransitions("denied")).toEqual(["drafting"]);
    expect(canTransition("denied", "drafting")).toBe(true);
    expect(isReapplyTransition("denied", "drafting")).toBe(true);
    // Reapply is a normal forward move, not a correction; other terminal exits are not.
    expect(canTransition("denied", "submitted")).toBe(false);
    expect(isReapplyTransition("in_review", "drafting")).toBe(false);
  });
});

describe("payer pipeline — illegal/backwards moves need a correction", () => {
  it("rejects backwards edges and no-op self-edges (only an admin correction can do these)", () => {
    expect(canTransition("submitted", "drafting")).toBe(false);
    expect(canTransition("in_review", "submitted")).toBe(false);
    expect(canTransition("approved", "in_review")).toBe(false);
    for (const s of PAYER_PIPELINE_STATES) {
      expect(canTransition(s, s)).toBe(false);
    }
  });

  it("allowedTransitions never includes an illegal target", () => {
    for (const from of PAYER_PIPELINE_STATES) {
      for (const to of allowedTransitions(from)) {
        expect(canTransition(from, to)).toBe(true);
      }
    }
  });
});
