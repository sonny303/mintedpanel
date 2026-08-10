// Deterministic SOP template selection for a (payer, state, group). The
// precedence is EXPLICIT and ORDER-INDEPENDENT (E4.2 SOP-resolution hardening,
// revised by 3M Slice 3 / D3.3-G): the same inputs always select the same
// template regardless of the order rows arrive from the database. Candidates
// are ranked into fixed tiers and the lowest tier wins; array position is never
// load-bearing.
//
// Sort keys (D3.3-G — state specificity → group specificity → ownership):
//
//   1. active organization-specific   payer + EXACT state + EXACT group
//   2. active global / shared         payer + EXACT state + EXACT group
//   3. active organization-specific   payer + EXACT state + ANY group
//   4. active global / shared         payer + EXACT state + ANY group
//   5. active organization-specific   payer + All states  + EXACT group
//   6. active global / shared         payer + All states  + EXACT group
//   7. active organization-specific   payer + All states  + ANY group
//   8. active global / shared         payer + All states  + ANY group
//   9. active platform-managed global generic fallback (payerless global SOP)
//  10. null
//
// "Any group" means a group-agnostic template (null groupId) — NOT "any specific
// group". A template authored for a DIFFERENT group is never selected, so a
// group-specific SOP never leaks onto another group. A template for another
// payer is never selected. Archived templates never resolve.
//
// Intentional break vs pre-Slice-3 E4.2: a global exact-state + exact-group SOP
// beats an org exact-state + any-group SOP (group specificity before ownership).
// At equal state + group specificity, org still beats global.
//
// The seeded fallback (E1.7b) is identified by SHAPE (global + payerless), never
// by id, so a reseeded environment still labels and selects it correctly.
//
// PM decision (E4.2 hardening): the supported organization-authored match key is
// payer + state + group. Specialty is preserved as legacy / non-routing metadata
// but is NOT a runtime match key. Slice 3 adds All-states as a state wildcard.
import type { SOPTemplate } from "@/types";
import { ALL_STATES_SENTINEL } from "@/lib/sopMatchKey";

export { ALL_STATES_SENTINEL };

// The seeded fallback row's fixed UUID (migration
// 20260713120000_sop_template_versions.sql). Identification is by SHAPE
// (global + payerless) so a reseeded environment still labels correctly; the
// constant exists for tests/fixtures and deep links.
export const FALLBACK_SOP_TEMPLATE_ID = "00000000-0000-4000-a000-00000000e17b";

// The provenance tier a resolved template belongs to — a pure property of the
// template's ownership (org-owned override vs global payer catalog vs generic
// fallback), independent of the group sub-tier. Stamped on generated tasks and
// generation-run rows so generic-fallback usage is directly reportable without
// reconstructing it from mutable template ownership.
export type SopResolutionTier = "organization" | "global_payer" | "generic_fallback";

// The domain type predates nullable org_id, so read it loosely here.
function templateOrgId(template: Pick<SOPTemplate, "orgId">): string | null {
  return (template as { orgId: string | null }).orgId ?? null;
}

// A fallback template is a global-catalog row (orgId NULL) with no payer match key.
export function isFallbackTemplate(template: Pick<SOPTemplate, "orgId" | "payerId">): boolean {
  return templateOrgId(template) === null && template.payerId === null;
}

/** Classify an (already-selected) template into its provenance tier — pure over
 * the template's ownership, independent of the group sub-tier. Every resolved
 * template maps to exactly one of the three tiers. */
export function resolutionTier(
  template: Pick<SOPTemplate, "orgId" | "payerId">,
): SopResolutionTier {
  if (isFallbackTemplate(template)) return "generic_fallback";
  if (templateOrgId(template) === null) return "global_payer";
  return "organization";
}

function isArchived(t: SOPTemplate): boolean {
  const row = t as SOPTemplate & { archived?: boolean; isArchived?: boolean };
  return Boolean(row.archived ?? row.isArchived ?? false);
}

// The candidate rank for a (payer, state, group) request. Lower = higher
// precedence; null = the template does not qualify at all for this request.
function candidateRank(
  t: SOPTemplate,
  payerId: string,
  state: string,
  groupId: string | null,
): 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | null {
  // Tier 9: the generic fallback qualifies for ANY request (it is the last
  // resort). Checked first so a payerless global row is never mistaken for a
  // payer-specific candidate.
  if (isFallbackTemplate(t)) return 9;
  // Payer must match exactly — never another payer.
  if (t.payerId !== payerId) return null;
  const exactState = t.state === state;
  const allState = t.state === ALL_STATES_SENTINEL;
  if (!exactState && !allState) return null;
  const exactGroup = t.groupId === groupId; // the requested group (or both null)
  const anyGroup = t.groupId === null; // group-agnostic template
  if (!exactGroup && !anyGroup) {
    // A template authored for a DIFFERENT specific group never resolves here.
    return null;
  }
  const isOrg = templateOrgId(t) !== null;
  // D3.3-G: state specificity → group specificity → ownership.
  if (exactState && exactGroup) return isOrg ? 1 : 2;
  if (exactState && anyGroup) return isOrg ? 3 : 4;
  if (allState && exactGroup) return isOrg ? 5 : 6;
  if (allState && anyGroup) return isOrg ? 7 : 8;
  return null;
}

// Deterministic tiebreak WITHIN a tier so selection never depends on array
// order. Active-org duplicates are prevented by the uniqueness mechanism, but
// global rows and any residual overlap still resolve deterministically: oldest
// createdAt first, then id.
function compareWithin(a: SOPTemplate, b: SOPTemplate): number {
  const ca = a.createdAt ?? "";
  const cb = b.createdAt ?? "";
  if (ca !== cb) return ca < cb ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

export function pickTemplate(
  templates: SOPTemplate[],
  payerId: string,
  state: string,
  groupId: string | null,
): SOPTemplate | null {
  let best: { t: SOPTemplate; rank: number } | null = null;
  for (const t of templates) {
    if (isArchived(t)) continue;
    const rank = candidateRank(t, payerId, state, groupId);
    if (rank === null) continue;
    if (best === null || rank < best.rank || (rank === best.rank && compareWithin(t, best.t) < 0)) {
      best = { t, rank };
    }
  }
  return best?.t ?? null;
}
