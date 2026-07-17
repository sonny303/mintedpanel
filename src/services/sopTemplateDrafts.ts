// E4.2 F4.2.1 (PM round-4) — SOP wizard save-as-draft persistence. Drafts are
// org-scoped WIP visible/editable by any admin/config user (handoff), NEVER
// resolved for generation or counted toward readiness, and deleted on publish.
// One additive table `sop_template_drafts` (admin-member RLS).

import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit, currentUserId } from "@/lib/audit";
import type { SopTemplateDraft } from "@/types";

const COLUMNS = "id, org_id, template_id, payload, updated_by, created_at, updated_at";

export async function listSopTemplateDrafts(): Promise<SopTemplateDraft[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("sop_template_drafts")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const drafts = camelizeRow<SopTemplateDraft[]>(data ?? []);

  const ids = [...new Set(drafts.map((d) => d.updatedBy).filter((v): v is string => Boolean(v)))];
  if (ids.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids);
    const byId = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email || null]));
    for (const d of drafts) {
      d.updatedByName = d.updatedBy ? (byId.get(d.updatedBy) ?? null) : null;
    }
  }
  return drafts;
}

export async function getSopTemplateDraft(id: string): Promise<SopTemplateDraft | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("sop_template_drafts")
    .select(COLUMNS)
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<SopTemplateDraft>(data) : null;
}

export interface SopTemplateDraftInput {
  id?: string;
  templateId?: string | null;
  payload: unknown;
}

/** Create or update a draft (by id when editing an existing one). */
export async function saveSopTemplateDraft(
  input: SopTemplateDraftInput,
): Promise<SopTemplateDraft> {
  const orgId = requireActiveOrg();
  const now = new Date().toISOString();
  const row = {
    org_id: orgId,
    template_id: input.templateId ?? null,
    payload: input.payload as never,
    updated_by: currentUserId(),
    updated_at: now,
    ...(input.id ? { id: input.id } : {}),
  };
  const { data, error } = await supabase
    .from("sop_template_drafts")
    .upsert(row as never, { onConflict: "id" })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  const saved = camelizeRow<SopTemplateDraft>(data);
  await writeAudit({
    actionType: input.id ? "UPDATE" : "CREATE",
    entityType: "sop_template_draft",
    entityId: saved.id,
    description: "Saved SOP draft",
  });
  return saved;
}

export async function deleteSopTemplateDraft(id: string): Promise<void> {
  const orgId = requireActiveOrg();
  const { error } = await supabase
    .from("sop_template_drafts")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) throw error;
  await writeAudit({
    actionType: "DELETE",
    entityType: "sop_template_draft",
    entityId: id,
    description: "Deleted SOP draft",
  });
}
