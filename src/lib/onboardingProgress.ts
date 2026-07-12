// Pure onboarding-wizard progress contract (redesign E1.0, F1.0.2 / TE-3).
// Section status is DERIVED from scope data at render time — org/party rows,
// provider_groups, facilities, providers row counts — never from stored wizard
// flags, so edits made outside the wizard (legacy routes, imports) are
// reflected instantly. The ordered section registry here is the single source
// both for rendering the page and for deriving the next action (TE-4).
import type { Party } from "@/types";
import { contactErrors, hasContactErrors, isValidEmail } from "@/lib/contactValidation";
import { partyToContactInput } from "@/lib/contacts";

export type OnboardingSectionStatus = "not_started" | "in_progress" | "complete";

export type ActiveSectionKey =
  "org_details" | "provider_group" | "facilities" | "providers" | "assignments" | "payer_network";
export type PreviewSectionKey = "scope_review";
export type OnboardingSectionKey = ActiveSectionKey | PreviewSectionKey;

interface SectionDefBase {
  /** Business vocabulary per Sidebar IA v2 — no modeling jargon. */
  title: string;
  /** Stable DOM id for the section card; the next-action CTA targets it. */
  domId: string;
}

/** Active sections resolve a derived status and can be the next action. */
export interface ActiveSectionDef extends SectionDefBase {
  key: ActiveSectionKey;
  kind: "active";
}

/** Preview sections render disabled "Coming next" — never part of completion. */
export interface PreviewSectionDef extends SectionDefBase {
  key: PreviewSectionKey;
  kind: "preview";
}

export type OnboardingSectionDef = ActiveSectionDef | PreviewSectionDef;

// The exact ordered journey (F1.0.1): the R1 four + the activated R3
// sections (Assignments E1.4, Payer Network E1.5), then the remaining
// preview — visible but disabled until its epic lands.
export const ONBOARDING_SECTIONS: readonly OnboardingSectionDef[] = [
  { key: "org_details", title: "Org details", domId: "wizard-org-details", kind: "active" },
  {
    key: "provider_group",
    title: "Provider Group",
    domId: "wizard-provider-group",
    kind: "active",
  },
  { key: "facilities", title: "Facilities", domId: "wizard-facilities", kind: "active" },
  { key: "providers", title: "Providers", domId: "wizard-providers", kind: "active" },
  // E1.4: Assignments went live — the first R3 preview to activate.
  { key: "assignments", title: "Assignments", domId: "wizard-assignments", kind: "active" },
  // E1.5: Payer Network went live — group×state attachment targets.
  {
    key: "payer_network",
    title: "Payer Network",
    domId: "wizard-payer-network",
    kind: "active",
  },
  { key: "scope_review", title: "Scope Review", domId: "wizard-scope-review", kind: "preview" },
];

export const ACTIVE_SECTIONS: readonly ActiveSectionDef[] = ONBOARDING_SECTIONS.filter(
  (s): s is ActiveSectionDef => s.kind === "active",
);

// ---------- per-section resolvers ----------

export interface OrgDetailsInput {
  orgName: string | null | undefined;
  /** The `owner` party, when assigned. */
  owner: Party | null;
  /** The `customer_escalation_contact` party, when assigned. */
  customer: Party | null;
}

// Org details (TE-3): complete = nonblank org name + owner with nonblank name
// and valid email + customer contact satisfying the E0.8 required contact
// fields (reused via contactErrors — never a second email rule). not_started =
// none of those inputs exists at all; any partial set is in_progress.
export function resolveOrgDetailsStatus(input: OrgDetailsInput): OnboardingSectionStatus {
  const orgNameOk = Boolean(input.orgName?.trim());
  const ownerOk = Boolean(
    input.owner && input.owner.name.trim() && isValidEmail(input.owner.email ?? ""),
  );
  const customerOk = Boolean(
    input.customer && !hasContactErrors(contactErrors(partyToContactInput(input.customer))),
  );
  if (orgNameOk && ownerOk && customerOk) return "complete";
  const anyInput = orgNameOk || input.owner !== null || input.customer !== null;
  return anyInput ? "in_progress" : "not_started";
}

// Facilities / Providers (TE-3): row presence completes the section.
// Deliberately binary in E1.0 — current writes persist only valid rows, not
// drafts; E1.2–E1.3 may broaden their resolver inputs when they define a
// persisted partial-record shape.
export function resolveRowCountStatus(rowCount: number): OnboardingSectionStatus {
  return rowCount > 0 ? "complete" : "not_started";
}

// ≥1 ACTIVE row completes the section — soft-deleted rows (is_active=false)
// never do. Still derived, no flags. Used by Provider Group (E1.1 TE-6) and
// Facilities (E1.2 TE-6) — each epic's sanctioned resolver-input broadening.
export function resolveActiveRowsStatus(
  rows: ReadonlyArray<{ isActive: boolean }>,
): OnboardingSectionStatus {
  return rows.some((r) => r.isActive) ? "complete" : "not_started";
}

// Provider Group (E1.1 TE-6 refinement): complete on ≥1 ACTIVE group.
export function resolveProviderGroupStatus(
  groups: ReadonlyArray<{ isActive: boolean }>,
): OnboardingSectionStatus {
  return resolveActiveRowsStatus(groups);
}

// Payer Network (E1.5 F1.5.1): complete on ≥1 ACTIVE attachment target —
// derived from payer_network_targets rows, never a stored flag. Archived-only
// counts as not_started: every intent was withdrawn, so the case-generation
// input is empty exactly like a never-attached org (the section body still
// lists archived rows for one-click restore).
export function resolvePayerNetworkStatus(
  targets: ReadonlyArray<{ status: string }>,
): OnboardingSectionStatus {
  return targets.some((t) => t.status === "active") ? "complete" : "not_started";
}

// Assignments (E1.4 F1.4.1): complete when EVERY non-terminated provider has
// ≥1 facility assignment; partially covered = in_progress (the first section
// where that state is reachable); no providers yet = not_started (the section
// body points back to Providers). Derived, never stored.
export function resolveAssignmentsStatus(
  providerIds: readonly string[],
  assignments: ReadonlyArray<{ providerId: string | null }>,
): OnboardingSectionStatus {
  if (providerIds.length === 0) return "not_started";
  const assigned = new Set(assignments.map((a) => a.providerId));
  const covered = providerIds.filter((id) => assigned.has(id)).length;
  if (covered === 0) return "not_started";
  return covered === providerIds.length ? "complete" : "in_progress";
}

// ---------- next action (F1.0.3 / TE-4) ----------

// Stable heading id inside a section card — the focus target the next-action
// CTA moves keyboard focus to (the heading carries tabIndex={-1}).
export function sectionHeadingId(def: OnboardingSectionDef): string {
  return `${def.domId}-heading`;
}

// First active section, in registry order, whose status is not complete.
// `null` = every active section complete (callers hand off to the first
// remaining preview instead of a CTA). Callers must not invoke this while
// any required read is unresolved — pass only fully resolved statuses.
export function getNextIncompleteSection(
  statuses: Record<ActiveSectionKey, OnboardingSectionStatus>,
): ActiveSectionDef | null {
  for (const section of ACTIVE_SECTIONS) {
    if (statuses[section.key] !== "complete") return section;
  }
  return null;
}
