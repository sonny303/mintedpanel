// Case context for the Workbench (GET /api/cases/:id/context). After the human
// picks a case in the popup, the extension pulls this small read so the filler
// sees the case's reference number(s) + the latest note/touch without leaving
// the portal tab. PHI-minimal by design: only these small fields, no unrelated
// case columns.
//
// Sources, all org-scoped:
//   - referenceNumbers: credential_cases.payer_reference_id (latest-wins; the
//     column, not the touchlog history). A small array so the wire shape is
//     stable if a case ever surfaces more than one.
//   - provider / payer / state (E4.3 TE-2): the case's identity header — the
//     panel names the provider, payer, and state it is operating as (the
//     F4.3.1 identity guard). Display fields only: id + name, never the
//     provider row (the profile endpoint is the PHI surface).
//   - openTasks (E4.3 TE-2): the case's open (non-completed) SOP tasks with
//     their E4.2 execution types (null execution_type resolves to 'manual'),
//     ordered by sort_order — the E4.2 F4.2.1 "workbench payload tee-up".
//     Task-state writes stay in the webapp (R6 non-goal); this is read-only.
//   - selectedFacility: the practice address of the facility the CASE selects
//     (E4.3 TE-2, parity audit C3) — resolved from the case's explicit
//     credential_cases.facility_id relationship ONLY, org-scoped. Never derived
//     from the provider's facility set and never a fallback-to-first guess: a
//     case with no facility link (or a link that doesn't resolve inside the
//     caller's org) carries an explicit null.
//   - facilities (E1.4): the case's FULL location set — `case_facilities`
//     joined to `facilities`, org-scoped on both the join row and the joined
//     facility. Primary row first, then alphabetical by name; `isPrimary`
//     rides each row. Additive alongside selectedFacility, which stays the
//     primary-only field every existing extension build depends on — this is
//     for the Workbench to show every location while still filling one.
//   - latestNote: the newest `note` entry in the touchlog (author-resolved).
//     The `notes` table is DORMANT for case entities since the touchlog
//     migration (Story 1) — case notes live in `touches` now, so this reads the
//     same spine the case dropdown does (see providerCases.ts), never the stale
//     notes table.
//   - latestTouch: the newest touchpoint (an actual contact/submission) — the
//     entry type that carries touch_type + outcome.
// Both note + touch are derived from ONE org-scoped touchlog read; the per-case
// projection differs from providerCases.ts (single case, latestTouch added, the
// endpoint's own field names), so this is its own small service rather than a
// second copy of that multi-case query.
//
// Server-only surface (no browser-default ctx) — see portalFieldMaps.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isPayerFormRemoved } from "@/lib/payerForms";
import { resolveExecutionType } from "@/lib/executionTypes";

export interface CaseContextServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
}

// The latest touchlog note on the case, resolved for display.
export interface CaseContextNote {
  content: string;
  createdAt: string;
  authorName: string | null;
}

// The latest touchpoint on the case — the actual contact/submission record.
export interface CaseContextTouch {
  touchDate: string | null;
  touchType: string | null;
  outcome: string | null;
  note: string | null;
}

// The case-selected facility with its complete (nullable) practice address, so
// the extension can render the location it is filling for without guessing.
export interface CaseContextFacility {
  id: string;
  name: string;
  street: string | null;
  suite: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  // E1.4 — set on `facilities[]` entries only (true for the case's primary
  // row). Absent on `selectedFacility`, which is already known to be the
  // primary by definition — no need to badge it there.
  isPrimary?: boolean;
}

// The case's provider/payer identity for the panel header — display fields
// only (id + name), never a row payload.
export interface CaseContextParty {
  id: string;
  name: string;
}

// One open SOP task with its E4.2 execution type (TE-2). `extension_fill`
// tasks are the ones the extension offers the fill action on; the rest render
// as read-only checklist context.
// S4.3 — one SOP step on an open task, for the extension's Progress tab.
// LABELS AND STATE ONLY: no dataFields, no resolved values, no email bodies —
// the step's shape is workflow metadata, and the fill payload stays the
// profile endpoint's job.
export interface CaseContextTaskStep {
  id: string;
  label: string;
  order: number;
  isCompleted: boolean;
  stepType: string | null;
  // The portal an online_form step points at (bare key), so the panel can mark
  // the step for the page in hand.
  portalKey: string | null;
}

export interface CaseContextTask {
  id: string;
  title: string;
  status: string;
  executionType: string;
  sortOrder: number;
  dueDate: string | null;
  // S4.3: the task's steps, ordered. Empty for a task with no SOP content.
  steps: CaseContextTaskStep[];
}

