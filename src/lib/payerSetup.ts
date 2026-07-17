// E4.2 (unified payer setup, TE-19/TE-20) — the per-PAYER setup funnel behind
// the Payer Setup workspace's Setup tab. Pure derivation, nothing stored: one
// row per ACTIVE organization payer (a catalog payer with an active
// org_payer_assignments subscription, or a legacy org-scoped payer awaiting
// catalog migration), even when it has ZERO credentialing targets — the
// readiness matrix alone starts from targets and makes a just-selected payer
// invisible, which is exactly the gap this module closes.
//
// Each row carries separate, accurately named dimensions (never one collapsed
// "Ready" badge) and ONE dominant next action in the locked priority order:
//   1. configure credentialing scope     → wizard Payer Network section
//   2. create/adopt the payer SOP        → prefilled template wizard
//   3. resolve provider profile blockers → the payer-scoped generation preview
//   4. register/select the portal        → /admin/portals with payer context
//   5. train form mappings               → capture (forms runner) or the
//                                          training deck (reuses the e4-3a
//                                          unlinked/"needs value" signals)
//   6. run a form dry test               → the F4.2.7 test runner
//   7. configure the resolution ID       → the e4-2c org_payer_settings dialog
//   8. review the generation preview
// A zero-scope LEGACY payer can't take step 1 (payer_network_targets requires
// an assignment row, which legacy payers never have), so its dominant action
// is finding its canonical catalog identity instead.
//
// Signal reuse (do not re-derive): SOP coverage/blockers arrive as the F4.2.2
// readiness rows (buildPayerReadiness + gating, via usePayerReadiness); form
// coverage is the SAME `mappingCoverage` scorecard derivation (TE-16) plus the
// e4-3a `isUnlinkedFieldMap` predicate; dry runs are the F4.2.7 is_test fill
// sessions.
import { isActiveAssignment } from "./payerCatalogActions";
import { resolutionTier, type SopResolutionTier } from "./pickTemplate";
import { isUnlinkedFieldMap } from "./portalMappingHealth";
import { mappingCoverage } from "./payerScorecard";
import { PRE_CRED_PAYER_NAME } from "./statusLabels";
import type {
  FillSession,
  OrgPayerAssignment,
  OrgPayerSetting,
  Payer,
  Portal,
  PortalFieldMap,
  SOPTemplate,
} from "@/types";

/** The slice of an enriched readiness row (usePayerReadiness) this module
 * consumes — EnrichedReadinessRow satisfies it structurally. */
export interface SetupReadinessRow {
  payerId: string;
  state: string;
  ready: boolean;
  coveredCount: number;
  totalCount: number;
  /** The resolved payer-specific template when ready; null when Needs SOP. */
  resolvedTemplateId: string | null;
  /** The resolved payer SOP has ≥1 extension_fill task (only known when ready). */
  hasExtensionFill: boolean;
  /** Currently gated (profile-blocked) providers for this payer × state. */
  blockedCount: number;
  matchKey: { payerId: string; state: string; groupId: string | null };
}

/** A per-state row enriched with the resolved template's tier (the F4.2.1
 * template-tier visibility carried into the setup row/expansion). */
export interface PayerSetupStateRow extends SetupReadinessRow {
  sopTier: SopResolutionTier | null;
}

export type PayerSetupSource = "catalog" | "legacy";

export interface ScopeDimension {
  /** Active group × state targets under this payer (0 = not configured). */
  activeTargets: number;
  states: string[];
}

export type SopDimension =
  | { kind: "no_scope" }
  | {
      kind: "needs_sop";
      covered: number;
      total: number;
      matchKey: SetupReadinessRow["matchKey"];
    }
  | {
      kind: "covered";
      covered: number;
      total: number;
      /** The resolved template tier when it is uniform across the payer's
       * states (org override vs global payer SOP); null when mixed/unknown. */
      tier: SopResolutionTier | null;
    };

export type FormDimension =
  | { kind: "not_applicable" }
  | { kind: "unregistered" }
  | { kind: "capture"; portalKey: string }
  | {
      kind: "training";
      portalKey: string;
      approved: number;
      total: number;
      unlinked: number;
    }
  | { kind: "dry_run_pending"; portalKey: string }
  | { kind: "tested"; portalKey: string; filled: number; gaps: number };

export type GenerationStatus = "ready" | "warning" | "blocked";

export interface GenerationDimension {
  status: GenerationStatus;
  /** Human-readable reasons behind a warning/blocked status. */
  reasons: string[];
}

