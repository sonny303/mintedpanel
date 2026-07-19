// E6.0 — the ONE canonical, code-owned case-status list (decision record
// 2026-07-19, decision 1). Every credential case carries exactly one of these
// eight statuses; there is no per-org configuration, no per-org labels, no
// per-org colors. This module is the single source of truth for the list, the
// legal transitions, the evidence rules (which touches suggest which bump),
// the deterministic legacy migration mapping, and the transition-shim mirrors
// the `set_case_status` RPC keeps in lockstep (SQL can't import TS — the
// canonicalStatuses.ts / payerPipeline.ts precedent; keep the two in step).
//
// Spine: Not Started → In Progress → Submitted → In Review → Action Required,
// closing to one of the three terminals Approved | Denied | Not Pursuing.
// Statuses are set by EVIDENCE: the system sets what it witnessed (creation,
// first recorded work, an extension-logged submission), humans set what they
// learned (payer calls, RFIs, letters). Corrections append, never rewrite.
// No I/O.
import type { PayerPipelineState } from "./payerPipeline";
import type { ActionBucket } from "./canonicalStatuses";
import { canonicalLabel } from "./canonicalStatuses";
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

export type CaseStatus =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "in_review"
  | "action_required"
  | "approved"
  | "denied"
  | "not_pursuing";

/** Every canonical status, spine order first, terminals last. */
export const CASE_STATUSES: readonly CaseStatus[] = [
  "not_started",
  "in_progress",
  "submitted",
  "in_review",
  "action_required",
  "approved",
  "denied",
  "not_pursuing",
];

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  submitted: "Submitted",
  in_review: "In Review",
  action_required: "Action Required",
  approved: "Approved",
  denied: "Denied",
  not_pursuing: "Not Pursuing",
};

/** The five open (non-terminal) statuses, in spine order. */
export const OPEN_CASE_STATUSES: readonly CaseStatus[] = [
  "not_started",
  "in_progress",
  "submitted",
  "in_review",
  "action_required",
];

/** The three closes. Denied is re-openable via reapply (denied → in_progress);
 * Approved and Not Pursuing move only by admin correction. */
export const TERMINAL_CASE_STATUSES: readonly CaseStatus[] = ["approved", "denied", "not_pursuing"];

// Spine position for the forward-jump rule. Terminals carry no rank.
const SPINE_RANK: Partial<Record<CaseStatus, number>> = {
  not_started: 0,
  in_progress: 1,
  submitted: 2,
  in_review: 3,
  action_required: 4,
};

export function isCaseStatus(value: unknown): value is CaseStatus {
  return typeof value === "string" && (CASE_STATUSES as readonly string[]).includes(value);
}

export function caseStatusLabel(status: CaseStatus): string {
  return CASE_STATUS_LABELS[status];
}

export function isOpenCaseStatus(status: CaseStatus): boolean {
  return (OPEN_CASE_STATUSES as readonly string[]).includes(status);
}

export function isTerminalCaseStatus(status: CaseStatus): boolean {
  return (TERMINAL_CASE_STATUSES as readonly string[]).includes(status);
}

/**
 * The legal NORMAL (non-correction) transitions out of a status. The rule set
 * (mirrored by the `set_case_status` RPC):
 *  - forward along the spine: any open status may move to any LATER open
 *    status (skips allowed — the system never demands ceremony steps);
 *  - the one legal backward open edge: action_required → in_review (the RFI
 *    cycle — "and back to In Review on response", F6.0.2);
 *  - any open status may close to any terminal (approved / denied /
 *    not_pursuing) — the close dialogs demand the evidence (effective date +
 *    payer-labeled ID, denial reason, opt-out note), never the path;
 *  - denied → in_progress is the reapply edge, the ONLY normal move out of a
 *    terminal (same case, fresh task cycle, prior denial intact);
 *  - approved and not_pursuing move only by admin correction.
 * Every other move is backward and requires an admin correction (F6.0.4).
 */
