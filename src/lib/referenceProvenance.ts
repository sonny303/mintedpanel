// S4.5 / doc 06 C3 — where the case's payer reference came from, so the Case
// Close approval dialog can OFFER it with its provenance instead of making the
// coordinator retype a number they captured weeks earlier.
//
// Offered, not pre-filled: the reference is a submission tracking number and
// the field it feeds is the payer-ISSUED enrollment ID. They are frequently
// different, and nothing downstream can tell a wrong value from a right one,
// so the dialog renders a "Use as <label>" button rather than typing it in.
//
// Pure: the caller passes the case's stored reference and its touchlog.
import type { Touch } from "@/types";

export interface ReferenceProvenance {
  reference: string;
  /** ISO date of the touch that recorded it, when one can be identified. */
  capturedAt: string | null;
  /** True when the recording touch came from the extension (source
   * 'extension'), i.e. C2 wrote it during a portal submission. */
  fromWorkbench: boolean;
}

/** Resolve the provenance of a case's stored payer reference.
 *
 * The reference itself is the case column (latest-wins). The touchlog only
 * supplies WHERE it came from: the newest submission touch is taken as the
 * recording event. Returns null when the case has no reference — there is
 * nothing to offer and nothing to attribute. */
export function resolveReferenceProvenance(
  payerReferenceId: string | null | undefined,
  touches: readonly Touch[] | null | undefined,
): ReferenceProvenance | null {
  const reference = payerReferenceId?.trim();
  if (!reference) return null;

  // Newest submission touchpoint first. `outcome === 'submitted'` is the same
  // marker the case-list read uses for lastSubmittedAt, so the two agree about
  // which event counts as "the submission".
  const submissions = (touches ?? [])
    .filter((t) => t.entryType === "touchpoint" && t.outcome === "submitted")
    .sort((a, b) => (b.touchDate ?? "").localeCompare(a.touchDate ?? ""));
  const recording = submissions[0] ?? null;

  return {
    reference,
    capturedAt: recording?.touchDate ?? null,
    // Attribute to the Workbench only when the touch says so — a manually
    // typed reference must not be credited to the extension.
    fromWorkbench: recording?.source === "extension",
  };
}
