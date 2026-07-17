// E2.4 TE-8 — the run-history reads: the org's runs (newest first, actor
// names resolved via the existing profiles pattern) and one run's immutable
// disposition rows. Browser → Supabase under RLS (locked decision 1 — no
// /api route; the extension pulls nothing here). Display names for
// provider/group/payer join at read time in the composition hook from the
// org caches — the rows store FKs + reason only.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg } from "@/lib/audit";
import type { SopResolutionTier } from "@/lib/pickTemplate";
import type { CaseGenerationRun, CaseGenerationRunRow, GenerationRowDisposition } from "@/types";

export interface GenerationRunListEntry extends CaseGenerationRun {
  /** The confirming actor's display name (profiles full_name → email). */
  createdByName: string | null;
}

export async function listGenerationRuns(): Promise<GenerationRunListEntry[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("case_generation_runs")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const runs = camelizeRow<CaseGenerationRun[]>(data ?? []);

  const actorIds = Array.from(
    new Set(runs.map((r) => r.createdBy).filter((v): v is string => Boolean(v))),
  );
  const nameMap = new Map<string, string | null>();
  if (actorIds.length > 0) {
    const { data: profs, error: profErr } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", actorIds);
    if (profErr) throw profErr;
    for (const p of profs ?? []) {
      nameMap.set(p.id as string, (p.full_name as string | null) ?? (p.email as string | null));
    }
  }
  return runs.map((r) => ({
    ...r,
    createdByName: r.createdBy ? (nameMap.get(r.createdBy) ?? null) : null,
  }));
}

/** The runs LIST's counts input: every run's disposition values in ONE
 * narrow org-scoped read (never per-run round-trips), grouped by run id in
 * the hook. */
export interface RunDispositionRow {
  runId: string;
  disposition: GenerationRowDisposition;
}

export async function listRunDispositions(): Promise<RunDispositionRow[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("case_generation_run_rows")
    .select("run_id, disposition")
    .eq("org_id", orgId);
  if (error) throw error;
  return camelizeRow<RunDispositionRow[]>(data ?? []);
}

export async function listGenerationRunRows(runId: string): Promise<CaseGenerationRunRow[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("case_generation_run_rows")
    .select("*")
    .eq("org_id", orgId)
    .eq("run_id", runId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return camelizeRow<CaseGenerationRunRow[]>(data ?? []);
}

/** E4.2 SOP hardening — the resolution-tier usage read: every confirmed run row
 * whose resolved SOP was of `tier` (e.g. the generic fallback), org-scoped. The
 * returned rows carry the run/payer/state/group dimensions, so generic-fallback
 * usage is countable by generation run, payer, state, group — and by
 * organization via this org-scoped read (`countRunRowsBy` in
 * src/lib/generationRuns.ts does the per-dimension grouping). */
export async function listGenerationRunRowsByTier(
  tier: SopResolutionTier,
): Promise<CaseGenerationRunRow[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("case_generation_run_rows")
    .select("*")
    .eq("org_id", orgId)
    .eq("sop_resolution_tier", tier)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return camelizeRow<CaseGenerationRunRow[]>(data ?? []);
}
