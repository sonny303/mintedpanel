// Payer reads + the E6.7 manual-setup write seam.
//
// E4.2 payer governance (closed out 2026-07-18) made this service read-only;
// E6.7 (PM decisions 2026-07-26) reopens ONE sanctioned write path: manual
// payer setup through the create_payer / update_payer SECURITY DEFINER RPCs.
// The service still NEVER issues a direct payers INSERT/UPDATE — the
// 20260718120000 write lockdown stands (no policies, no grants); the RPCs are
// the only door, they validate (name/kind/states), run the duplicate guard,
// stamp provenance, upsert the caller org's org_payer_assignments row
// (create = it's in my network), and write their own audit rows — so this
// service must NOT also writeAudit. Rows are GLOBAL (org_id NULL): authored
// once, template inheritance intact.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg } from "@/lib/audit";
import type { Payer, PayerKind } from "@/types";

export async function listPayers(): Promise<Payer[]> {
  const orgId = requireActiveOrg();
  // Own-org rows plus global-catalog rows (org_id NULL). RLS gates which global
  // rows are returned to the org_payer_assignments-subscribed ones, so this
  // mirrors the portal_field_maps shared-catalog read. The own-org disjunct is
  // vestigial on live data (payers are global-catalog-only since the legacy
  // cutover close-out) but keeps local seed fixtures readable.
  const { data, error } = await supabase
    .from("payers")
    .select("*")
    .or(`org_id.eq.${orgId},org_id.is.null`)
    .order("name");
  if (error) throw error;
  return camelizeRow<Payer[]>(data ?? []);
}

export async function getPayer(id: string): Promise<Payer | null> {
  const orgId = requireActiveOrg();
  // Same visibility as listPayers: an own-org row OR an assigned global row
  // (RLS scopes the global disjunct), so detail surfaces (e.g. the scorecard)
  // can read an assigned catalog payer without any policy change.
  const { data, error } = await supabase
    .from("payers")
    .select("*")
    .eq("id", id)
    .or(`org_id.eq.${orgId},org_id.is.null`)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<Payer>(data) : null;
}

/** The typed duplicate rejection (F6.7.3 acceptance): the RPC's in-body guard
 * raised `payer_duplicate` — the message names the colliding payer (and, for
 * a merged match, its successor), so the dialog can branch to the "use this
 * instead" picker. */
export class PayerDuplicateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayerDuplicateError";
  }
}

const DUPLICATE_PREFIX = "payer_duplicate";

/** E6.8 F6.8.1 — the typed archive rejection: the payer still has open
 * (non-terminal) cases, counted across every org that references the global
 * row. The count lets the future Manage-tab dialog say how many. */
export class PayerArchiveBlockedError extends Error {
  readonly openCaseCount: number;
  constructor(openCaseCount: number) {
    super(
      openCaseCount === 1
        ? "This payer still has 1 open case — close it before archiving."
        : `This payer still has ${openCaseCount} open cases — close them before archiving.`,
    );
    this.name = "PayerArchiveBlockedError";
    this.openCaseCount = openCaseCount;
  }
}

const ARCHIVE_BLOCKED_PREFIX = "payer_archive_open_cases";

/** E6.8 F6.8.2 — the typed merge rejection: re-pointing the loser's open
 * cases would violate the 4-part case key. `conflictingCases` carries the
 * RPC-listed C-<n> labels (first 20) so the dialog can name them. */
export class PayerMergeConflictError extends Error {
  readonly conflictingCases: string[];
  constructor(message: string, conflictingCases: string[]) {
    super(message);
    this.name = "PayerMergeConflictError";
    this.conflictingCases = conflictingCases;
  }
}

const MERGE_CONFLICT_PREFIX = "payer_merge_case_conflict";

