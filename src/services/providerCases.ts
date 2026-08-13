// Open cases for one provider — the extension popup's case dropdown
// (GET /api/cases?providerId=). "Open" follows E6.0 `case_status` via
// `isOpenCaseStatus` (src/lib/caseStatus.ts) — NOT the legacy
// credentialing_status_id / status_configs.action_bucket mirror. Null or
// unrecognized case_status stays open (needs a human) rather than silently
// dropping the case.
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
// Phase 4 (SOP↔portal linking) adds `portalTasks`: the case's open, portal-
// linked SOP tasks, so the extension can match the current page's portal_key to
// a task and pass its task_id on the submission touch (closing the right task —
// the Story 7 close-out that had no task source until now).
//
// E4.3 TE-11 adds a second read to this file: searchOrgCases — the case half of
// the extension's unified standalone search (the provider half reuses
// GET /api/providers?search= verbatim). Org-scoped from ctx, matching payer
// name / provider name / tracking id, returning ids + display fields only
// (never beyond the existing list projections).
//
// Server-only surface (no browser-default ctx) — see portalFieldMaps.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { caseStatusLabel, isCaseStatus, isOpenCaseStatus } from "@/lib/caseStatus";
import { normalizePortalKey } from "@/lib/tokenFormat";
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

// One portal-linked open SOP task on a case (Phase 4). One entry per distinct
// portal_key a non-completed task references, so the extension can match the
// page's portal_key and close exactly that task on submit.
export interface OpenProviderCasePortalTask {
  taskId: string;
  title: string;
  portalKey: string;
  status: string;
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
  portalTasks: OpenProviderCasePortalTask[];
}

const CASE_COLUMNS = "id, state, submitted_date, payer_reference_id, case_status, payers(name)";

