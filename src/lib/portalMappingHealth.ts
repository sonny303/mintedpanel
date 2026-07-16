// Portal mapping health predicates — pure, unit-tested. Surfaced by the Portals
// registry (Surface 3) and its field dialog so setup stops looking complete
// while extension fills quietly leave fields blank.
import type { PortalFieldMap } from "@/types";

// A non-retired mapping the extension would attempt to fill but that carries no
// usable value source: not manual (manual is a deliberate "fill by hand",
// counted out of auto-fill — a choice, not a gap), no token to resolve, and no
// hardcoded value. Such a mapping is live on the form yet always fills blank
// until someone links it. Proposed rows count too: the extension fills proposed
// maps (only retired is skipped), so a proposed row with no token silently
// leaves its field empty on every fill.
export function isUnlinkedFieldMap(m: PortalFieldMap): boolean {
  return (
    m.status !== "retired" &&
    m.source !== "manual" &&
    m.source !== "manual_partial" &&
    m.token == null &&
    m.hardcodedValue == null
  );
}
