// E2.1 TE-2 — the case_generation_runs writer. ONE boundary for the counts
// write (the epic's named tech debt: E2.4 repoints this single function when
// its disposition child rows supersede the stored counts). The run row is
// inserted BEFORE the confirm loop — created cases FK it via
// generation_run_id — and is immutable by omission (no UPDATE/DELETE policy
// or grant), so the stored counts are the confirm-time plan; actual outcomes
// are reported in the run's audit row by the confirm service.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { currentUserId, requireActiveOrg } from "@/lib/audit";
import type { GenerationRunCounts } from "@/lib/generationConfirm";
import type { SopResolutionTier } from "@/lib/pickTemplate";
import type { CaseGenerationRun, GenerationRowDisposition } from "@/types";

// E2.4 TE-1/TE-2 — the disposition child-row writer: one immutable row per
// candidate key per run, INSERT-only (no UPDATE/DELETE policy or grant),
// written when the outcome is known — skipped/excluded at confirm, created/
// failed as each RPC resolves (the confirm loop calls this per outcome, so a
// mid-batch crash leaves an honestly short record). Only ids, the
// disposition, and reason text land here — never an exclusion note, never
// PHI (TE-8).
export interface GenerationRunRowInput {
  runId: string;
  providerId: string;
  groupId: string;
  payerId: string;
  state: string;
  disposition: GenerationRowDisposition;
  reason?: string | null;
  caseId?: string | null;
  exclusionId?: string | null;
  /** E4.2 SOP hardening — the structured resolution provenance for a `created`
   * row: which SOP resolved, at which version, at which deterministic tier
   * (organization | global_payer | generic_fallback). A snapshot at confirm
   * time (like `reason`) — never a mutable link — so generic-fallback usage is
   * countable per run/payer/state/group without reconstructing tier from
   * template ownership. Null for skipped/excluded/failed rows (no SOP resolved). */
  sopTemplateId?: string | null;
  sopVersion?: number | null;
  sopResolutionTier?: SopResolutionTier | null;
}

export async function recordGenerationRunRows(rows: GenerationRunRowInput[]): Promise<void> {
  if (rows.length === 0) return;
  const orgId = requireActiveOrg();
  const { error } = await supabase.from("case_generation_run_rows").insert(
    rows.map((r) => ({
      org_id: orgId,
      run_id: r.runId,
      provider_id: r.providerId,
      group_id: r.groupId,
      payer_id: r.payerId,
      state: r.state,
      disposition: r.disposition,
      reason: r.reason ?? null,
      case_id: r.caseId ?? null,
      exclusion_id: r.exclusionId ?? null,
      sop_template_id: r.sopTemplateId ?? null,
      sop_version: r.sopVersion ?? null,
      sop_resolution_tier: r.sopResolutionTier ?? null,
    })),
  );
  if (error) throw error;
}

/** E2.3 TE-6 — the batch-landing banner's read: ONE org-owned run row (the
 * confirm-time plan counts). A cross-org or unknown id resolves to null. */
export async function getGenerationRun(id: string): Promise<CaseGenerationRun | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("case_generation_runs")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<CaseGenerationRun>(data) : null;
}

export async function recordGenerationRun(
  counts: GenerationRunCounts,
  releaseScope?: unknown,
): Promise<CaseGenerationRun> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("case_generation_runs")
    .insert({
      org_id: orgId,
      created_by: currentUserId(),
      proposed_count: counts.proposedCount,
      created_count: counts.createdCount,
      skipped_existing_count: counts.skippedExistingCount,
      excluded_count: counts.excludedCount,
      failed_count: counts.failedCount,
      // E4.2 TE-14 — additive: the release scope this run used (NULL for a full run).
      release_scope: (releaseScope ?? null) as never,
    })
    .select("*")
    .single();
  if (error) throw error;
  return camelizeRow<CaseGenerationRun>(data);
}
