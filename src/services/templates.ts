// SOP template CRUD (org-scoped, admin-write enforced by RLS) with audit.
// The archived column is `is_archived`; TemplateInput accepts either alias.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow, snakeizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import type { Database } from "@/integrations/supabase/types";
import type { SOPTaskDefinition, SOPTemplate } from "@/types";

type SopTemplateInsert = Database["public"]["Tables"]["sop_templates"]["Insert"];
type SopTemplateUpdate = Database["public"]["Tables"]["sop_templates"]["Update"];

export interface TemplateInput {
  name: string;
  groupId?: string | null;
  state?: string | null;
  specialty?: string | null;
  payerId?: string | null;
  taskDefinitions: SOPTaskDefinition[];
  archived?: boolean;
  isArchived?: boolean;
}

function normalizeTemplate(row: SOPTemplate): SOPTemplate {
  const archived = Boolean(row.isArchived ?? row.archived ?? false);
  return { ...row, archived, isArchived: archived };
}

function templatePayload(input: Partial<TemplateInput>, orgId: string): SopTemplateInsert {
  const { archived, isArchived, ...rest } = input;
  const payload = snakeizeRow<Record<string, unknown>>(rest);
  payload.org_id = orgId;
  const archiveValue = archived ?? isArchived;
  if (archiveValue !== undefined) payload.is_archived = archiveValue;
  return payload as unknown as SopTemplateInsert;
}

export async function listTemplates(): Promise<SOPTemplate[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("sop_templates")
    .select("*")
    .eq("org_id", orgId)
    .order("name");
  if (error) throw error;
  return camelizeRow<SOPTemplate[]>(data ?? []).map(normalizeTemplate);
}

export async function getTemplate(id: string): Promise<SOPTemplate | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("sop_templates")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeTemplate(camelizeRow<SOPTemplate>(data)) : null;
}

export async function createTemplate(input: TemplateInput): Promise<SOPTemplate> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("sop_templates")
    .insert(templatePayload(input, orgId))
    .select("*")
    .single();
  if (error) throw error;
  const created = normalizeTemplate(camelizeRow<SOPTemplate>(data));
  await writeAudit({
    actionType: "CREATE",
    entityType: "sop_template",
    entityId: created.id,
    after: created,
    description: `Created SOP template ${created.name}`,
  });
  return created;
}

export async function updateTemplate(
  id: string,
  patch: Partial<TemplateInput>,
): Promise<SOPTemplate> {
  const orgId = requireActiveOrg();
  const before = await getTemplate(id);
  const payload = templatePayload(patch, orgId) as unknown as SopTemplateUpdate;
  const { data, error } = await supabase
    .from("sop_templates")
    .update(payload)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (error) throw error;
  const after = normalizeTemplate(camelizeRow<SOPTemplate>(data));
  await writeAudit({
    actionType: "UPDATE",
    entityType: "sop_template",
    entityId: id,
    before,
    after,
    description: `Updated SOP template ${after.name}`,
  });
  return after;
}
