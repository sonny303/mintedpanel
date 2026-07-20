// E4.2 unified payer setup → E6.5 slim-down → 2026-07-20 re-scope. The
// org-grain setup-funnel derivation (buildPayerSetupRows and its dimension
// model) retired with the PayerSetupList, and the resolution-ID source chain
// retired with the Org Detail settings table (the identifier label is a
// Minted-curated payer fact now; issued VALUES live on enrollment facts and
// payer network targets). What survives here is the shared inclusion rule:
// which payers count as "the organization's payers".
import { isActiveAssignment } from "./payerCatalogActions";
import { PRE_CRED_PAYER_NAME } from "./statusLabels";
import type { OrgPayerAssignment, Payer } from "@/types";

export interface ActiveOrgPayer {
  payer: Payer;
  assignment: OrgPayerAssignment | null;
}

/**
 * The "active organization payer" inclusion rule the whole workspace shares:
 * a catalog payer with an ACTIVE org_payer_assignments subscription — never
 * derived from targets, so a payer added a minute ago is already included.
 * The Pre-Credentialing Setup sentinel is excluded: it is bookkeeping for
 * pre-cred cases, not a payer to set up.
 */
export function activeOrgPayers(
  payers: readonly Payer[],
  assignments: readonly OrgPayerAssignment[],
): ActiveOrgPayer[] {
  const assignmentByPayer = new Map(assignments.map((a) => [a.payerId, a]));
  const out: ActiveOrgPayer[] = [];
  for (const payer of payers) {
    if (payer.name === PRE_CRED_PAYER_NAME) continue;
    const assignment = assignmentByPayer.get(payer.id) ?? null;
    if (!isActiveAssignment(assignment)) continue;
    out.push({ payer, assignment });
  }
  out.sort((a, b) => a.payer.name.localeCompare(b.payer.name));
  return out;
}
