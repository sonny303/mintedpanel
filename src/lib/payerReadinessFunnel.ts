// E6.5 F6.5.1 — the per-payer "Ready for business" funnel, the module head of
// the consolidated Payer Setup workspace. Pure derivation over the GLOBAL
// catalog tier: a payer is ready when a global SOP is published for it AND —
// when that SOP actually drives an online form — the form is registered,
// trained, and proven by a mock dry run, with no unrepaired drift.
//
// Supersedes the E4.2 org-grain PayerSetupList derivation (payerSetup.ts):
// org-scoped dimensions (scope targets, blockers, generation state) now live
// on the group board / generation grid; this funnel measures the
// authored-once-inherited-everywhere platform state instead.
import { normalizePortalKey } from "@/lib/tokenFormat";
import type { PortalFieldMap, SOPTaskDefinition } from "@/types";

export type FunnelFormState = "none" | "registered" | "trained" | "proven";

export type FunnelNextAction =
  "author_sop" | "register_portal" | "train_mappings" | "repair_drift" | "run_dry_test" | "ready";

export interface FunnelPayerInput {
  id: string;
  name: string;
}

// Narrow SOP shape (structural, not the full SOPTemplate — the hook adapts).
export interface FunnelSopInput {
  id: string;
  orgId: string | null;
  payerId: string | null;
  state: string | null;
  archived: boolean;
  taskDefinitions: SOPTaskDefinition[];
}

export interface FunnelPortalInput {
  id: string;
  orgId: string | null;
  portalKey: string;
  name: string;
  payerId: string | null;
  isVerified: boolean;
  provenAt?: string | null;
}

export interface FunnelRow {
  payerId: string;
  payerName: string;
  /** ≥1 active GLOBAL SOP names this payer. */
  sopPublished: boolean;
  sopCount: number;
  /** The payer's SOPs carry ≥1 online_form step ⇒ a portal is required. */
  needsPortal: boolean;
  formState: FunnelFormState;
  /** First matched portal key (payer-linked or SOP-step-linked), for links. */
  portalKey: string | null;
  driftCount: number;
  nextAction: FunnelNextAction;
  ready: boolean;
  /** Set when ready without a portal (the SOP has no online form step). */
  readyNote: string | null;
  /** Any authoring signal at all — the UI splits started vs not-started. */
  started: boolean;
}

export interface BuildFunnelInput {
  payers: FunnelPayerInput[];
  /** SOP heads visible to the module; non-global/archived rows are ignored. */
  sops: FunnelSopInput[];
  /** All visible portals (global + own-org). */
  portals: FunnelPortalInput[];
  /** All visible non-retired field maps (global + own-org). */
  fieldMaps: PortalFieldMap[];
  /** portalKey → drifted mappings (formDrift.buildDriftByPortal). */
  driftByPortal?: ReadonlyMap<string, PortalFieldMap[]>;
}

/** The normalized portal keys an SOP's online_form steps reference, plus
 * whether any online_form step exists at all (with or without a key). */
export function sopOnlineFormNeeds(defs: readonly SOPTaskDefinition[]): {
  hasOnlineForm: boolean;
  portalKeys: string[];
} {
  let hasOnlineForm = false;
  const keys = new Set<string>();
  for (const def of Array.isArray(defs) ? defs : []) {
    for (const step of Array.isArray(def?.steps) ? def.steps : []) {
      if (step?.stepType !== "online_form") continue;
      hasOnlineForm = true;
      const key = normalizePortalKey(step.portalKey);
      if (key) keys.add(key);
    }
  }
  return { hasOnlineForm, portalKeys: [...keys] };
}

export function buildPayerReadinessFunnel(input: BuildFunnelInput): FunnelRow[] {
  const drift = input.driftByPortal ?? new Map<string, PortalFieldMap[]>();

  const globalSopsByPayer = new Map<string, FunnelSopInput[]>();
  for (const sop of input.sops) {
    if (sop.orgId !== null || sop.archived || !sop.payerId) continue;
    const list = globalSopsByPayer.get(sop.payerId) ?? [];
    list.push(sop);
    globalSopsByPayer.set(sop.payerId, list);
  }

  const portalsByPayer = new Map<string, FunnelPortalInput[]>();
  const portalsByKey = new Map<string, FunnelPortalInput>();
  for (const portal of input.portals) {
    if (!portalsByKey.has(portal.portalKey)) portalsByKey.set(portal.portalKey, portal);
    if (portal.payerId) {
      const list = portalsByPayer.get(portal.payerId) ?? [];
      list.push(portal);
      portalsByPayer.set(portal.payerId, list);
    }
  }

  const approvedCountByKey = new Map<string, number>();
  for (const m of input.fieldMaps) {
    if (m.status !== "approved") continue;
    approvedCountByKey.set(m.portalKey, (approvedCountByKey.get(m.portalKey) ?? 0) + 1);
  }

  const rows: FunnelRow[] = [];
  for (const payer of input.payers) {
    const sops = globalSopsByPayer.get(payer.id) ?? [];
    const sopPublished = sops.length > 0;

    // Portals in play for this payer: payer-linked rows ∪ rows the SOP's own
    // online_form steps name by key.
    const stepNeeds = sops.map((s) => sopOnlineFormNeeds(s.taskDefinitions));
    const needsPortal = stepNeeds.some((n) => n.hasOnlineForm);
    const matched = new Map<string, FunnelPortalInput>();
    for (const p of portalsByPayer.get(payer.id) ?? []) matched.set(p.portalKey, p);
    for (const n of stepNeeds) {
      for (const key of n.portalKeys) {
        const p = portalsByKey.get(key);
        if (p) matched.set(key, p);
      }
    }
    const payerPortals = [...matched.values()];

    let formState: FunnelFormState = "none";
    if (payerPortals.length > 0) {
      formState = "registered";
      if (payerPortals.some((p) => (approvedCountByKey.get(p.portalKey) ?? 0) > 0)) {
        formState = "trained";
      }
      if (payerPortals.some((p) => p.provenAt != null)) {
        formState = "proven";
      }
    }

    let driftCount = 0;
    for (const p of payerPortals) driftCount += drift.get(p.portalKey)?.length ?? 0;

    let nextAction: FunnelNextAction;
    let readyNote: string | null = null;
    if (!sopPublished) {
      nextAction = "author_sop";
    } else if (!needsPortal) {
      nextAction = "ready";
      readyNote = "SOP has no online form step — no portal required";
    } else if (formState === "none") {
      nextAction = "register_portal";
    } else if (driftCount > 0) {
      nextAction = "repair_drift";
    } else if (formState === "registered") {
      nextAction = "train_mappings";
    } else if (formState === "trained") {
      nextAction = "run_dry_test";
    } else {
      nextAction = "ready";
    }

    rows.push({
      payerId: payer.id,
      payerName: payer.name,
      sopPublished,
      sopCount: sops.length,
      needsPortal,
      formState,
      portalKey: payerPortals[0]?.portalKey ?? null,
      driftCount,
      nextAction,
      ready: nextAction === "ready",
      readyNote,
      started: sopPublished || payerPortals.length > 0,
    });
  }

  rows.sort((a, b) => a.payerName.localeCompare(b.payerName));
  return rows;
}
