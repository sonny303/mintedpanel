// E4.0 TE-1/TE-5 — the pure payer-pipeline state machine: the ONE source of
// truth for the external (payer-side) states, their labels, the legal forward
// edges, and the terminal set. The UI uses it to disable illegal moves and to
// compose the "current state / allowed next states" inline error; the
// advance_payer_pipeline RPC (SQL, can't import TS) MIRRORS this edge map by
// hand — keep the two in lockstep (the canonicalStatuses.ts precedent).
//
// This is the EXTERNAL machine, wholly independent of the internal
// status_configs/credentialing_status_id machine (A3 decoupling). No I/O.

export type PayerPipelineState =
  | "not_started"
  | "assigned"
  | "drafting"
  | "submitted"
  | "in_review"
  | "action_required"
  | "approved"
  | "denied"
  | "oon";

/** Every valid state, in forward-spine order (terminals last). */
export const PAYER_PIPELINE_STATES: readonly PayerPipelineState[] = [
  "not_started",
  "assigned",
  "drafting",
  "submitted",
  "in_review",
  "action_required",
  "approved",
  "denied",
  "oon",
];

/** User-visible label per state. "Action Required" is the RFI state. */
export const PAYER_PIPELINE_LABELS: Record<PayerPipelineState, string> = {
  not_started: "Not Started",
  assigned: "Assigned",
  drafting: "Drafting",
  submitted: "Submitted",
  in_review: "In Review",
  action_required: "Action Required",
  approved: "Approved",
  denied: "Denied",
  oon: "Out-of-Network",
};

/** The three terminal closes. Approved is the enrollment; Denied/OON are the
 * non-Approved closes. Terminal cases are read-only except the admin correction
 * path and the Denied -> Drafting reapply. */
export const TERMINAL_PAYER_PIPELINE_STATES: readonly PayerPipelineState[] = [
  "approved",
  "denied",
  "oon",
];

// The legal FORWARD edges (normal, non-correction transitions). Denied and OON
// are reachable from any open pre-terminal state (drafting/submitted/in_review/
// action_required), edge-symmetric to each other; Approved is reachable from
// In Review / Action Required. Denied -> Drafting is the reapply forward edge
// ([r4-review] Q6) — the ONLY normal edge out of a terminal state. Approved and
// OON have no forward edge (fully terminal, admin correction only).
const FORWARD_EDGES: Record<PayerPipelineState, readonly PayerPipelineState[]> = {
  not_started: ["assigned"],
  assigned: ["drafting"],
  drafting: ["submitted", "denied", "oon"],
  submitted: ["in_review", "denied", "oon"],
  in_review: ["action_required", "approved", "denied", "oon"],
  action_required: ["in_review", "approved", "denied", "oon"],
  approved: [],
  denied: ["drafting"],
  oon: [],
};

export function isPayerPipelineState(value: unknown): value is PayerPipelineState {
  return typeof value === "string" && (PAYER_PIPELINE_STATES as readonly string[]).includes(value);
}

export function pipelineLabel(state: PayerPipelineState): string {
  return PAYER_PIPELINE_LABELS[state];
}

export function isTerminalPipelineState(state: PayerPipelineState): boolean {
  return (TERMINAL_PAYER_PIPELINE_STATES as readonly string[]).includes(state);
}

/** The states a normal (non-correction) transition may move `from` into. */
export function allowedTransitions(from: PayerPipelineState): readonly PayerPipelineState[] {
  return FORWARD_EDGES[from];
}

/** True iff `from -> to` is a legal normal (non-correction) transition. An
 * admin correction bypasses this — it may move to any state, including
 * backwards edges. */
export function canTransition(from: PayerPipelineState, to: PayerPipelineState): boolean {
  return FORWARD_EDGES[from].includes(to);
}

/** The reapply forward edge: Denied -> Drafting reopens a fresh pipeline cycle
 * on the same case (a normal transition, never a correction). */
export function isReapplyTransition(from: PayerPipelineState, to: PayerPipelineState): boolean {
  return from === "denied" && to === "drafting";
}
