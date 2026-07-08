// How many online_form SOP steps across an org's templates point at each
// portal_key — the "referenced by N SOP steps" count on Admin > Portals, so an
// admin can see a portal's blast radius before renaming or retiring it.
// Archived templates are excluded: they don't generate cases, so their steps
// don't drive any fill. Keys are normalized so editor-cased input collides with
// the stored/registry form.
import { normalizePortalKey } from "@/lib/tokenFormat";
import type { SOPTemplate } from "@/types";

export function countStepsByPortalKey(templates: SOPTemplate[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of templates) {
    if (t.archived || t.isArchived) continue;
    for (const def of t.taskDefinitions ?? []) {
      for (const step of def.steps ?? []) {
        const key = normalizePortalKey(step.portalKey);
        if (!key) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return counts;
}
