// Party / CRM-contact service (E0.2 + E0.3 foundation). Browser → Supabase under
// RLS: party_role_assignments is org-scoped (member SELECT, writer writes) and
// parties is visible via assignment-membership OR created_by. Reads the active
// org's contacts (owner + customer + sales rep) and edits a party in place.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow, snakeizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import type { OrgContact, Party, PartyRoleKey } from "@/types";
import type { Database } from "@/integrations/supabase/types";

type PartyUpdate = Database["public"]["Tables"]["parties"]["Update"];

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
