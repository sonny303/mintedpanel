// Organization intake. Creating an org is a privileged BOOTSTRAP that RLS can't
// express: `organizations` has no INSERT policy, and memberships/status_configs
// INSERT require the caller to already be an admin of the org — a chicken-and-egg
// an org's first member can't satisfy. So the whole transaction (org row +
// creator-as-admin membership + the canonical status_configs seed + a CREATE
// audit row) runs inside the SECURITY DEFINER `create_organization` RPC (repo
// migration 20260707140000_create_organization_rpc.sql), keyed to auth.uid().
// Any authenticated user may create an org and becomes its admin (self-serve).
import { supabase } from "@/integrations/supabase/externalClient";

// Owner (name + email) is REQUIRED (E0.1 F0.1.2) — the RPC v2 rejects blanks,
// an invalid email, and a duplicate normalized org name, surfacing a verbatim
// message the UI shows. There is no defaulting of the owner params here; both
// call sites (NoOrgScreen, CreateOrganizationModal) pass them.
export interface CreateOrganizationInput {
  name: string;
  ownerName: string;
  ownerEmail: string;
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
  });
  if (error) throw new Error(error.message);
  return data as string;
}
