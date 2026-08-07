// Party / CRM-contact service (E0.2 contacts + E0.3 Full Party model). Browser →
// Supabase under RLS: party_role_assignments is org-scoped (member SELECT,
// writer writes) and parties is visible via assignment-membership OR created_by.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow, snakeizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit, currentUserId } from "@/lib/audit";
import { translateDbError } from "@/lib/dbErrors";
import { groupOrgParties } from "@/lib/parties";
import { composeFullName } from "@/lib/personName";
import type {
  ContactInput,
  OrgContact,
  OrgParty,
  Party,
  PartyRoleKey,
  PartyRoleType,
} from "@/types";
import type { Database } from "@/integrations/supabase/types";

type PartyUpdate = Database["public"]["Tables"]["parties"]["Update"];
type PartyInsert = Database["public"]["Tables"]["parties"]["Insert"];

// The three active Stage 0 roles surfaced as org contacts.
const CONTACT_ROLE_KEYS: PartyRoleKey[] = ["owner", "customer_escalation_contact", "sales_rep"];

interface AssignmentWithParty {
  role_key: string;
  is_default: boolean | null;
  parties: unknown;
}

export async function listOrgContacts(): Promise<OrgContact[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("party_role_assignments")
    .select("role_key, is_default, parties(*)")
    .eq("org_id", orgId)
    .in("role_key", CONTACT_ROLE_KEYS);
  if (error) throw error;
  return ((data ?? []) as AssignmentWithParty[])
    .filter((row) => row.parties)
    .map((row) => ({
      roleKey: row.role_key as PartyRoleKey,
      isDefault: Boolean(row.is_default),
      party: camelizeRow<Party>(row.parties),
    }));
}

// Every party assigned in the active org, grouped with the roles it holds here
// (E0.3 manage-parties surface). One row per party even with multiple roles.
export async function listOrgParties(): Promise<OrgParty[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("party_role_assignments")
    .select("role_key, is_default, parties(*)")
    .eq("org_id", orgId);
  if (error) throw error;
  const rows = ((data ?? []) as AssignmentWithParty[])
    .filter((row) => row.parties)
    .map((row) => ({
      roleKey: row.role_key as PartyRoleKey,
      isDefault: Boolean(row.is_default),
      party: camelizeRow<Party>(row.parties),
    }));
  return groupOrgParties(rows);
}

// NB listVisibleParties (the F0.3.4 cross-org reuse pool) is GONE as of the D8
// decision, 2026-08-07. A party now belongs to exactly one org, so there is no
// cross-org pool to read: `parties` RLS is org-membership-scoped and the
// "Add existing person" dialog it fed has been removed. Reusing a person in a
// second org means entering them there — which is the point.

// Governed role reference list (F0.3.5). Read-only; active + reserved.
export async function listPartyRoleTypes(): Promise<PartyRoleType[]> {
  const { data, error } = await supabase
    .from("party_role_types")
    .select("role_key, label, is_active");
  if (error) throw error;
  return (data ?? []).map((row) => camelizeRow<PartyRoleType>(row));
}

// Editable contact fields (E0.2 FR-4). Required-ness is enforced by the caller
// (contactErrors) and RLS/writer policy; this patches only what's provided.
export interface UpdatePartyInput {
  firstName?: string;
  lastName?: string;
  title?: string | null;
  email?: string;
  phoneOffice?: string;
  phoneExtension?: string | null;
  phoneMobile?: string | null;
  fax?: string | null;
  addressLine1?: string;
  addressLine2?: string | null;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string | null;
}

export async function updateParty(partyId: string, input: UpdatePartyInput): Promise<Party> {
  requireActiveOrg();
  const patch = snakeizeRow<PartyUpdate>(input);
  // `name` is the retained display column and is never edited directly — it is
  // recomposed whenever either half of the split name is patched, so the two can
  // never disagree (D6).
  if (input.firstName !== undefined || input.lastName !== undefined) {
    const current = await supabase
      .from("parties")
      .select("first_name, last_name")
      .eq("id", partyId)
      .maybeSingle();
    if (current.error) throw current.error;
    patch.name = composeFullName({
      firstName: input.firstName ?? current.data?.first_name ?? "",
      lastName: input.lastName ?? current.data?.last_name ?? "",
    });
  }
  const { data, error } = await supabase
    .from("parties")
    .update(patch)
    .eq("id", partyId)
    .select("*")
    .single();
  if (error) throw error;
  const party = camelizeRow<Party>(data);
  await writeAudit({ actionType: "UPDATE", entityType: "party", entityId: partyId, after: party });
  return party;
}

function nullifyEmpty(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v === "" ? null : v;
  return out;
}

