// Payer & Cases design bundle, screen 3 (Slice C) — pure view logic for the
// tabbed Payer Detail. Every derivation here reads EXISTING pure modules
// rather than re-deriving their rules:
//   · payer-issued IDs → enrollmentIdBadge (Slice D), which itself reads the
//     resolveIdentifierConfig chain — NEVER a locally re-implemented default
//     (the Slice B blocker: NULL columns resolve provider-EXPECTED).
//   · template readiness → the E6.5 funnel rows (buildPayerReadinessFunnel);
//     this module only maps the funnel's next action to the Template Editor's
//     ?intent= param, using Slice F's shipped spellings.
//   · case openness → OPEN_CASE_STATUSES (caseStatus.ts).
import { isOpenCaseStatus } from "@/lib/caseStatus";
import { pickTemplate } from "@/lib/pickTemplate";
import { enrollmentIdBadge, type EnrollmentIdBadge } from "@/lib/payerIssuedIds";
import type { FunnelNextAction } from "@/lib/payerReadinessFunnel";
import type { TemplateEditorIntent } from "@/lib/templateEditorIntent";
import type {
  CredentialCase,
  EnrollmentFact,
  Payer,
  PayerCatalogStatus,
  SOPTemplate,
} from "@/types";

export const PAYER_DETAIL_TABS = [
  "overview",
  "enrollments",
  "cases",
  "templates",
  "scorecard",
  "manage",
] as const;

export type PayerDetailTab = (typeof PAYER_DETAIL_TABS)[number];

export const PAYER_DETAIL_TAB_LABELS: Record<PayerDetailTab, string> = {
  overview: "Overview",
  enrollments: "Enrollments",
  cases: "Cases",
  templates: "Templates",
  scorecard: "Scorecard",
  manage: "Manage",
};

export function parsePayerDetailTab(value: unknown): PayerDetailTab {
  return typeof value === "string" && (PAYER_DETAIL_TABS as readonly string[]).includes(value)
    ? (value as PayerDetailTab)
    : "overview";
}

/**
 * The Template Editor intent a funnel next-action deep-links into. Spellings
 * are Slice F's shipped `TEMPLATE_EDITOR_INTENTS`; `author_sop` and `ready`
 * have no intent (one is a create, the other is done). `capture` exists in the
 * editor but the funnel never emits a capture action, so no mapping can.
 */
const NEXT_ACTION_INTENT: Partial<Record<FunnelNextAction, TemplateEditorIntent>> = {
  register_portal: "register",
  train_mappings: "train",
  repair_drift: "repair",
  run_dry_test: "prove",
};

export function templateIntentForNextAction(action: FunnelNextAction): TemplateEditorIntent | null {
  return NEXT_ACTION_INTENT[action] ?? null;
}

/** The Templates tab's next-step CTA: what to do, and where it goes. */
export interface TemplateNextStep {
  action: FunnelNextAction;
  label: string;
  /** Form-setup ladder position, "" for the non-ladder actions. */
  position: string;
  /** null when the action is "author a template" (no template to open yet). */
  templateId: string | null;
  intent: TemplateEditorIntent | null;
}

const NEXT_ACTION_COPY: Record<FunnelNextAction, { label: string; position: string }> = {
  author_sop: { label: "Author template", position: "" },
  register_portal: { label: "Register portal", position: "Form setup · 1 of 3" },
  train_mappings: { label: "Map fields", position: "Form setup · 2 of 3" },
  repair_drift: { label: "Repair drift", position: "Form setup · drift" },
  run_dry_test: { label: "Check coverage", position: "Form setup · 3 of 3" },
  ready: { label: "Ready", position: "" },
};

export function templateNextStep(row: {
  nextAction: FunnelNextAction;
  sopTemplateId: string | null;
}): TemplateNextStep {
  const copy = NEXT_ACTION_COPY[row.nextAction];
  return {
    action: row.nextAction,
    label: copy.label,
    position: copy.position,
    templateId: row.sopTemplateId,
    intent: templateIntentForNextAction(row.nextAction),
  };
}

export interface PayerTemplateRow {
  id: string;
  name: string;
  state: string | null;
  groupId: string | null;
  taskCount: number;
  updatedAt: string;
  /** True when this row is what the LOCKED resolver returns for its own match
   * key — i.e. a case at this (payer, state, group) actually runs it. A
   * legacy state-less row can never be an active match (`pickTemplate` needs an
   * exact state), and an org override shadows a global row on the same key. */
  isActiveMatch: boolean;
}

/** The payer's own (non-archived) templates, most specific first: a
 * group-scoped row before a group-agnostic one, then by state, then name. */
export function payerTemplateRows(
  templates: readonly SOPTemplate[],
  payerId: string,
): PayerTemplateRow[] {
  // pickTemplate ranks the WHOLE candidate set, so the active-match check has
  // to see every template, not just this payer's.
  const all = [...templates];
  return templates
    .filter((t) => t.payerId === payerId && !t.archived)
    .map((t) => ({
      id: t.id,
      name: t.name,
      state: t.state,
      groupId: t.groupId,
      taskCount: t.taskDefinitions.length,
      updatedAt: t.updatedAt,
      isActiveMatch:
        t.state !== null && pickTemplate(all, payerId, t.state, t.groupId)?.id === t.id,
    }))
    .sort(
      (a, b) =>
        Number(b.groupId !== null) - Number(a.groupId !== null) ||
        (a.state ?? "").localeCompare(b.state ?? "") ||
        a.name.localeCompare(b.name),
    );
}

export interface TemplateStateCoverage {
  covered: number;
  total: number;
  /** "" for a single-state payer — the design only shows the line when the
   * payer spans more than one state (there is nothing to compare otherwise). */
  label: string;
}

