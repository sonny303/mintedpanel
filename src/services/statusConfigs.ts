// Status config CRUD (org-scoped, admin-write enforced by RLS) with audit.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow, snakeizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import type { StatusConfig, StatusTrack } from "@/types";

export interface StatusConfigInput {
  track: StatusTrack;
  label: string;
  color: string;
  sortOrder: number;
  requiredFields?: string[];
}

export async function listStatusConfigs(track?: StatusTrack): Promise<StatusConfig[]> {
  const orgId = requireActiveOrg();
  let query = supabase.from("status_configs").select("*").eq("org_id", orgId).order("sort_order");
  if (track) query = query.eq("track", track);
  const { data, error } = await query;
  if (error) throw error;
  return camelizeRow<StatusConfig[]>(data ?? []);
}

export async function getStatusConfig(id: string): Promise<StatusConfig | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("status_configs")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<StatusConfig>(data) : null;
}

export async function createStatusConfig(input: StatusConfigInput): Promise<StatusConfig> {
  const orgId = requireActiveOrg();
  const payload = { ...snakeizeRow<Record<string, unknown>>(input), org_id: orgId };
  const { data, error } = await supabase
    .from("status_configs")
    .insert(payload as never)
    .select("*")
    .single();
  if (error) throw error;
  const created = camelizeRow<StatusConfig>(data);
  await writeAudit({
    actionType: "CREATE",
    entityType: "status_config",
    entityId: created.id,
    after: created,
    description: `Created status ${created.label}`,
  });
  return created;
}

export async function updateStatusConfig(
  id: string,
  patch: Partial<StatusConfigInput>,
): Promise<StatusConfig> {
  const orgId = requireActiveOrg();
  const before = await getStatusConfig(id);
  const payload = snakeizeRow<Record<string, unknown>>(patch);
  const { data, error } = await supabase
    .from("status_configs")
    .update(payload as never)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (error) throw error;
  const after = camelizeRow<StatusConfig>(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "status_config",
    entityId: id,
    before,
    after,
    description: `Updated status ${after.label}`,
  });
  return after;
}
