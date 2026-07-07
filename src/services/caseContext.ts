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

export interface CaseContext {
  referenceNumbers: string[];
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
    .select("id, payer_reference_id")
    .eq("id", caseId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (caseErr) throw caseErr;
  if (!caseRow) return null;

  const payerRef = (caseRow as { payer_reference_id: string | null }).payer_reference_id;
  const referenceNumbers = payerRef ? [payerRef] : [];

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
