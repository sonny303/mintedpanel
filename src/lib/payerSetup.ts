// E4.2 unified payer setup → E6.5 slim-down. The org-grain setup-funnel
// derivation (buildPayerSetupRows and its dimension model) retired with the
// PayerSetupList: org-scoped dimensions live on the group Payer Network board
// and the generation grid, and the module's funnel is the GLOBAL-tier
// payerReadinessFunnel.ts. What survives here is the shared inclusion rule
// (which payers count as "the organization's payers") and the resolution-ID
// source chain the org-settings table renders.
import { isActiveAssignment } from "./payerCatalogActions";
import { PRE_CRED_PAYER_NAME } from "./statusLabels";
import type { OrgPayerAssignment, OrgPayerSetting, Payer } from "@/types";

/** Which tier the E4.0 approval step would resolve the payer-issued ID from
 * (mirrors resolveIdentifierConfig's label chain — org setting → Minted global
 * → generic — WITHOUT changing that resolver, which stays the runtime seam). */
export type ResolutionIdSource = "org" | "minted" | "generic";

export function resolutionIdSource(
  payer: Pick<Payer, "resolutionIdLabel">,
  setting: Pick<OrgPayerSetting, "resolutionIdLabel"> | null | undefined,
): ResolutionIdSource {
  if (setting?.resolutionIdLabel?.trim()) return "org";
  if (payer.resolutionIdLabel?.trim()) return "minted";
  return "generic";
}

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