export type NextAction =
  | { kind: "configure_scope" }
  | { kind: "migrate_legacy" }
  | { kind: "create_sop"; matchKey: SetupReadinessRow["matchKey"] }
  | { kind: "resolve_blockers"; count: number }
  | { kind: "register_portal" }
  | { kind: "train_mappings"; mode: "capture" | "train"; portalKey: string }
  | { kind: "run_dry_test" }
  | { kind: "configure_resolution_id" }
  | { kind: "review_generation" };

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

export interface PayerSetupRow {
  payer: Payer;
  source: PayerSetupSource;
  assignment: OrgPayerAssignment | null;
  scope: ScopeDimension;
  sop: SopDimension;
  form: FormDimension;
  blockedCount: number;
  generation: GenerationDimension;
  nextAction: NextAction;
  resolutionId: ResolutionIdSource;
  /** The payer's per-state readiness rows (the expansion detail). */
  stateRows: PayerSetupStateRow[];
}

export interface PayerSetupInputs {
  /** Org-visible payers (own-org legacy + assigned global catalog rows). */
  payers: readonly Payer[];
  assignments: readonly OrgPayerAssignment[];
  /** F4.2.2 readiness rows, already enriched with blocked counts. */
  readinessRows: readonly SetupReadinessRow[];
  /** Org-visible SOP templates — resolves each covered row's tier only; the
   * coverage decision itself already rode the readiness rows. */
  templates: readonly SOPTemplate[];
  portals: Portal[];
  fieldMaps: PortalFieldMap[];
  /** Recent org fill sessions (real + is_test dry runs). */
  fills: readonly Pick<
    FillSession,
    "portalKey" | "isTest" | "fieldsFilled" | "fieldsSkipped" | "startedAt"
  >[];
  orgSettings: readonly OrgPayerSetting[];
}

function deriveForm(
  payer: Payer,
  rows: readonly SetupReadinessRow[],
  inputs: PayerSetupInputs,
): FormDimension {
  const hasExtensionFill = rows.some((r) => r.hasExtensionFill);
  if (!hasExtensionFill) return { kind: "not_applicable" };

  const payerPortals = inputs.portals.filter((p) => p.payerId === payer.id);
  if (payerPortals.length === 0) return { kind: "unregistered" };
  const portalKeys = new Set(payerPortals.map((p) => p.portalKey));
  const firstPortalKey = payerPortals[0].portalKey;

  // TE-16 — the SAME scorecard derivation; only payerId/portals/fieldMaps
  // matter for the mapping-coverage indicator.
  const coverage = mappingCoverage({
    payerId: payer.id,
    portals: inputs.portals,
    fieldMaps: inputs.fieldMaps,
    cases: [],
    statusConfigs: [],
    fillSessions: [],
  });
  if (!coverage.available) return { kind: "capture", portalKey: firstPortalKey };

  const unlinked = inputs.fieldMaps.filter(
    (m) => portalKeys.has(m.portalKey) && isUnlinkedFieldMap(m),
  ).length;
  if ((coverage.ratio ?? 0) < 1 || unlinked > 0) {
    return {
      kind: "training",
      portalKey: firstPortalKey,
      approved: coverage.numerator ?? 0,
      total: coverage.denominator ?? 0,
      unlinked,
    };
  }

  // Mappings complete — the remaining question is whether a dry run exists.
  let latest: PayerSetupInputs["fills"][number] | null = null;
  for (const f of inputs.fills) {
    if (!f.isTest || !portalKeys.has(f.portalKey)) continue;
    if (!latest || f.startedAt > latest.startedAt) latest = f;
  }
  if (!latest) return { kind: "dry_run_pending", portalKey: firstPortalKey };
  return {
    kind: "tested",
    portalKey: latest.portalKey,
    filled: latest.fieldsFilled,
    gaps: latest.fieldsSkipped?.length ?? 0,
  };
}

function deriveNextAction(row: Omit<PayerSetupRow, "nextAction" | "generation">): NextAction {
  if (row.scope.activeTargets === 0) {
    // A legacy payer has no assignment row, so the payer_network_targets WITH
    // CHECK can never pass for it — the real next step is its catalog cutover.
    return row.source === "legacy" ? { kind: "migrate_legacy" } : { kind: "configure_scope" };
  }
  if (row.sop.kind === "needs_sop") return { kind: "create_sop", matchKey: row.sop.matchKey };
  if (row.blockedCount > 0) return { kind: "resolve_blockers", count: row.blockedCount };
  if (row.form.kind === "unregistered") return { kind: "register_portal" };
  if (row.form.kind === "capture") {
    return { kind: "train_mappings", mode: "capture", portalKey: row.form.portalKey };
  }
  if (row.form.kind === "training") {
    return { kind: "train_mappings", mode: "train", portalKey: row.form.portalKey };
  }
  if (row.form.kind === "dry_run_pending") return { kind: "run_dry_test" };
  if (row.resolutionId === "generic") return { kind: "configure_resolution_id" };
  return { kind: "review_generation" };
}

