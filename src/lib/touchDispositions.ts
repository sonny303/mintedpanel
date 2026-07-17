// E4.1 F4.1.4: the optional high-level disposition. One small shared set that
// applies to every touch type and maps onto the existing channel-aware
// `outcome` field. It is optional and never synthesized — a touch may carry no
// disposition (the DB `outcome` check allows NULL on typed touches). "Other"
// requires a single-line context so a catch-all is never opaque.
import type { TouchOutcome } from "@/types";

export interface TouchDisposition {
  value: TouchOutcome;
  label: string;
}

// `no_response` is reused from the legacy taxonomy so the two never diverge.
export const TOUCH_DISPOSITIONS: readonly TouchDisposition[] = [
  { value: "successful", label: "Successful" },
  { value: "attempted", label: "Attempted" },
  { value: "no_response", label: "No response" },
  { value: "error", label: "Error" },
  { value: "other", label: "Other" },
] as const;

export const OTHER_DISPOSITION: TouchOutcome = "other";

// Label map for the disposition values — folded into src/lib/touchOutcomes.ts's
// OUTCOME_LABELS so `outcomeLabel` resolves them everywhere (rows, CSV, task
// slice) from one source.
export const DISPOSITION_LABELS: Record<string, string> = Object.fromEntries(
  TOUCH_DISPOSITIONS.map((d) => [d.value, d.label]),
);

const DISPOSITION_VALUES: ReadonlySet<string> = new Set(TOUCH_DISPOSITIONS.map((d) => d.value));

export function isDisposition(outcome: string | null | undefined): boolean {
  return outcome != null && DISPOSITION_VALUES.has(outcome);
}

// "Other" must carry a one-line context (F4.1.4). The form enforces it; this is
// the shared predicate so the rule lives in one place.
export function dispositionRequiresContext(outcome: TouchOutcome | null | undefined): boolean {
  return outcome === OTHER_DISPOSITION;
}
