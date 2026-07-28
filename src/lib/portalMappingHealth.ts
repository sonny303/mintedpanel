// Portal mapping health predicates — pure, unit-tested. Surfaced by the Portals
// registry (Surface 3) and its field dialog so setup stops looking complete
// while extension fills quietly leave fields blank.
import type { PortalFieldMap } from "@/types";

// A non-retired mapping the extension would attempt to fill but that carries no
// usable value source: not manual (manual is a deliberate "fill by hand",
// counted out of auto-fill — a choice, not a gap), no token to resolve, and no
// hardcoded value. Such a mapping is live on the form yet always fills blank
// until someone links it. Proposed rows count too — not because they fill (S5.1
// flipped the fill path to approved-only, so they no longer do) but because an
// approved-with-no-token row is the blank-fill case this predicate exists to
// name, and a proposed one is the same row a click away from being approved.
export function isUnlinkedFieldMap(m: PortalFieldMap): boolean {
  return (
    m.status !== "retired" &&
    m.source !== "manual" &&
    m.source !== "manual_partial" &&
    m.token == null &&
    m.hardcodedValue == null
  );
}
