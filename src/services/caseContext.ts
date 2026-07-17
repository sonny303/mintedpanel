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
//   - selectedFacility: the practice address of the facility the CASE selects
//     (E4.3 TE-2, parity audit C3) — resolved from the case's explicit
//     credential_cases.facility_id relationship ONLY, org-scoped. Never derived
//     from the provider's facility set and never a fallback-to-first guess: a
//     case with no facility link (or a link that doesn't resolve inside the
//     caller's org) carries an explicit null.
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
}

export interface CaseContext {
  referenceNumbers: string[];
  // E4.0 TE-7 — the external payer-pipeline state (read-only; the extension
  // shows where the payer is without leaving the portal tab). The tracking ID
  // is already carried by referenceNumbers.
  payerPipelineState: string;
  // E4.3 TE-2 — the facility the case explicitly selects, or null when the
  // case has no facility relationship. Additive; clients that ignore it are
  // unaffected. The key follows this contract's camelCase idiom (the
  // payerPipelineState precedent), unlike the profile endpoint's locked
  // snake_case selected_facility_id.
  selectedFacility: CaseContextFacility | null;
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

  // Case ownership + the latest-wins reference in one org-scoped read. A miss
  // is the route's 404 (cross-org or nonexistent); nothing else is read.
  const { data: caseRow, error: caseErr } = await db
    .from("credential_cases")
    .select("id, payer_reference_id, payer_pipeline_state, facility_id")
    .eq("id", caseId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (caseErr) throw caseErr;
  if (!caseRow) return null;

  const typedCase = caseRow as {
    payer_reference_id: string | null;
    payer_pipeline_state: string | null;
    facility_id: string | null;
  };
  const payerRef = typedCase.payer_reference_id;
  const referenceNumbers = payerRef ? [payerRef] : [];
  const payerPipelineState = typedCase.payer_pipeline_state ?? "not_started";

  // The case's explicit facility relationship is the ONLY facility source —
  // the provider's other assignments are never consulted and there is no
  // fallback-to-first. Org-scoped like every other read here: a facility_id
  // that doesn't resolve inside the caller's org yields the same explicit
  // null as a case with no facility link.
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
    selectedFacility,
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