// Reduce a task's sop_content jsonb to the Progress tab's step projection.
// Defensive: malformed/absent content yields [], never a throw — a broken SOP
// row must not take out the whole case context.
function projectTaskSteps(raw: unknown): CaseContextTaskStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: CaseContextTaskStep[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object") continue;
    const step = item as Record<string, unknown>;
    if (typeof step.id !== "string" || typeof step.label !== "string") continue;
    steps.push({
      id: step.id,
      label: step.label,
      order: typeof step.order === "number" ? step.order : steps.length,
      isCompleted: step.isCompleted === true,
      stepType: typeof step.stepType === "string" ? step.stepType : null,
      portalKey: typeof step.portalKey === "string" ? step.portalKey : null,
    });
  }
  return steps.sort((a, b) => a.order - b.order);
}

export interface CaseContext {
  referenceNumbers: string[];
  // E4.0 TE-7 — the external payer-pipeline state (read-only; the extension
  // shows where the payer is without leaving the portal tab). The tracking ID
  // is already carried by referenceNumbers.
  payerPipelineState: string;
  // E4.3 TE-2 — the identity header fields: the provider and payer the case
  // belongs to, and its state. Additive; clients that ignore them are
  // unaffected. Keys follow this contract's camelCase idiom (the
  // payerPipelineState precedent), unlike the profile endpoint's locked
  // snake_case selected_facility_id.
  provider: CaseContextParty | null;
  payer: CaseContextParty | null;
  state: string;
  // E4.3 TE-2 — the facility the case explicitly selects, or null when the
  // case has no facility relationship.
  selectedFacility: CaseContextFacility | null;
  // E1.4 — the case's FULL location set (`case_facilities` joined to
  // `facilities`), primary row first then alphabetical by name. Additive
  // alongside `selectedFacility`, which is UNCHANGED and still means "the
  // primary" — this array is every location the case has, so the extension
  // can show them all while still filling exactly one at a time.
  facilities: CaseContextFacility[];
  // E4.3 TE-2 — the case's open SOP tasks with execution types (read-only).
  openTasks: CaseContextTask[];
  latestNote: CaseContextNote | null;
  latestTouch: CaseContextTouch | null;
}

interface TouchRow {
  entry_type: string;
  touch_type: string | null;
  outcome: string | null;
  touch_date: string | null;
  notes: string | null;
  coordinator_id: string | null;
  created_at: string;
}