const PAYER_WRITE_ERRORS: Record<string, string> = {
  payer_name_required: "A payer name is required.",
  payer_kind_invalid: "That is not a valid payer type.",
  payer_states_required: "At least one operating state is required.",
  payer_state_invalid: "Operating states must be two-letter codes.",
  payer_not_editable: "This payer is retired or merged and can no longer be edited.",
  // E6.8 lifecycle guards.
  payer_already_archived: "This payer is already archived.",
  payer_not_archived: "This payer isn't archived.",
  payer_merge_self: "A payer can't be merged into itself.",
  payer_merge_loser_merged: "This payer was already merged.",
  payer_merge_survivor_not_active: "The surviving payer must be an active payer.",
  payer_merge_survivor_archived: "The surviving payer is archived — reactivate it first.",
  payer_merge_template_conflict:
    "Both payers carry an active template for the same state and group — archive one of the duplicates first.",
};

function mapPayerWriteError(error: { message?: string }): Error {
  const raw = error.message ?? "";
  if (raw.includes(DUPLICATE_PREFIX)) {
    // Keep the RPC's human-readable tail ("a payer named X already exists…" /
    // "X was merged into Y — add that payer instead").
    const detail = raw.slice(raw.indexOf(DUPLICATE_PREFIX) + DUPLICATE_PREFIX.length + 1).trim();
    return new PayerDuplicateError(detail || "A payer with this name already exists.");
  }
  if (raw.includes(ARCHIVE_BLOCKED_PREFIX)) {
    const count = Number.parseInt(raw.split(":")[1]?.trim() ?? "", 10);
    return new PayerArchiveBlockedError(Number.isFinite(count) && count > 0 ? count : 1);
  }
  if (raw.includes(MERGE_CONFLICT_PREFIX)) {
    const detail = raw
      .slice(raw.indexOf(MERGE_CONFLICT_PREFIX) + MERGE_CONFLICT_PREFIX.length + 1)
      .trim();
    return new PayerMergeConflictError(
      detail
        ? `The merge would collide with existing cases: ${detail}`
        : "The merge would collide with existing cases.",
      detail.match(/C-\d+/g) ?? [],
    );
  }
  // Longest key first — the mapCaseStatusError idiom, so a code that prefixes
  // another can never shadow it.
  const key = Object.keys(PAYER_WRITE_ERRORS)
    .sort((a, b) => b.length - a.length)
    .find((code) => raw.includes(code));
  if (key) return new Error(PAYER_WRITE_ERRORS[key]);
  return error instanceof Error ? error : new Error(raw || "Payer write failed");
}

/** The editable payer facts (create + update share the shape). The legacy
 * resolution_id_* pair is deliberately absent — it deprecates in place
 * (stop-write); provenance/status/merge stay server- or platform-side. */
export interface PayerWriteInput {
  name: string;
  payerKind: PayerKind;
  /** Required, >= 1 — attach eligibility, generation candidates, and the
   * attach-CSV scan all intersect against states[]. */
  states: string[];
  aliases?: string[];
  groupIdLabel?: string | null;
  groupIdExpected?: boolean | null;
  providerIdLabel?: string | null;
  providerIdExpected?: boolean | null;
  delegationNote?: string | null;
  /**
   * 3M Slice 6 / D6.1 — CREATE ONLY (updatePayer ignores it; a payer's
   * identity and an org's adoption of it are separate facts, and editing the
   * former must never touch the latter).
   *
   * Default true: creating still adds the payer to the active org's network,
   * the E6.7 behaviour every existing caller relies on. False authors the
   * GLOBAL identity alone — no org_payer_assignments row, so the payer stays
   * out of "my network", out of attach eligibility, and out of generation
   * until someone adopts it through the existing Add-to-my-network path.
   */
  assignToOrg?: boolean;
}

/** F6.7.1 — create a GLOBAL payer. By default (Slice 6 D6.1) it also adds the
 * payer to the active org's network in the same transaction (the RPC
 * reactivates an archived subscription); `assignToOrg: false` authors the
 * catalog identity only. */
