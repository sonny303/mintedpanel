// Portals registry (org-scoped) — the payer-portal rows behind every fill.
// Browser path (RLS-guarded), mirroring payers.ts: requireActiveOrg() scopes
// every query, writes are audited, snake<->camel at the boundary.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import { normalizePortalKey } from "@/lib/tokenFormat";
import type { Portal } from "@/types";

const PORTAL_COLUMNS =
  "id, org_id, portal_key, name, payer_id, form_url, is_verified, last_verified_at, proven_at, url_changed_at, created_at, updated_at";

export interface PortalInput {
  name: string;
  portalKey: string;
  payerId?: string | null;
  formUrl?: string | null;
}

export async function listPortals(): Promise<Portal[]> {
  const orgId = requireActiveOrg();
  // Own-org rows plus GLOBAL registry rows (org_id NULL, E6.5) — the shared-
  // catalog read pattern (portal_field_maps/payers/sop_templates). Global rows
  // are read-only here; their writes go through the authoring RPCs below.
  const { data, error } = await supabase
    .from("portals")
    .select(PORTAL_COLUMNS)
    .or(`org_id.eq.${orgId},org_id.is.null`)
    .order("name", { ascending: true });
  if (error) throw error;
  return camelizeRow<Portal[]>(data ?? []);
}

export async function createPortal(input: PortalInput): Promise<Portal> {
  const orgId = requireActiveOrg();
  const payload = {
    org_id: orgId,
    name: input.name.trim(),
    // Fold (trim + lowercase) at the write boundary so the portal_key that joins
    // SOP online_form steps → this portal is a literal string compare, matching
    // how editableTemplate normalizes step keys. The key is immutable after
    // create (no update path edits it — a rename would orphan every SOP-step
    // link), so this is the one chance to canonicalize a hand-typed key.
    portal_key: normalizePortalKey(input.portalKey) ?? "",
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
      // A new page invalidates the dry-run proof along with verification (E6.5).
      proven_at: null,
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

// E6.5 F6.5.3 — an ORG portal passes its mock dry run (every live mapping
// resolved). Global rows flip through setGlobalPortalFlags instead.
export async function markPortalProven(id: string): Promise<Portal> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("portals")
    .update({ proven_at: new Date().toISOString() } as never)
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
    after: { provenAt: after.provenAt },
    description: `Portal ${after.name} proven by mock dry run`,
  });
  return after;
}

// ---------------------------------------------------------------------------
// E6.5 F6.5.6 — GLOBAL portal authoring (org_id NULL rows). All writes ride
// the SECURITY DEFINER RPCs (no table policy allows a global write); the RPC
// bodies reject anon and normalize the key. NO writeAudit here — audit_log
// requires an org_id and these are cross-org platform rows; the RPC-side
// timestamps (url_changed_at / last_verified_at / proven_at / updated_at) are
// the trail until R7 hardens platform governance.
// ---------------------------------------------------------------------------
export interface GlobalPortalInput {
  /** Existing global portal id to update; null/undefined creates. */
  id?: string | null;
  name: string;
  /** Required on create; immutable after (a rename would orphan SOP links). */
  portalKey?: string | null;
  payerId?: string | null;
  formUrl?: string | null;
}

export async function upsertGlobalPortal(input: GlobalPortalInput): Promise<Portal> {
  requireActiveOrg();
  const rpc = supabase.rpc.bind(supabase);
  const { data, error } = await rpc("upsert_global_portal", {
    p_id: (input.id ?? null) as unknown as string,
    p_name: input.name.trim(),
    p_portal_key: (normalizePortalKey(input.portalKey) ?? "") as string,
    p_payer_id: (input.payerId ?? null) as unknown as string,
    p_form_url: (input.formUrl?.trim() || null) as unknown as string,
  });
  if (error) {
    if (error.message.includes("global_portal_key_exists")) {
      throw new Error("A global portal with this key already exists.");
    }
    throw error;
  }
  return camelizeRow<Portal>(data);
}

export async function setGlobalPortalFlags(
  id: string,
  flags: { verified?: boolean; proven?: boolean },
): Promise<Portal> {
  requireActiveOrg();
  const rpc = supabase.rpc.bind(supabase);
  const { data, error } = await rpc("set_global_portal_flags", {
    p_id: id,
    p_verified: (flags.verified ?? null) as unknown as boolean,
    p_proven: (flags.proven ?? null) as unknown as boolean,
  });
  if (error) throw error;
  return camelizeRow<Portal>(data);
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
