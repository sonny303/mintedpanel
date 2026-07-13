// Picks the SOP template for a (payer, state, group). Fallback order (the order
// is load-bearing): an exact payer + state + group match first (a template whose
// groupId is the provider's group, or a group-agnostic template with a null
// groupId), then any template matching payer + state regardless of group, then
// (E1.7b) the seeded GLOBAL FALLBACK — the payerless global general-enrollment
// SOP — so a no-SOP payer gets the generic checklist instead of zero tasks.
// Payer-matched selection is unchanged: the fallback fires only when both
// payer tiers miss. Archived templates are excluded. Centralized from
// NewCaseModal and CreateCasesDialog, which previously kept identical
// module-local copies; E2.2 consumes this same tier for generation stamping.
import type { SOPTemplate } from "@/types";

// The seeded fallback row's fixed UUID (migration
// 20260713120000_sop_template_versions.sql). Identification is by SHAPE
// (global + payerless) so a reseeded environment still labels correctly; the
// constant exists for tests/fixtures and deep links.
export const FALLBACK_SOP_TEMPLATE_ID = "00000000-0000-4000-a000-00000000e17b";

// A fallback template is a global-catalog row (orgId NULL) with no payer match
// key. The domain type predates nullable org_id, so read it loosely here.
export function isFallbackTemplate(template: SOPTemplate): boolean {
  const row = template as SOPTemplate & { orgId: string | null };
  return row.orgId === null && row.payerId === null;
}

export function pickTemplate(
  templates: SOPTemplate[],
  payerId: string,
  state: string,
  groupId: string | null,
): SOPTemplate | null {
  const active = templates.filter((t) => {
    const row = t as SOPTemplate & { archived?: boolean; isArchived?: boolean };
    return !(row.archived ?? row.isArchived ?? false);
  });
  const exact = active.find(
    (t) =>
      t.payerId === payerId && t.state === state && (t.groupId === groupId || t.groupId === null),
  );
  if (exact) return exact;
  const payerState = active.find((t) => t.payerId === payerId && t.state === state);
  if (payerState) return payerState;
  return active.find(isFallbackTemplate) ?? null;
}