export function allowedCaseStatusTransitions(from: CaseStatus): readonly CaseStatus[] {
  if (from === "denied") return ["in_progress"];
  if (from === "approved" || from === "not_pursuing") return [];
  const rank = SPINE_RANK[from] ?? 0;
  const forward = OPEN_CASE_STATUSES.filter((s) => (SPINE_RANK[s] ?? 0) > rank);
  const backOpen: CaseStatus[] = from === "action_required" ? ["in_review"] : [];
  // action_required → in_review is already in neither list (backward), so the
  // explicit edge is appended; order: spine-forward, RFI return, terminals.
  return [...forward.filter((s) => !backOpen.includes(s)), ...backOpen, ...TERMINAL_CASE_STATUSES];
}

/** True iff `from → to` is a legal normal (non-correction) transition. */
export function canSetCaseStatus(from: CaseStatus, to: CaseStatus): boolean {
  if (from === to) return false;
  return allowedCaseStatusTransitions(from).includes(to);
}

/** The reapply edge: Denied → In Progress reopens the SAME case with a fresh
 * task cycle appended (never a second case for the combination). */
export function isReapplyCaseTransition(from: CaseStatus, to: CaseStatus): boolean {
  return from === "denied" && to === "in_progress";
}

/**
 * Action-engine bucket per canonical status — the surviving on-track /
 * stalled / overdue derivations (`actionState.ts`, work-view chips) key off
 * buckets, so the canonical list maps into the same closed set. Denied and
 * Not Pursuing are CLOSED here (a denied case leaves the open queues until
 * reapply re-opens it) — deliberately different from the legacy credentialing
 * Denied bucket ("ours"), which kept dead cases in the queues forever.
 */
export const CASE_STATUS_BUCKETS: Record<CaseStatus, ActionBucket> = {
  not_started: "ours",
  in_progress: "ours",
  submitted: "waiting_payer",
  in_review: "waiting_payer",
  action_required: "ours",
  approved: "complete",
  denied: "complete",
  not_pursuing: "complete",
};

// ---------------------------------------------------------------------------
// F6.0.3 — the Add-touch status suggestion (the evidence carrier).
// ---------------------------------------------------------------------------

/** Touch types that can carry a payer-side status implication. `mail` is the
 * legacy channel kept for pre-taxonomy rows; it is submission-capable. */
const PAYER_FACING_BUMP_TYPES: readonly string[] = ["call", "email", "portal", "fax", "mail"];

/** Channels through which an application can itself be transmitted — a
 * successful one of these while the case is pre-submission IS the submission
 * evidence (the fax-payer story: the human is the evidence, the system never
 * presumes). A phone call can never submit an application. */
const SUBMISSION_CAPABLE_TYPES: readonly string[] = ["portal", "fax", "mail", "email"];

/** Outcomes/dispositions that assert the contact actually happened. Only these
 * imply anything — a voicemail (`attempted` / `no_response`) implies nothing. */
const AFFIRMATIVE_OUTCOMES: readonly string[] = ["successful", "reached", "response_received"];

export interface StatusBumpInput {
  touchType: string | null;
  outcome: string | null;
  currentStatus: CaseStatus;
}

/**
 * The closed rule table for the Add-touch bump (F6.0.3): a suggestion is
 * offered ONLY when the touch type/outcome implies one; declining logs the
 * touch alone. Rules:
 *  - only payer-facing touch types with an affirmative outcome ever imply;
 *  - pre-submission (not_started / in_progress): a successful contact on a
 *    submission-capable channel (portal / fax / mail / email) suggests
 *    Submitted — the manual-submission bump; a call never does;
 *  - submitted: a successful payer contact suggests In Review (receipt
 *    confirmed);
 *  - action_required: a successful payer contact suggests In Review (the
 *    response went back);
 *  - in_review and the terminals suggest nothing — approvals/denials demand
 *    their evidence dialogs, never a casual bump.
 */
export function suggestStatusBump(input: StatusBumpInput): CaseStatus | null {
  const { touchType, outcome, currentStatus } = input;
  if (!touchType || !outcome) return null;
  if (!PAYER_FACING_BUMP_TYPES.includes(touchType)) return null;
  if (!AFFIRMATIVE_OUTCOMES.includes(outcome)) return null;
  if (currentStatus === "not_started" || currentStatus === "in_progress") {
    return SUBMISSION_CAPABLE_TYPES.includes(touchType) ? "submitted" : null;
  }
  if (currentStatus === "submitted") return "in_review";
  if (currentStatus === "action_required") return "in_review";
  return null;
}