// Null = the case is not in the caller's org (the route's 404) — a cross-org
// case is indistinguishable from one that doesn't exist.
export async function getCaseContext(
  ctx: CaseContextServiceCtx,
  caseId: string,
): Promise<CaseContext | null> {
  const { db, orgId } = ctx;

  // Case ownership + the latest-wins reference + the identity-header fields in
  // one org-scoped read (provider/payer ride as FK embeds — display columns
  // only). A miss is the route's 404 (cross-org or nonexistent); nothing else
  // is read.
  const { data: caseRow, error: caseErr } = await db
    .from("credential_cases")
    .select(
      "id, state, payer_reference_id, payer_pipeline_state, facility_id, " +
        "providers(id, first_name, last_name), payers(id, name)",
    )
    .eq("id", caseId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (caseErr) throw caseErr;
  if (!caseRow) return null;

  const typedCase = caseRow as unknown as {
    state: string;
    payer_reference_id: string | null;
    payer_pipeline_state: string | null;
    facility_id: string | null;
    providers: { id: string; first_name: string | null; last_name: string | null } | null;
    payers: { id: string; name: string | null } | null;
  };
  const payerRef = typedCase.payer_reference_id;
  const referenceNumbers = payerRef ? [payerRef] : [];
  const payerPipelineState = typedCase.payer_pipeline_state ?? "not_started";
  const provider: CaseContextParty | null = typedCase.providers
    ? {
        id: typedCase.providers.id,
        name: `${typedCase.providers.first_name ?? ""} ${typedCase.providers.last_name ?? ""}`.trim(),
      }
    : null;
  const payer: CaseContextParty | null = typedCase.payers
    ? { id: typedCase.payers.id, name: typedCase.payers.name ?? "" }
    : null;

  // Open SOP tasks with execution types (TE-2) — one org-scoped read, explicit
  // projection, ordered by sort_order. 'completed' is the closed status; every
  // other status counts as open (the providerCases.ts idiom).
  const { data: taskRows, error: taskErr } = await db
    .from("tasks")
    .select("id, title, status, execution_type, sort_order, due_date, sop_content")
    .eq("org_id", orgId)
    .eq("case_id", caseId)
    .neq("status", "completed")
    .order("sort_order", { ascending: true });
  if (taskErr) throw taskErr;
  const openTasks: CaseContextTask[] = (
    (taskRows ?? []) as Array<{
      id: string;
      title: string;
      status: string;
      execution_type: string | null;
      sort_order: number;
      due_date: string | null;
      sop_content: unknown;
    }>
  )
    // Payer PDF: a payer form the coordinator removed from this case is off it
    // for good. The row stays as `blocked` for the audit trail, and `blocked`
    // counts as OPEN above — so without this the extension would be handed a
    // task to work for a form that is no longer part of the case. Filtered
    // server-side rather than in the extension: the wire shape is unchanged, so
    // no coordinated release is needed.
    .filter((t) => !isPayerFormRemoved(t.sop_content))
    .map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      executionType: resolveExecutionType(t.execution_type),
      sortOrder: t.sort_order,
      dueDate: t.due_date,
      steps: projectTaskSteps(t.sop_content),
    }));

  // E1.4 — the case's FULL location set, `case_facilities` joined to
  // `facilities`. Org-scoped on both the join row and the joined facility — a
  // facility outside the caller's org can never appear here. Sorted
  // primary-first then alphabetical by name, the same convention as the
  // browser-ctx `getCaseFacilities` in src/services/cases.ts (not imported
  // here — server routes stay on ctx.db, never the browser client). Read
  // unconditionally (unlike selectedFacility below, which only fires when
  // `facility_id` is set) — a case can carry locations even before one is
  // marked primary.
  const { data: caseFacilityRows, error: caseFacilityErr } = await db
    .from("case_facilities")
    .select("is_primary, facility:facilities!inner(id, name, street, suite, city, state, zip)")
    .eq("case_id", caseId)
    .eq("org_id", orgId)
    .eq("facility.org_id", orgId);
  if (caseFacilityErr) throw caseFacilityErr;
  const facilities: CaseContextFacility[] = (
    (caseFacilityRows ?? []) as unknown as Array<{
      is_primary: boolean;
      facility: {
        id: string;
        name: string;
        street: string | null;
        suite: string | null;
        city: string | null;
        state: string | null;
        zip: string | null;
      } | null;
    }>
  )
    .filter((r) => r.facility != null)
    .map((r) => ({
      id: r.facility!.id,
      name: r.facility!.name,
      street: r.facility!.street,
      suite: r.facility!.suite,
      city: r.facility!.city,
      state: r.facility!.state,
      zip: r.facility!.zip,
      isPrimary: r.is_primary === true,
    }))
    .sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  // The case's explicit facility relationship is the ONLY source
  // `selectedFacility` resolves from — the provider's other assignments are
  // never consulted and there is no fallback-to-first. Org-scoped like every
  // other read here: a facility_id that doesn't resolve inside the caller's
  // org yields the same explicit null as a case with no facility link. Left
  // UNCHANGED by E1.4 — still the primary, resolved exactly as before;
  // `facilities` above is the additive full set.
  let selectedFacility: CaseContextFacility | null = null;
  if (typedCase.facility_id) {
    const { data: facilityRow, error: facilityErr } = await db
      .from("facilities")
      .select("id, name, street, suite, city, state, zip")
      .eq("id", typedCase.facility_id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (facilityErr) throw facilityErr;
    if (facilityRow) {
      const f = facilityRow as {
        id: string;
        name: string;
        street: string | null;
        suite: string | null;
        city: string | null;
        state: string | null;
        zip: string | null;
      };
      selectedFacility = {
        id: f.id,
        name: f.name,
        street: f.street,
        suite: f.suite,
        city: f.city,
        state: f.state,
        zip: f.zip,
      };
    }
  }

  // One org-scoped touchlog read, newest-first: the latest note entry AND the
  // latest touchpoint are both picked off it (first hit per kind wins).
  const { data: touchRows, error: touchErr } = await db
    .from("touches")
    .select("entry_type, touch_type, outcome, touch_date, notes, coordinator_id, created_at")
    .eq("org_id", orgId)
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });
  if (touchErr) throw touchErr;
  const rows = (touchRows ?? []) as unknown as TouchRow[];

  let noteRow: TouchRow | null = null;
  let touchpointRow: TouchRow | null = null;
  for (const r of rows) {
    if (!noteRow && r.entry_type === "note" && r.notes != null) noteRow = r;
    if (!touchpointRow && r.entry_type === "touchpoint") touchpointRow = r;
    if (noteRow && touchpointRow) break;
  }

  // Resolve the note author to a display name (full_name, else email).
  let authorName: string | null = null;
  if (noteRow?.coordinator_id) {
    const { data: prof, error: profErr } = await db
      .from("profiles")
      .select("full_name, email")
      .eq("id", noteRow.coordinator_id)
      .maybeSingle();
    if (profErr) throw profErr;
    const p = prof as { full_name: string | null; email: string | null } | null;
    authorName = p?.full_name ?? p?.email ?? null;
  }

  return {
    referenceNumbers,
    payerPipelineState,
    provider,
    payer,
    state: typedCase.state,
    selectedFacility,
    facilities,
    openTasks,
    latestNote: noteRow
      ? { content: noteRow.notes as string, createdAt: noteRow.created_at, authorName }
      : null,
    latestTouch: touchpointRow
      ? {
          touchDate: touchpointRow.touch_date,
          touchType: touchpointRow.touch_type,
          outcome: touchpointRow.outcome,
          note: touchpointRow.notes,
        }
      : null,
  };
}
