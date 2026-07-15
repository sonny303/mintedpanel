// E4.1 F4.1.1: the seven fixed touch types, their labels, and the reporting
// direction that keeps the inward-facing pair (Provider Outreach, Internal
// Sync) distinguishable from payer-facing contact. This lives in code, not user
// config. Icons are React components, so they stay in the UI layer (keyed by the
// same TouchType); this module is pure so the reducers and CSV export can use it
// without pulling in lucide.
import type { TouchType } from "@/types";

// The seven canonical types in coordinator-facing order. `mail` is legacy — kept
// valid so pre-E4.1 rows render unchanged, but not offered as a new choice.
export const CANONICAL_TOUCH_TYPES: readonly TouchType[] = [
  "call",
  "portal",
  "email",
  "fax",
  "caqh_update",
  "provider_outreach",
  "internal_sync",
] as const;

export const TOUCH_TYPE_LABELS: Record<TouchType, string> = {
  call: "Call",
  portal: "Portal Check",
  email: "Email",
  fax: "Fax",
  caqh_update: "CAQH Update",
  provider_outreach: "Provider Outreach",
  internal_sync: "Internal Sync",
  // legacy — historical rows only.
  mail: "Mail",
};

export function touchTypeLabel(t: TouchType | null | undefined): string {
  if (!t) return "";
  return TOUCH_TYPE_LABELS[t] ?? t;
}

// Reporting projection direction (F4.1.1). Provider Outreach and Internal Sync
// are the inward-facing pair; everything else is payer-facing contact. Reports
// and any future rollups partition on this so internal coordination never
// inflates payer-contact metrics.
export type TouchDirection = "payer_facing" | "internal";

const INTERNAL_TOUCH_TYPES: ReadonlySet<TouchType> = new Set<TouchType>([
  "provider_outreach",
  "internal_sync",
]);

export function touchTypeDirection(t: TouchType): TouchDirection {
  return INTERNAL_TOUCH_TYPES.has(t) ? "internal" : "payer_facing";
}

export function isInternalTouchType(t: TouchType): boolean {
  return touchTypeDirection(t) === "internal";
}

export function isPayerFacingTouchType(t: TouchType): boolean {
  return touchTypeDirection(t) === "payer_facing";
}