// ---------------------------------------------------------------------------
// F6.0.1 — the deterministic legacy migration mapping. The E6.0 migration
// backfills `case_status` from every live case's
// (credentialing status label × payer_pipeline_state) pair via exactly this
// table (mirrored in SQL in 20260719120000_e60_unified_case_status.sql).
// ---------------------------------------------------------------------------

/**
 * Pipeline-wins rule: once the payer pipeline progressed past not_started it
 * is the payer's own truth and maps directly; a case whose pipeline never
 * started maps from its internal credentialing label. The full table:
 *
 *   pipeline assigned|drafting            → in_progress
 *   pipeline submitted                    → submitted
 *   pipeline in_review                    → in_review
 *   pipeline action_required              → action_required
 *   pipeline approved                     → approved
 *   pipeline denied                       → denied
 *   pipeline oon                          → not_pursuing
 *   pipeline not_started/null, by label:
 *     Not Started                         → not_started
 *     In Progress | Waiting on Provider   → in_progress
 *     Submitted                           → submitted
 *     Approved | In-Network               → approved
 *     Denied                              → denied
 *     OON | Not Required                  → not_pursuing
 *     null / unknown label                → not_started
 */
export function mapLegacyCaseStatus(
  credentialingLabel: string | null,
  pipelineState: string | null,
): CaseStatus {
  switch (pipelineState) {
    case "assigned":
    case "drafting":
      return "in_progress";
    case "submitted":
      return "submitted";
    case "in_review":
      return "in_review";
    case "action_required":
      return "action_required";
    case "approved":
      return "approved";
    case "denied":
      return "denied";
    case "oon":
      return "not_pursuing";
    default:
      break;
  }
  const label = credentialingLabel === null ? null : canonicalLabel(credentialingLabel);
  switch (label) {
    case IN_PROGRESS_LABEL:
    case WAITING_ON_PROVIDER_LABEL:
      return "in_progress";
    case SUBMITTED_LABEL:
      return "submitted";
    case APPROVED_LABEL:
    case IN_NETWORK_LABEL:
      return "approved";
    case DENIED_LABEL:
      return "denied";
    case OON_LABEL:
    case NOT_REQUIRED_LABEL:
      return "not_pursuing";
    case NOT_STARTED_LABEL:
    default:
      return "not_started";
  }
}

// ---------------------------------------------------------------------------
// Transition-shim mirrors. Canonical `case_status` is THE truth; until the
// remaining legacy readers retire (E6.1–E6.4 repoint or remove them), the
// `set_case_status` RPC and the auto-transition triggers keep the two legacy
// fields in lockstep via these maps so every surviving derived surface — and
// the locked extension /api wire contract — stays truthful with zero /api or
// extension change. Remove the mirrors when the last legacy reader dies.
// ---------------------------------------------------------------------------

/** Canonical → the legacy credentialing label mirrored into
 * `credentialing_status_id` (resolved to the org's status_configs row by
 * label inside the RPC). in_review folds to Submitted (same waiting_payer
 * bucket); action_required folds to Waiting on Provider; not_pursuing folds
 * to Not Required (complete). */
export const LEGACY_CREDENTIALING_MIRROR: Record<CaseStatus, string> = {
  not_started: NOT_STARTED_LABEL,
  in_progress: IN_PROGRESS_LABEL,
  submitted: SUBMITTED_LABEL,
  in_review: SUBMITTED_LABEL,
  action_required: WAITING_ON_PROVIDER_LABEL,
  approved: APPROVED_LABEL,
  denied: DENIED_LABEL,
  not_pursuing: NOT_REQUIRED_LABEL,
};

/** Canonical → the payer-pipeline enum mirrored into `payer_pipeline_state`
 * (the /api caseContext / case-search wire value the extension renders). */
export const PIPELINE_STATE_MIRROR: Record<CaseStatus, PayerPipelineState> = {
  not_started: "not_started",
  in_progress: "drafting",
  submitted: "submitted",
  in_review: "in_review",
  action_required: "action_required",
  approved: "approved",
  denied: "denied",
  not_pursuing: "oon",
};
