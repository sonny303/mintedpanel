// 3M Slice 6 / D6.5 — the payer universe SOP authoring names.
//
// The Template Editor authors GLOBAL templates (payer-and-cases §2.4), so its
// payer universe is the GLOBAL CATALOG, not "my network". Those two diverged
// the moment create_payer gained p_assign_to_org: a payer authored without an
// org assignment was absent from the old RLS-gated listPayers read. The union
// let the editor render and select that payer for a global template.
//
// This read-path union still keeps authoring complete. OPA-RETIRE later made
// every global row visible to listPayers, and the manual-case picker now uses
// that org-visible read directly. list_global_payers remains the independent
// catalog source for this authoring view.
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
