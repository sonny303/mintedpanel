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
import type { CaseGenerationRun } from "@/types";

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

export async function recordGenerationRun(counts: GenerationRunCounts): Promise<CaseGenerationRun> {
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
    })
    .select("*")
    .single();
  if (error) throw error;
  return camelizeRow<CaseGenerationRun>(data);
}