// Create a person party (F0.3.1). org_id is the ACTIVE org (D8 — a party belongs
// to exactly one org, and RLS now requires a writer role in that org);
// created_by stays as provenance, no longer as a visibility grant.
export async function createParty(input: ContactInput): Promise<Party> {
  const orgId = requireActiveOrg();
  const uid = currentUserId();
  if (!uid) throw new Error("Not authenticated");
  const row = nullifyEmpty(
    snakeizeRow<Record<string, unknown>>({ ...input, name: composeFullName(input) }),
  ) as PartyInsert;
  const { data, error } = await supabase
    .from("parties")
    .insert({ ...row, org_id: orgId, party_type: "person", created_by: uid })
    .select("*")
    .single();
  if (error) throw error;
  const party = camelizeRow<Party>(data);
  await writeAudit({ actionType: "CREATE", entityType: "party", entityId: party.id, after: party });
  return party;
}

// Assign an active role to a party at org scope (F0.3.2). The DB trigger rejects
// reserved roles and the unique constraint rejects a duplicate assignment.
export async function assignRole(
  partyId: string,
  roleKey: PartyRoleKey,
  opts: { isDefault?: boolean } = {},
): Promise<void> {
  const orgId = requireActiveOrg();
  // The FIRST holder of a role becomes its default so the contact token family
  // resolves immediately; a later holder is added non-default and must be
  // promoted explicitly (setDefaultRole). The partial unique index is the
  // backstop — this read only decides the sensible default.
  let isDefault = opts.isDefault;
  if (isDefault === undefined) {
    const existing = await supabase
      .from("party_role_assignments")
      .select("id")
      .eq("org_id", orgId)
      .eq("role_key", roleKey)
      .eq("is_default", true)
      .limit(1);
    if (existing.error) throw existing.error;
    isDefault = (existing.data ?? []).length === 0;
  }
  const { error } = await supabase.from("party_role_assignments").insert({
    org_id: orgId,
    party_id: partyId,
    role_key: roleKey,
    scope_type: "org",
    is_default: isDefault,
  });
  if (error) throw translateDbError(error);
  await writeAudit({
    actionType: "CREATE",
    entityType: "party_role_assignment",
    entityId: partyId,
    after: { roleKey, isDefault },
  });
}

// Promote one holder to the org's DEFAULT for a role (D1). Demote-then-promote,
// because the partial unique index rejects two defaults for the same
// (org, role) — the two statements are not atomic, so the demote runs first and
// a failure between them leaves the role temporarily default-less (tokens
// resolve null with an honest reason) rather than violating the invariant.
export async function setDefaultRole(partyId: string, roleKey: PartyRoleKey): Promise<void> {
  const orgId = requireActiveOrg();
  const demote = await supabase
    .from("party_role_assignments")
    .update({ is_default: false })
    .eq("org_id", orgId)
    .eq("role_key", roleKey)
    .eq("is_default", true);
  if (demote.error) throw demote.error;

  const promote = await supabase
    .from("party_role_assignments")
    .update({ is_default: true })
    .eq("org_id", orgId)
    .eq("role_key", roleKey)
    .eq("party_id", partyId);
  if (promote.error) throw translateDbError(promote.error);

  await writeAudit({
    actionType: "UPDATE",
    entityType: "party_role_assignment",
    entityId: partyId,
    after: { roleKey, isDefault: true },
  });
}

// Remove one role from a party in this org.
//
// The E0.2 F0.2.2 "can't remove the org's only sales rep" guard is GONE: it was
// only safe while every org was guaranteed a sales rep by the intake default,
// and with that default removed (migration 20260807120000) it just trapped the
// first sales rep someone added — an org may legitimately have none.
export async function unassignRole(partyId: string, roleKey: PartyRoleKey): Promise<void> {
  const orgId = requireActiveOrg();
  const { error } = await supabase
    .from("party_role_assignments")
    .delete()
    .eq("org_id", orgId)
    .eq("party_id", partyId)
    .eq("role_key", roleKey)
    .eq("scope_type", "org");
  if (error) throw error;
  await writeAudit({
    actionType: "DELETE",
    entityType: "party_role_assignment",
    entityId: partyId,
    before: { roleKey },
  });
}

// Remove a party from the org = delete all its assignments in this org (F0.3.1).
// No sales-rep guard (see unassignRole). TD-4: the party RECORD is deliberately
// retained — a browser client can't safely verify "no assignments anywhere"
// under org-scoped RLS, and the FK is ON DELETE CASCADE, so deleting it could
// wipe another org's assignment. It simply drops out of this org's list.
export async function removePartyFromOrg(partyId: string): Promise<void> {
  const orgId = requireActiveOrg();
  const { error } = await supabase
    .from("party_role_assignments")
    .delete()
    .eq("org_id", orgId)
    .eq("party_id", partyId);
  if (error) throw error;
  await writeAudit({
    actionType: "DELETE",
    entityType: "party_org_assignments",
    entityId: partyId,
  });
}
