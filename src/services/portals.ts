// Portals registry — the payer-portal rows behind every fill.
//
// DUAL surface (the portalFieldMaps.ts pattern):
//   - browser path (RLS-guarded), mirroring payers.ts: requireActiveOrg()
//     scopes every query, writes are audited, snake<->camel at the boundary;
//   - server ctx path (listPortalsForApi), injected by GET /api/portals with
//     the service-role client and the guard-resolved org.
// Both read own-org rows plus GLOBAL registry rows (org_id NULL, E6.5).
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/externalClient";
import type { Database } from "@/integrations/supabase/types";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import { normalizePortalKey } from "@/lib/tokenFormat";
import {
  isListableRegistryPortal,
  isListableBrowserPortal,
  isListableSharedPortal,
  type PortalPayerFacts,
} from "@/lib/portalVisibility";
import type { Portal } from "@/types";

const PORTAL_COLUMNS =
  "id, org_id, portal_key, name, payer_id, form_url, is_verified, last_verified_at, proven_at, url_changed_at, created_at, updated_at";

// The /api projection adds the payer's DISPLAY NAME. E6.9's Train-forms module
// groups portals by payer, and the extension has no payer endpoint of its own —
// a payer id alone would render as a UUID. Embedded rather than a second round
// trip, and it is not PHI (a payer's name is public catalog identity).
//
// Slice 6 / D6.4 also reads the payer's LIFECYCLE off the same embed, because
// a global portal is only listable while its payer is live
// (src/lib/portalVisibility.ts). One embed serves both — no second round trip,
// and the filter can never read a staler payer than the name it renders.
const PORTAL_API_COLUMNS = `${PORTAL_COLUMNS}, payers(name, status, archived_at, merged_into_id)`;

/** The embedded payer as camelizeRow leaves it (the embed is recursed too). */
type EmbeddedPayer = (PortalPayerFacts & { name?: string | null }) | null;
type EmbeddedPortalRow = Portal & { payers?: EmbeddedPayer };

/** Split the embed off a raw row into the display name + the facts the
 * D6.4 predicate needs — the one place the wire shape is unpacked. */
function unpackPortalRow(row: EmbeddedPortalRow): {
  portal: PortalApiRow;
  payer: PortalPayerFacts | null;
} {
  const { payers, ...portal } = row;
  return {
    portal: { ...portal, payerName: payers?.name ?? null },
    payer: payers ?? null,
  };
}

export interface PortalServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
}

/** GET /api/portals — the registry the extension matches the current tab
 * against, so portal identity is DB-driven instead of a hardcoded list shipped
 * in the extension bundle.
 *
 * Own-org rows plus global (org_id NULL) registry rows; another org's rows can
 * never match the filter. `portal_key` is the join key the whole system already
 * uses (SOP online_form steps, portal_field_maps, fill_sessions), folded to its
 * canonical form on write — so the extension's page -> portal match is a
 * literal compare, like the token join.
 *
 * Global rows are additionally held to the Slice 6 D6.4 predicate — see
 * isListableRegistryPortal. Own-org rows are unaffected.
 *
 * Not PHI (a registry of payer portals and their URLs) — no audit row, and no
 * role gate: billing may read, matching the field-maps route. */
/** A registry row as the extension sees it: the portal plus its payer's
 * display name (see PORTAL_API_COLUMNS). */
export type PortalApiRow = Portal & { payerName: string | null };

export async function listPortalsForApi(
  ctx: PortalServiceCtx,
  filters: { portalKey?: string } = {},
): Promise<PortalApiRow[]> {
  let query = ctx.db
    .from("portals")
    .select(PORTAL_API_COLUMNS)
    .or(`org_id.is.null,org_id.eq.${ctx.orgId}`)
    .order("name", { ascending: true })
    .order("id", { ascending: true });
  if (filters.portalKey) {
    // Fold the caller's key the same way the write boundary does, so a
    // hand-typed mixed-case/whitespace key still matches.
    query = query.eq("portal_key", normalizePortalKey(filters.portalKey) ?? "");
  }
  const { data, error } = await query;
  if (error) throw error;
  const rows = camelizeRow<EmbeddedPortalRow[]>(data ?? []);
  // D6.4: own-org rows pass through untouched; global rows must point at a
  // live catalog payer, so Work-case recognition can't match a page to a
  // portal whose payer is retired, merged or archived.
  return rows
    .map(unpackPortalRow)
    .filter(({ portal, payer }) =>
      isListableRegistryPortal({ orgId: portal.orgId, payerId: portal.payerId, payer }),
    )
    .map(({ portal }) => portal);
}

/** GET /api/shared-portals — the GLOBAL registry rows only (`org_id IS NULL`),
 * for the E6.9 Train-forms module.
 *
 * Training has no org (D10) and writes the shared library, so it runs on the
 * user-scoped guard and cannot use `listPortalsForApi`, which needs a resolved
 * `orgId` to build its own-org disjunct. Restricting the rows to the global
 * tier is what makes that safe: there is no org in scope, so no org's private
 * registry rows can be returned to a caller who never named an org.
 *
 * Slice 6 / D6.4 (F24): rows whose payer is missing, retired, merged or
 * archived are dropped — see isListableSharedPortal for why a hidden ghost
 * beats a listed one.
 *
 * Not PHI (portal names, URLs, verification state) — no audit row, no role
 * gate, matching the org-scoped route it mirrors. */
export async function listSharedPortals(db: SupabaseClient<Database>): Promise<PortalApiRow[]> {
  const { data, error } = await db
    .from("portals")
    .select(PORTAL_API_COLUMNS)
    .is("org_id", null)
    .order("name", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  const rows = camelizeRow<EmbeddedPortalRow[]>(data ?? []);
  // D6.4 (F24): every row here is global, so the shared-tier predicate applies
  // to all of them — a payerless or dead-payer row is a ghost the trainer can
  // never finish, and offering it is worse than not listing it.
  return rows
    .map(unpackPortalRow)
    .filter(({ portal, payer }) => isListableSharedPortal({ payerId: portal.payerId, payer }))
    .map(({ portal }) => portal);
}

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
  //
  // D6.4 (TRAIN-DUAL D-TD.4): the ghost filter, in its BROWSER form. usePortals
  // consumers (SOP portal selects, PortalStepLink, registry) should not offer a
  // global portal the extension Work path would drop — but this read runs under
  // RLS, where `payers_select` hides a global payer the org has not adopted. So
  // it uses isListableBrowserPortal, which drops only payer-less global rows and
  // keeps a row whose payer it merely cannot see. Applying the service-role
  // predicate here removed 4 of 5 healthy portals from a live org.
  const { data, error } = await supabase
    .from("portals")
    .select(PORTAL_API_COLUMNS)
    .or(`org_id.eq.${orgId},org_id.is.null`)
    .order("name", { ascending: true });
  if (error) throw error;
  const rows = camelizeRow<EmbeddedPortalRow[]>(data ?? []);
  return rows
    .map(unpackPortalRow)
    .filter(({ portal, payer }) =>
      isListableBrowserPortal({ orgId: portal.orgId, payerId: portal.payerId, payer }),
    )
    .map(({ portal }) => {
      // Browser callers expect Portal[], not the API's payerName projection.
      const { payerName: _ignored, ...rest } = portal;
      return rest;
    });
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
