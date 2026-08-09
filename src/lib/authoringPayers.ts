// 3M Slice 6 / D6.5 — the payer universe SOP authoring names.
//
// The Template Editor authors GLOBAL templates (payer-and-cases §2.4), so its
// payer universe is the GLOBAL CATALOG, not "my network". Those two diverged
// the moment create_payer gained p_assign_to_org: a payer authored with
// assignToOrg = false has no org_payer_assignments row, so the RLS-gated
// listPayers read cannot see it — the editor would render its match-key payer
// as "—" on the very template being written for it, and a context-free create
// could not pick it at all.
//
// The fix is a read-path union, not another RLS widening: listPayers stays the
// assignment-gated "my network" list that feeds the manual-case picker and
// attach eligibility, and the catalog comes from list_global_payers (the
// SECURITY DEFINER browse read, the same source Payer Detail resolves from for
// exactly this reason).
//
// Org-tier rows are kept in the union because legacy org-scoped payer rows
// exist in local seed fixtures and their (legacy, still-editable) templates
// must keep resolving a name. Catalog rows win a collision: they are the
// canonical identity, and an org row can never share an id with one.
import type { Payer } from "@/types";

/** Non-arrays read as "nothing from that side". This runs during RENDER, so a
 * malformed response must degrade to a shorter list, never throw — a
 * TypeError here takes the whole Template Editor down through the router's
 * error boundary, losing unsaved authoring work over a payer NAME. */
function rows(value: readonly Payer[] | undefined): readonly Payer[] {
  return Array.isArray(value) ? value : [];
}

export function mergeAuthoringPayers(
  orgVisible: readonly Payer[] | undefined,
  globalCatalog: readonly Payer[] | undefined,
): Payer[] {
  const byId = new Map<string, Payer>();
  for (const payer of rows(orgVisible)) byId.set(payer.id, payer);
  for (const payer of rows(globalCatalog)) byId.set(payer.id, payer);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
