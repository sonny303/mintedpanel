// Picks the SOP template for a (payer, state, group). Fallback order (the order
// is load-bearing): an exact payer + state + group match first (a template whose
// groupId is the provider's group, or a group-agnostic template with a null
// groupId), then any template matching payer + state regardless of group.
// Archived templates are excluded. Centralized from NewCaseModal and
// CreateCasesDialog, which previously kept identical module-local copies.
import type { SOPTemplate } from "@/types";

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
  return active.find((t) => t.payerId === payerId && t.state === state) ?? null;
}
