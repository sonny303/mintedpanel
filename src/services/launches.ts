// M4 launches service (sanctioned): reads plus the case-generation function.
// Generation goes through the existing createCase path (create_case_with_tasks
// RPC) so audit rows and SOP task seeding behave exactly like manual creation.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import { createCase, type CaseInput, type CaseTaskPayload } from "@/services/cases";
import type { Launch } from "@/types";

export async function listLaunches(): Promise<Launch[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("launches")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at");
  if (error) throw error;
  return camelizeRow<Launch[]>(data ?? []);
}

export async function getLaunch(id: string): Promise<Launch | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("launches")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<Launch>(data) : null;
}

export interface GenerationEntry {
  input: CaseInput;
  tasks: CaseTaskPayload[];
  /** for result reporting */
  providerName: string;
  payerName: string;
}

export interface GenerationResult {
  created: { providerName: string; payerName: string; caseId: string }[];
  failed: { providerName: string; payerName: string; reason: string }[];
}

/** Executes a confirmed generation plan case-by-case through createCase. */
export async function generateLaunchCases(
  launch: Launch,
  entries: GenerationEntry[],
): Promise<GenerationResult> {
  const result: GenerationResult = { created: [], failed: [] };
  for (const entry of entries) {
    try {
      const row = await createCase(entry.input, entry.tasks);
      result.created.push({
        providerName: entry.providerName,
        payerName: entry.payerName,
        caseId: row.id,
      });
    } catch (err) {
      result.failed.push({
        providerName: entry.providerName,
        payerName: entry.payerName,
        reason: err instanceof Error ? err.message : "Create failed",
      });
    }
  }
  await writeAudit({
    actionType: "CREATE",
    entityType: "launch",
    entityId: launch.id,
    after: {
      created: result.created.length,
      failed: result.failed.length,
    },
    description: `Generated ${result.created.length} cases for launch ${launch.name}`,
  });
  return result;
}