interface CaseRow {
  id: string;
  state: string;
  submitted_date: string | null;
  payer_reference_id: string | null;
  case_status: string | null;
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

interface TaskRow {
  id: string;
  case_id: string | null;
  title: string;
  status: string;
  sop_content: unknown;
}

/** Null/unknown stay open so a drifted row is never silently dropped. */
function rowIsOpen(caseStatus: string | null): boolean {
  if (caseStatus == null || !isCaseStatus(caseStatus)) return true;
  return isOpenCaseStatus(caseStatus);
}

function displayStatus(caseStatus: string | null): string | null {
  if (caseStatus == null || !isCaseStatus(caseStatus)) return null;
  return caseStatusLabel(caseStatus);
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

  const { data: cases, error: caseErr } = await db
    .from("credential_cases")
    .select(CASE_COLUMNS)
    .eq("org_id", orgId)
    .eq("provider_id", providerId);
  if (caseErr) throw caseErr;

  const open = ((cases ?? []) as unknown as CaseRow[]).filter((row) => rowIsOpen(row.case_status));

  // PR C: latest note + last submission per open case, from the touchlog. One
  // org-scoped read over just the open case ids; skipped when there are none.
  const openIds = open.map((row) => row.id);
  const latestNoteByCase = new Map<string, { notes: string; author: string | null; at: string }>();
  const lastSubmittedByCase = new Map<string, string>();
  const portalTasksByCase = new Map<string, OpenProviderCasePortalTask[]>();
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

    // Phase 4: portal-linked open tasks per case, from ONE more org-scoped read
    // over the same open case ids. A task contributes one entry per DISTINCT
    // portalKey among its steps; completed tasks and steps without a portalKey
    // are skipped. Keys are normalized so the extension's page-key match is a
    // literal string compare (same discipline as the field-map join).
    const { data: taskRows, error: taskErr } = await db
      .from("tasks")
      .select("id, case_id, title, status, sop_content")
      .eq("org_id", orgId)
      .in("case_id", openIds);
    if (taskErr) throw taskErr;
    for (const t of (taskRows ?? []) as unknown as TaskRow[]) {
      if (t.status === "completed" || t.case_id == null) continue;
      const steps = Array.isArray(t.sop_content) ? t.sop_content : [];
      const seen = new Set<string>();
      for (const step of steps) {
        const key = normalizePortalKey((step as { portalKey?: string }).portalKey);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const list = portalTasksByCase.get(t.case_id) ?? [];
        list.push({ taskId: t.id, title: t.title, portalKey: key, status: t.status });
        portalTasksByCase.set(t.case_id, list);
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
      status: displayStatus(row.case_status),
      submittedDate: row.submitted_date,
      payerReferenceId: row.payer_reference_id,
      latestNote: note ? { text: note.notes, author: note.author, at: note.at } : null,
      lastSubmittedAt: lastSubmittedByCase.get(row.id) ?? null,
      portalTasks: portalTasksByCase.get(row.id) ?? [],
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

// One case-search result row — ids + display fields only, never beyond the
// existing list projections (TE-11). Provider display name is first+last (both
// in PROVIDER_LIST_COLUMNS); status is the E6.0 case_status label; payerPipeline
// is the E4.0 pipeline-display input. `caseNumber` is the globally-sequential
// C-<n> display key (migration 20260722120000) so coordinators can search the
// same way the /cases table shows cases.
export interface CaseSearchRow {
  id: string;
  providerId: string;
  providerName: string;
  payerName: string | null;
  state: string;
  status: string | null;
  payerReferenceId: string | null;
  payerPipelineState: string;
  caseNumber: number | null;
  /** Case's practice location (`credential_cases.facility_id`) — extension
   * pre-selects this when opening a case from search so facility.* cards
   * resolve without a second manual pick. Null when the case has none. */
  facilityId: string | null;
}

const CASE_SEARCH_MAX = 50;

const CASE_SEARCH_COLUMNS =
  "id, case_number, state, provider_id, facility_id, payer_reference_id, case_status, payer_pipeline_state, " +
  "providers(id, first_name, last_name), payers(name)";

interface CaseSearchDbRow {
  id: string;
  case_number: number | null;
  state: string;
  provider_id: string;
  facility_id: string | null;
  payer_reference_id: string | null;
  case_status: string | null;
  payer_pipeline_state: string | null;
  providers: { id: string; first_name: string | null; last_name: string | null } | null;
  payers: { name: string | null } | null;
}

/** When the query looks like a case number (`1001`, `C-1001`, `c1001`), return
 * the bare digits so search hits `case_number`. Returns null for ordinary
 * name/payer/ref queries — never strip a leading "c" from words like "cigna". */
export function caseNumberSearchDigits(raw: string): string | null {
  const q = raw.trim().toLowerCase();
  // Optional "c" / "c-" prefix, then digits — so 1001, C-1001, and c1001 hit
  // case_number, while "cigna" (non-digits after c) does not.
  const match = /^(?:c-?)?(\d+)$/.exec(q);
  return match?.[1] ?? null;
}

// E4.3 TE-11 — the case half of the unified standalone search. Org-scoped from
// ctx, matching payer name / provider name / tracking id (payer_reference_id —
// the E4.0 case-list search precedent) AND case number (C-<n> / bare digits) as
// a case-insensitive substring, capped at CASE_SEARCH_MAX. Filtering is in
// memory over the org's own cases (the providerCases.ts idiom, robust across
// the provider/payer FK embeds); the service-role client is org-scoped by the
// eq(org_id) on the read, so a cross-org row can never appear. Returns [] for
// a blank query (no full-table dump).
export async function searchOrgCases(
  ctx: ProviderCasesServiceCtx,
  query: string,
): Promise<CaseSearchRow[]> {
  const { db, orgId } = ctx;
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const caseDigitsQuery = caseNumberSearchDigits(query);

  const { data: cases, error: caseErr } = await db
    .from("credential_cases")
    .select(CASE_SEARCH_COLUMNS)
    .eq("org_id", orgId);
  if (caseErr) throw caseErr;

  const rows: CaseSearchRow[] = [];
  for (const row of (cases ?? []) as unknown as CaseSearchDbRow[]) {
    const providerName =
      `${row.providers?.first_name ?? ""} ${row.providers?.last_name ?? ""}`.trim();
    const payerName = row.payers?.name ?? null;
    const ref = row.payer_reference_id ?? "";
    const caseNumber = row.case_number ?? null;
    const caseDigits = caseNumber != null ? String(caseNumber) : "";
    const haystack = `${providerName} ${payerName ?? ""} ${ref}`.toLowerCase();
    const matchesText = haystack.includes(q);
    const matchesCaseNumber =
      caseDigitsQuery != null && caseDigits !== "" && caseDigits.includes(caseDigitsQuery);
    if (!matchesText && !matchesCaseNumber) continue;
    rows.push({
      id: row.id,
      providerId: row.provider_id,
      providerName,
      payerName,
      state: row.state,
      status: displayStatus(row.case_status),
      payerReferenceId: row.payer_reference_id,
      payerPipelineState: row.payer_pipeline_state ?? "not_started",
      caseNumber,
      facilityId: row.facility_id,
    });
  }

  // Deterministic order: provider, then payer, then state.
  rows.sort(
    (a, b) =>
      a.providerName.localeCompare(b.providerName) ||
      (a.payerName ?? "").localeCompare(b.payerName ?? "") ||
      a.state.localeCompare(b.state),
  );
  return rows.slice(0, CASE_SEARCH_MAX);
}
