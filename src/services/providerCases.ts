// Open cases for one provider — the extension popup's case dropdown
// (GET /api/cases?providerId=). "Open" is derived from the org's status
// configuration, never from hardcoded labels: a case is open unless its
// credentialing status has action_bucket 'complete', the config's terminal
// marker (the same bucket the M2 action engine treats as terminal — see
// src/lib/actionState.ts rule 6). A case with no status is unclassified,
// which the app routes to "needs a human" — it is open here too.
//
// PR C (Stories 5, 10, 11) adds three read fields the extension prefills/guards
// off, all derived within the same org-scoped query:
//   - payerReferenceId (Story 5): the case's latest-wins reference, so the
//     extension's reference box prefills on case select.
//   - lastSubmittedAt (Story 10): the most recent submission on the case (a
//     touchpoint with outcome 'submitted'), so the extension can warn on a
//     duplicate submission within N days.
//   - latestNote (Story 11): the most recent touchlog `note` entry on the case,
//     author-resolved, shown on the card.
//
// Server-only surface (no browser-default ctx) — see portalFieldMaps.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface ProviderCasesServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
}

// The latest touchlog note on a case, resolved for display on the card.
export interface CaseLatestNote {
  text: string;
  author: string | null;
  at: string;
}

// One dropdown row: everything the popup renders ("<payer> - <state> -
// <status>") plus submitted_date and the PR C prefill/guard fields. Explicit
// projection, nothing else.
export interface OpenProviderCase {
  id: string;
  payerName: string | null;
  state: string;
  status: string | null;
  submittedDate: string | null;
  payerReferenceId: string | null;
  latestNote: CaseLatestNote | null;
  lastSubmittedAt: string | null;
}

const CASE_COLUMNS =
  "id, state, submitted_date, payer_reference_id, credentialing_status_id, payers(name)";

interface CaseRow {
  id: string;
  state: string;
  submitted_date: string | null;
  payer_reference_id: string | null;
  credentialing_status_id: string | null;
  payers: { name: string | null } | null;
}

interface TouchRow {
  case_id: string;
  entry_type: string;
  outcome: string | null;
  notes: string | null;
  coordinator_id: string | null;
  created_at: string;
}

// Null = the provider is not in the caller's org (the route's 404) — a
// cross-org provider is indistinguishable from one that doesn't exist.
export async function listOpenProviderCases(
  ctx: ProviderCasesServiceCtx,
  providerId: string,
): Promise<OpenProviderCase[] | null> {
  const { db, orgId } = ctx;

  const { data: provider, error: providerErr } = await db
    .from("providers")
    .select("id")
    .eq("id", providerId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (providerErr) throw providerErr;
  if (!provider) return null;

  const { data: statuses, error: statusErr } = await db
    .from("status_configs")
    .select("id, label, action_bucket")
    .eq("org_id", orgId)
    .eq("track", "credentialing");
  if (statusErr) throw statusErr;
  const statusById = new Map(
    (statuses ?? []).map((s) => [s.id as string, s as { label: string; action_bucket: string }]),
  );

  const { data: cases, error: caseErr } = await db
    .from("credential_cases")
    .select(CASE_COLUMNS)
    .eq("org_id", orgId)
    .eq("provider_id", providerId);
  if (caseErr) throw caseErr;

  const open = ((cases ?? []) as unknown as CaseRow[]).filter((row) => {
    if (row.credentialing_status_id == null) return true;
    const status = statusById.get(row.credentialing_status_id);
    return status?.action_bucket !== "complete";
  });

  // PR C: latest note + last submission per open case, from the touchlog. One
  // org-scoped read over just the open case ids; skipped when there are none.
  const openIds = open.map((row) => row.id);
  const latestNoteByCase = new Map<string, { notes: string; author: string | null; at: string }>();
  const lastSubmittedByCase = new Map<string, string>();
  if (openIds.length > 0) {
    const { data: touchRows, error: touchErr } = await db
      .from("touches")
      .select("case_id, entry_type, outcome, notes, coordinator_id, created_at")
      .eq("org_id", orgId)
      .in("case_id", openIds)
      .order("created_at", { ascending: false });
    if (touchErr) throw touchErr;
    const rows = (touchRows ?? []) as unknown as TouchRow[];

    // Rows are newest-first, so the first hit per case wins for each derivation.
    for (const r of rows) {
      if (r.entry_type === "note" && r.notes != null && !latestNoteByCase.has(r.case_id)) {
        latestNoteByCase.set(r.case_id, {
          notes: r.notes,
          author: r.coordinator_id ?? null,
          at: r.created_at,
        });
      }
      if (r.outcome === "submitted" && !lastSubmittedByCase.has(r.case_id)) {
        lastSubmittedByCase.set(r.case_id, r.created_at);
      }
    }

    // Resolve note authors to display names (full_name, else email).
    const authorIds = Array.from(
      new Set(
        [...latestNoteByCase.values()].map((n) => n.author).filter((v): v is string => Boolean(v)),
      ),
    );
    if (authorIds.length > 0) {
      const { data: profs, error: profErr } = await db
        .from("profiles")
        .select("id, full_name, email")
        .in("id", authorIds);
      if (profErr) throw profErr;
      const nameById = new Map<string, string | null>();
      for (const p of profs ?? []) {
        nameById.set(p.id as string, (p.full_name as string | null) ?? (p.email as string | null));
      }
      for (const note of latestNoteByCase.values()) {
        if (note.author) note.author = nameById.get(note.author) ?? null;
      }
    }
  }

  const rows = open.map<OpenProviderCase>((row) => {
    const note = latestNoteByCase.get(row.id);
    return {
      id: row.id,
      payerName: row.payers?.name ?? null,
      state: row.state,
      status: row.credentialing_status_id
        ? (statusById.get(row.credentialing_status_id)?.label ?? null)
        : null,
      submittedDate: row.submitted_date,
      payerReferenceId: row.payer_reference_id,
      latestNote: note ? { text: note.notes, author: note.author, at: note.at } : null,
      lastSubmittedAt: lastSubmittedByCase.get(row.id) ?? null,
    };
  });

  // Deterministic dropdown order: payer name, then state (nameless payers last).
  rows.sort((a, b) => {
    if (a.payerName !== b.payerName) {
      if (a.payerName == null) return 1;
      if (b.payerName == null) return -1;
      const byPayer = a.payerName.localeCompare(b.payerName);
      if (byPayer !== 0) return byPayer;
    }
    return a.state.localeCompare(b.state);
  });
  return rows;
}