export async function createPayer(input: PayerWriteInput): Promise<Payer> {
  const orgId = requireActiveOrg();
  const rpc = supabase.rpc.bind(supabase);
  const { data, error } = await rpc("create_payer", {
    p_org_id: orgId,
    p_name: input.name,
    p_payer_kind: input.payerKind,
    p_states: input.states,
    p_aliases: input.aliases ?? undefined,
    p_group_id_label: input.groupIdLabel ?? undefined,
    p_group_id_expected: input.groupIdExpected ?? undefined,
    p_provider_id_label: input.providerIdLabel ?? undefined,
    p_provider_id_expected: input.providerIdExpected ?? undefined,
    p_delegation_note: input.delegationNote ?? undefined,
    // Sent EXPLICITLY, never left to the SQL default: an omitted param would
    // read as "assign" no matter what the caller meant, which is the one
    // failure mode this flag exists to prevent.
    p_assign_to_org: input.assignToOrg ?? true,
  });
  if (error) throw mapPayerWriteError(error);
  return camelizeRow<Payer>(data as Record<string, unknown>);
}

/** E6.8 F6.8.1 — archive a payer (reversible; blocked while open cases
 * exist — the RPC raises the typed count). Never a DELETE, never a status
 * change; the archived row stays readable so history keeps resolving. */
export async function archivePayer(id: string): Promise<Payer> {
  const orgId = requireActiveOrg();
  const rpc = supabase.rpc.bind(supabase);
  const { data, error } = await rpc("archive_payer", {
    p_org_id: orgId,
    p_payer_id: id,
  });
  if (error) throw mapPayerWriteError(error);
  return camelizeRow<Payer>(data as Record<string, unknown>);
}

/** E6.8 F6.8.1 — clear the archive flag; attach eligibility, generation
 * candidacy, and the default list derivation all return with it. */
export async function reactivatePayer(id: string): Promise<Payer> {
  const orgId = requireActiveOrg();
  const rpc = supabase.rpc.bind(supabase);
  const { data, error } = await rpc("reactivate_payer", {
    p_org_id: orgId,
    p_payer_id: id,
  });
  if (error) throw mapPayerWriteError(error);
  return camelizeRow<Payer>(data as Record<string, unknown>);
}

/** What one merge moved — the RPC's transaction receipt (audit carries the
 * same counts). */
export interface MergePayerResult {
  survivor: Payer;
  movedTemplates: number;
  movedTargets: number;
  archivedDuplicateTargets: number;
  movedFacts: number;
  expiredDuplicateFacts: number;
  movedOpenCases: number;
  movedAssignments: number;
  dedupedAssignments: number;
}

/** E6.8 F6.8.2 — merge a duplicate payer into the survivor: ONE transaction
 * re-points templates / network targets / enrollment facts / open cases /
 * org subscriptions, aliases the loser's name onto the survivor, and marks
 * the loser merged. A 4-part case-key collision raises the typed
 * PayerMergeConflictError listing the conflicting cases; nothing partial
 * commits. Not undoable from the app. */
export async function mergePayer(loserId: string, survivorId: string): Promise<MergePayerResult> {
  const orgId = requireActiveOrg();
  const rpc = supabase.rpc.bind(supabase);
  const { data, error } = await rpc("merge_payer", {
    p_org_id: orgId,
    p_loser_id: loserId,
    p_survivor_id: survivorId,
  });
  if (error) throw mapPayerWriteError(error);
  // camelizeRow is deep — the nested survivor row camelizes in the same pass.
  return camelizeRow<MergePayerResult>(data as Record<string, unknown>);
}

/** F6.7.1b — edit an ACTIVE global payer's facts (same validation + duplicate
 * guard as create, excluding the row itself; states can never be emptied). */
export async function updatePayer(id: string, input: PayerWriteInput): Promise<Payer> {
  const orgId = requireActiveOrg();
  const rpc = supabase.rpc.bind(supabase);
  const { data, error } = await rpc("update_payer", {
    p_org_id: orgId,
    p_payer_id: id,
    p_name: input.name,
    p_payer_kind: input.payerKind,
    p_states: input.states,
    p_aliases: input.aliases ?? undefined,
    p_group_id_label: input.groupIdLabel ?? undefined,
    p_group_id_expected: input.groupIdExpected ?? undefined,
    p_provider_id_label: input.providerIdLabel ?? undefined,
    p_provider_id_expected: input.providerIdExpected ?? undefined,
    p_delegation_note: input.delegationNote ?? undefined,
  });
  if (error) throw mapPayerWriteError(error);
  return camelizeRow<Payer>(data as Record<string, unknown>);
}
