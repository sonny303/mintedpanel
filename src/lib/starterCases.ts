// Pure derivation for the starter-pack case auto-attach (Epic 1c / P4). Given an
// org's assigned + starter payers and a freshly created provider, decide which
// (payer, state) credentialing cases to open. The state is the provider's home
// state, and a home-state license must be on file — a payer with no determinable
// state is skipped with a reason. Combos the provider already has a case for are
// excluded (defensive; a brand-new provider has none). Template + MSO routing are
// resolved through the same helpers the manual/launch case flows use, so the
// caller can feed each entry straight into createCase → create_case_with_tasks.
//
// This module has no I/O: MSO routing comes in via the `resolveRouting` callback
// (wire it to getMsoRoutingRule) and templates/msos come in as plain arrays.
import { pickTemplate } from "@/lib/pickTemplate";
import type { Mso, MsoRoutingRule, Payer, Provider, SOPTemplate } from "@/types";

/** Minimal license shape needed to find the provider's home-state license. */
export interface StarterLicense {
  state: string;
  licenseNumber: string | null;
}

export interface StarterCaseToCreate {
  payer: Payer;
  state: string;
  template: SOPTemplate | null;
  mso: Mso | null;
  msoId: string | null;
  licenseNumber: string | null;
}

export interface StarterCaseSkip {
  payer: Payer;
  reason: string;
}

export interface StarterCasePlan {
  toCreate: StarterCaseToCreate[];
  skipped: StarterCaseSkip[];
}

export interface DeriveStarterCasesInput {
  provider: Provider;
  /** Already filtered to the org's assigned + starter (and active) payers. */
  starterPayers: Payer[];
  /** The provider's licenses (form-entered or persisted); matched by home state. */
  licenses: StarterLicense[];
  templates: SOPTemplate[];
  msos: Mso[];
  /** The provider's existing cases, to avoid duplicating (provider, payer, state). */
  existingCases: { payerId: string; state: string }[];
  /** Resolves the MSO routing rule for a payer at a state; wire to getMsoRoutingRule. */
  resolveRouting: (
    payerId: string,
    state: string,
    specialty: string | null,
  ) => MsoRoutingRule | null;
}

export function deriveStarterCases(input: DeriveStarterCasesInput): StarterCasePlan {
  const { provider, starterPayers, licenses, templates, msos, existingCases, resolveRouting } =
    input;

  const toCreate: StarterCaseToCreate[] = [];
  const skipped: StarterCaseSkip[] = [];

  const homeState = (provider.homeState ?? "").trim();
  const homeLicense = homeState ? (licenses.find((l) => l.state === homeState) ?? null) : null;

  for (const payer of starterPayers) {
    // State determination: the provider's home state, gated on a home-state
    // license. No state → skip with a reason (surfaced in the toast).
    if (!homeState) {
      skipped.push({ payer, reason: "No home state on the provider" });
      continue;
    }
    if (!homeLicense) {
      skipped.push({ payer, reason: `No ${homeState} license on file` });
      continue;
    }
    const state = homeState;

    // Never duplicate an existing (provider, payer, state) case.
    if (existingCases.some((c) => c.payerId === payer.id && c.state === state)) {
      continue;
    }

    const rule = resolveRouting(payer.id, state, provider.specialty ?? null);
    const msoId = rule?.routeType === "mso" ? (rule.msoId ?? null) : null;
    const mso = msoId ? (msos.find((m) => m.id === msoId) ?? null) : null;
    const template = pickTemplate(templates, payer.id, state, provider.groupId ?? null);

    toCreate.push({
      payer,
      state,
      template,
      mso,
      msoId,
      licenseNumber: homeLicense.licenseNumber,
    });
  }

  return { toCreate, skipped };
}
