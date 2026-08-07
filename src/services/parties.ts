// Party / CRM-contact service (E0.2 contacts + E0.3 Full Party model). Browser →
// Supabase under RLS: party_role_assignments is org-scoped (member SELECT,
// writer writes) and parties is visible via assignment-membership OR created_by.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow, snakeizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit, currentUserId } from "@/lib/audit";
import { groupOrgParties } from "@/lib/parties";
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
  parties: unknown;
}

export async function listOrgContacts(): Promise<OrgContact[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("party_role_assignments")
    .select("role_key, parties(*)")
    .eq("org_id", orgId)
    .in("role_key", CONTACT_ROLE_KEYS);
  if (error) throw error;
  return ((data ?? []) as AssignmentWithParty[])
    .filter((row) => row.parties)
    .map((row) => ({
      roleKey: row.role_key as PartyRoleKey,
      party: camelizeRow<Party>(row.parties),
    }));
}

// Every party assigned in the active org, grouped with the roles it holds here
// (E0.3 manage-parties surface). One row per party even with multiple roles.
export async function listOrgParties(): Promise<OrgParty[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("party_role_assignments")
    .select("role_key, parties(*)")
    .eq("org_id", orgId);
  if (error) throw error;
  const rows = ((data ?? []) as AssignmentWithParty[])
    .filter((row) => row.parties)
    .map((row) => ({
      roleKey: row.role_key as PartyRoleKey,
      party: camelizeRow<Party>(row.parties),
    }));
  return groupOrgParties(rows);
}

// Every party the caller can see (created by them OR assigned in one of their
// orgs) — the pool for reusing an existing party in a new org (F0.3.4). RLS does
// the scoping; the UI filters out parties already in the active org.
export async function listVisibleParties(): Promise<Party[]> {
  requireActiveOrg();
  const { data, error } = await supabase.from("parties").select("*").order("name");
  if (error) throw error;
  return (data ?? []).map((row) => camelizeRow<Party>(row));
}

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
  name?: string;
  email?: string;
  phoneOffice?: string;
  phoneMobile?: string | null;
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

// Create a person party (F0.3.1). created_by is the caller (RLS insert check).
export async function createParty(input: ContactInput): Promise<Party> {
  requireActiveOrg();
  const uid = currentUserId();
  if (!uid) throw new Error("Not authenticated");
  const row = nullifyEmpty(snakeizeRow<Record<string, unknown>>(input)) as PartyInsert;
  const { data, error } = await supabase
    .from("parties")
    .insert({ ...row, party_type: "person", created_by: uid })
    .select("*")
    .single();
  if (error) throw error;
  const party = camelizeRow<Party>(data);
  await writeAudit({ actionType: "CREATE", entityType: "party", entityId: party.id, after: party });
  return party;
}

// Assign an active role to a party at org scope (F0.3.2). The DB trigger rejects
// reserved roles and the unique constraint rejects a duplicate assignment.
export async function assignRole(partyId: string, roleKey: PartyRoleKey): Promise<void> {
  const orgId = requireActiveOrg();
  const { error } = await supabase
    .from("party_role_assignments")
    .insert({ org_id: orgId, party_id: partyId, role_key: roleKey, scope_type: "org" });
  if (error) throw error;
  await writeAudit({
    actionType: "CREATE",
    entityType: "party_role_assignment",
    entityId: partyId,
    after: { roleKey },
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
