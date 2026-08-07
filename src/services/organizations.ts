// Organization intake. Creating an org is a privileged BOOTSTRAP that RLS can't
// express: `organizations` has no INSERT policy, and memberships/status_configs
// INSERT require the caller to already be an admin of the org — a chicken-and-egg
// an org's first member can't satisfy. So the whole transaction (org row +
// creator-as-admin membership + the canonical status_configs seed + a CREATE
// audit row) runs inside the SECURITY DEFINER `create_organization` RPC (repo
// migration 20260707140000_create_organization_rpc.sql), keyed to auth.uid().
// Any authenticated user may create an org and becomes its admin (self-serve).
import { supabase } from "@/integrations/supabase/externalClient";
import { snakeizeRow } from "@/lib/case";
import { composeFullName } from "@/lib/personName";
import type { ContactInput } from "@/types";

// Owner (name + email) is REQUIRED (E0.1 F0.1.2) and a customer-escalation
// contact is REQUIRED (E0.2 FR-2). The RPC rejects blanks, an invalid email,
// missing contact fields, and a duplicate normalized org name, surfacing a
// verbatim message the UI shows. Nothing is defaulted: the sales rep is OPTIONAL
// and omitting it creates no party at all (the old placeholder default is gone —
// migration 20260807120000). No intake surface sends one today.
export interface CreateOrganizationInput {
  name: string;
  ownerName: string;
  ownerEmail: string;
  customer: ContactInput;
  salesRep?: ContactInput;
}

// ContactInput (camelCase) → the snake_case jsonb the RPC expects (keys match
// the parties columns: phone_office, address_line1, …). The composed `name` is
// added here because assert_contact_valid still requires it while the form now
// captures the halves (D6); first_name/last_name ride alongside it and
// insert_contact_party persists all three.
function contactToJsonb(contact: ContactInput): Record<string, unknown> {
  return snakeizeRow<Record<string, unknown>>({
    ...contact,
    name: composeFullName(contact),
  });
}

export async function createOrganization(input: CreateOrganizationInput): Promise<string> {
  const name = input.name.trim();
  const ownerName = input.ownerName.trim();
  const ownerEmail = input.ownerEmail.trim();
  if (!name) throw new Error("Organization name is required");
  if (!ownerName) throw new Error("Owner name is required");
  if (!ownerEmail) throw new Error("Owner email is required");
  // `supabase.rpc` must be called bound — extracting the method throws at call
  // time (CLAUDE.md gotcha). Cast to a loose signature, mirroring cases.ts.
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("create_organization", {
    p_name: name,
    p_owner_name: ownerName,
    p_owner_email: ownerEmail,
    p_customer: contactToJsonb(input.customer),
    p_sales_rep: input.salesRep ? contactToJsonb(input.salesRep) : null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