/** How much of the payer's own state footprint has a template. Counts only
 * states the payer actually operates in, so a stray template for an
 * out-of-footprint state never inflates coverage past the total. */
export function templateStateCoverage(
  payer: Pick<Payer, "states"> | null,
  rows: readonly PayerTemplateRow[],
): TemplateStateCoverage {
  const states = payer?.states ?? [];
  const withTemplate = new Set(rows.map((r) => r.state).filter((s): s is string => s !== null));
  const covered = states.filter((s) => withTemplate.has(s)).length;
  const total = states.length;
  return {
    covered,
    total,
    label: total > 1 ? `${covered} of ${total} states covered` : "",
  };
}

export interface PayerEnrollmentRow {
  key: string;
  source: "fact" | "case";
  providerId: string;
  providerName: string;
  state: string;
  effectiveDate: string | null;
  /** The captured value / Awaiting-ID wait / "issues nothing", under the
   * payer's own label — via the shared Slice D badge (resolver-backed). */
  badge: EnrollmentIdBadge;
  /** Case rows only — the "From" link back to the capturing case. */
  caseId: string | null;
  caseNumber: number | null;
}

export type PayerEnrollmentCaseSlice = Pick<
  CredentialCase,
  "id" | "providerId" | "payerId" | "state" | "caseStatus" | "confirmedEffectiveDate"
> &
  Partial<Pick<CredentialCase, "payerIndividualProviderId" | "caseNumber">>;

/**
 * Providers credentialed with THIS payer — the payer-scoped mirror of the
 * provider record's derived enrollment view: live enrollment facts (the
 * migration-capture path) plus APPROVED cases (approval captures the effective
 * date and the payer-issued individual ID on the case itself). Read-only:
 * "cases capture, payer pages display". No dedupe, matching
 * providerEnrollments.ts — a live fact keeps its own row so its record stays
 * visible.
 */
export function buildPayerEnrollmentRows(
  payerId: string,
  payer: Payer | null,
  facts: readonly EnrollmentFact[],
  cases: readonly PayerEnrollmentCaseSlice[],
  providerNames: ReadonlyMap<string, string>,
): PayerEnrollmentRow[] {
  const name = (id: string) => providerNames.get(id) ?? "Unknown provider";
  const rows: PayerEnrollmentRow[] = [];
  for (const fact of facts) {
    if (fact.payerId !== payerId || fact.expiredAt != null) continue;
    rows.push({
      key: `fact:${fact.id}`,
      source: "fact",
      providerId: fact.providerId,
      providerName: name(fact.providerId),
      state: fact.state,
      effectiveDate: fact.effectiveDate ?? null,
      badge: enrollmentIdBadge(payer, fact.payerIssuedId ?? null),
      caseId: null,
      caseNumber: null,
    });
  }
  for (const c of cases) {
    if (c.payerId !== payerId || c.caseStatus !== "approved") continue;
    rows.push({
      key: `case:${c.id}`,
      source: "case",
      providerId: c.providerId,
      providerName: name(c.providerId),
      state: c.state,
      effectiveDate: c.confirmedEffectiveDate ?? null,
      badge: enrollmentIdBadge(payer, c.payerIndividualProviderId ?? null),
      caseId: c.id,
      caseNumber: c.caseNumber ?? null,
    });
  }
  return rows.sort(
    (a, b) => a.providerName.localeCompare(b.providerName) || a.state.localeCompare(b.state),
  );
}

export interface PayerCaseRow {
  id: string;
  caseNumber: number | null;
  providerId: string;
  providerName: string;
  state: string;
  /** The EXTERNAL machine (payerPipeline.ts) — Payer Detail shows the payer
   * pipeline stage; the Cases page shows the internal case status. The two are
   * never merged into one label. */
  pipelineState: string;
  submittedDate: string | null;
  approvedDate: string | null;
  effectiveDate: string | null;
}

export type PayerCaseSlice = Pick<
  CredentialCase,
  "id" | "providerId" | "payerId" | "state" | "caseStatus"
> &
  Partial<
    Pick<
      CredentialCase,
      | "caseNumber"
      | "payerPipelineState"
      | "submittedDate"
      | "approvedDate"
      | "confirmedEffectiveDate"
    >
  >;

/** This payer's OPEN cases (the design's "Open cases" table), newest case
 * number first so the freshest work leads. */
export function buildPayerCaseRows(
  payerId: string,
  cases: readonly PayerCaseSlice[],
  providerNames: ReadonlyMap<string, string>,
): PayerCaseRow[] {
  return cases
    .filter((c) => c.payerId === payerId && isOpenCaseStatus(c.caseStatus))
    .map((c) => ({
      id: c.id,
      caseNumber: c.caseNumber ?? null,
      providerId: c.providerId,
      providerName: providerNames.get(c.providerId) ?? "Unknown provider",
      state: c.state,
      pipelineState: c.payerPipelineState ?? "not_started",
      submittedDate: c.submittedDate ?? null,
      approvedDate: c.approvedDate ?? null,
      effectiveDate: c.confirmedEffectiveDate ?? null,
    }))
    .sort((a, b) => (b.caseNumber ?? 0) - (a.caseNumber ?? 0));
}

/**
 * Merge survivors offered on the Manage tab: every OTHER active, non-archived
 * catalog payer. The RPC rejects a merged/retired/archived survivor, so the
 * picker never offers one.
 */
export function payerMergeCandidates(payers: readonly Payer[], loserId: string): Payer[] {
  return payers
    .filter((p) => {
      if (p.id === loserId) return false;
      if (p.archivedAt != null) return false;
      const status: PayerCatalogStatus = p.status ?? "active";
      return status === "active";
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