function deriveGeneration(
  row: Omit<PayerSetupRow, "nextAction" | "generation">,
): GenerationDimension {
  if (row.scope.activeTargets === 0) {
    return { status: "blocked", reasons: ["No credentialing scope configured"] };
  }
  const reasons: string[] = [];
  if (row.sop.kind === "needs_sop") {
    reasons.push("Generic fallback SOP would be used");
  }
  if (row.blockedCount > 0) {
    reasons.push(
      `${row.blockedCount} provider${row.blockedCount === 1 ? "" : "s"} blocked by missing profile data`,
    );
  }
  return reasons.length > 0 ? { status: "warning", reasons } : { status: "ready", reasons };
}

export interface ActiveOrgPayer {
  payer: Payer;
  assignment: OrgPayerAssignment | null;
  source: PayerSetupSource;
}

/**
 * The "active organization payer" inclusion rule the whole workspace shares:
 * a catalog payer with an ACTIVE org_payer_assignments subscription, or an
 * active legacy org-scoped payer — never derived from targets, so a payer
 * added a minute ago is already included. The Pre-Credentialing Setup sentinel
 * is excluded: it is bookkeeping for pre-cred cases, not a payer to set up.
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
    const source: PayerSetupSource = payer.orgId === null ? "catalog" : "legacy";
    if (source === "catalog" && !isActiveAssignment(assignment)) continue;
    if (source === "legacy" && payer.isActive === false) continue;
    out.push({ payer, assignment, source });
  }
  out.sort((a, b) => a.payer.name.localeCompare(b.payer.name));
  return out;
}

/** One setup row per active organization payer, sorted by name. */
export function buildPayerSetupRows(inputs: PayerSetupInputs): PayerSetupRow[] {
  const settingByPayer = new Map(inputs.orgSettings.map((s) => [s.payerId, s]));
  const rowsByPayer = new Map<string, SetupReadinessRow[]>();
  for (const r of inputs.readinessRows) {
    const list = rowsByPayer.get(r.payerId) ?? [];
    list.push(r);
    rowsByPayer.set(r.payerId, list);
  }

  const templateById = new Map(inputs.templates.map((t) => [t.id, t]));

  const rows: PayerSetupRow[] = [];
  for (const { payer, assignment, source } of activeOrgPayers(inputs.payers, inputs.assignments)) {
    // F4.2.1 template-tier visibility: resolve each covered state's tier from
    // the SAME template the readiness projection resolved (never a second
    // pickTemplate pass that could diverge).
    const stateRows: PayerSetupStateRow[] = (rowsByPayer.get(payer.id) ?? []).map((r) => {
      const template = r.resolvedTemplateId ? templateById.get(r.resolvedTemplateId) : undefined;
      return { ...r, sopTier: template ? resolutionTier(template) : null };
    });
    const scope: ScopeDimension = {
      activeTargets: stateRows.reduce((n, r) => n + r.totalCount, 0),
      states: stateRows.map((r) => r.state),
    };
    const covered = stateRows.reduce((n, r) => n + r.coveredCount, 0);
    const firstUncovered = stateRows.find((r) => !r.ready) ?? null;
    const tiers = new Set(stateRows.map((r) => r.sopTier).filter((t) => t !== null));
    const sop: SopDimension =
      scope.activeTargets === 0
        ? { kind: "no_scope" }
        : firstUncovered
          ? {
              kind: "needs_sop",
              covered,
              total: scope.activeTargets,
              matchKey: firstUncovered.matchKey,
            }
          : {
              kind: "covered",
              covered,
              total: scope.activeTargets,
              tier: tiers.size === 1 ? [...tiers][0] : null,
            };
    const form = deriveForm(payer, stateRows, inputs);
    const blockedCount = stateRows.reduce((n, r) => n + r.blockedCount, 0);

    const base = {
      payer,
      source,
      assignment,
      scope,
      sop,
      form,
      blockedCount,
      resolutionId: resolutionIdSource(payer, settingByPayer.get(payer.id)),
      stateRows,
    };
    rows.push({
      ...base,
      generation: deriveGeneration(base),
      nextAction: deriveNextAction(base),
    });
  }

  return rows;
}

export interface PayerSetupSummary {
  total: number;
  generationReady: number;
}

export function summarizePayerSetup(rows: readonly PayerSetupRow[]): PayerSetupSummary {
  return {
    total: rows.length,
    generationReady: rows.filter((r) => r.generation.status === "ready").length,
  };
}
