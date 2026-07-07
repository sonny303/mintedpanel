// Organization intake. Creating an org is a privileged BOOTSTRAP that RLS can't
// express: `organizations` has no INSERT policy, and memberships/status_configs
// INSERT require the caller to already be an admin of the org — a chicken-and-egg
// an org's first member can't satisfy. So the whole transaction (org row +
// creator-as-admin membership + the canonical status_configs seed + a CREATE
// audit row) runs inside the SECURITY DEFINER `create_organization` RPC (repo
// migration 20260707140000_create_organization_rpc.sql), keyed to auth.uid().
// Any authenticated user may create an org and becomes its admin (self-serve).
import { supabase } from "@/integrations/supabase/externalClient";

export async function createOrganization(name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Organization name is required");
  // `supabase.rpc` must be called bound — extracting the method throws at call
  // time (CLAUDE.md gotcha). Cast to a loose signature, mirroring cases.ts.
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("create_organization", { p_name: trimmed });
  if (error) throw new Error(error.message);
  return data as string;
}
