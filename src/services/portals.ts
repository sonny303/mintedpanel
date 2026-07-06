// Portals registry (org-scoped) — the payer-portal rows behind every fill.
// Browser path (RLS-guarded), mirroring payers.ts: requireActiveOrg() scopes
// every query, writes are audited, snake<->camel at the boundary.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import type { Portal } from "@/types";

const PORTAL_COLUMNS =
  "id, org_id, portal_key, name, payer_id, form_url, is_verified, last_verified_at, url_changed_at, created_at, updated_at";

export interface PortalInput {
  name: string;
  portalKey: string;
  payerId?: string | null;
  formUrl?: string | null;
}

export async function listPortals(): Promise<Portal[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("portals")
    .select(PORTAL_COLUMNS)
    .eq("org_id", orgId)
    .order("name", { ascending: true });
  if (error) throw error;
  return camelizeRow<Portal[]>(data ?? []);
}

export async function createPortal(input: PortalInput): Promise<Portal> {
  const orgId = requireActiveOrg();
  const payload = {
    org_id: orgId,
    name: input.name.trim(),
    portal_key: input.portalKey.trim(),
    payer_id: input.payerId ?? null,
    form_url: input.formUrl?.trim() || null,
  };
  const { data, error } = await supabase
    .from("portals")
    .insert(payload as never)
    .select(PORTAL_COLUMNS)
    .single();
  if (error) throw error;
  const created = camelizeRow<Portal>(data);
  await writeAudit({
    actionType: "CREATE",
    entityType: "portal",
    entityId: created.id,
    after: { portalKey: created.portalKey, name: created.name, formUrl: created.formUrl },
    description: `Added portal ${created.name}`,
  });
  return created;
}

// Editing the form URL invalidates trust: field selectors were captured on the
// prior page, so the portal drops to Unverified and stamps url_changed_at,
// which the "Needs re-verify" pill reads. updated_at is set by the DB trigger.
export async function updatePortalUrl(id: string, formUrl: string): Promise<Portal> {
  const orgId = requireActiveOrg();
  const trimmed = formUrl.trim() || null;
  const { data, error } = await supabase
    .from("portals")
    .update({
      form_url: trimmed,
      is_verified: false,
      url_changed_at: new Date().toISOString(),
    } as never)
    .eq("id", id)
    .eq("org_id", orgId)
    .select(PORTAL_COLUMNS)
    .single();
  if (error) throw error;
  const after = camelizeRow<Portal>(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "portal",
    entityId: id,
    after: { formUrl: after.formUrl, isVerified: after.isVerified },
    description: `Updated portal URL for ${after.name}`,
  });
  return after;
}

// Completing a training pass verifies the portal (a human reviewed every field).
export async function markPortalVerified(id: string): Promise<Portal> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("portals")
    .update({
      is_verified: true,
      last_verified_at: new Date().toISOString(),
    } as never)
    .eq("id", id)
    .eq("org_id", orgId)
    .select(PORTAL_COLUMNS)
    .single();
  if (error) throw error;
  const after = camelizeRow<Portal>(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "portal",
    entityId: id,
    after: { isVerified: true },
    description: `Verified portal ${after.name} (training pass)`,
  });
  return after;
}
