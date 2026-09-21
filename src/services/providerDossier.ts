// Cross-org provider dossier (spike). One embedded PostgREST read, issued
// only when a coordinator opens the footprint — never from the typeahead.
//
// Same authorization shape as searchProvidersAcrossOrgs: the browser client
// runs under RLS, and providers_select / state_licenses_select /
// provider_group_assignments_select / provider_groups_select_org /
// provider_facility_assignments_select / facilities_select_org are all
// `org_id IN (SELECT user_org_ids())`. Omitting an org filter widens the
// read to the caller's memberships and no further.
//
// There is no /api route. The service-role client bypasses RLS; this query
// must not be copied onto ctx.db from a server route without an explicit
// membership filter. See docs/ops/provider-dossier-spike.md.
import { supabase } from "@/integrations/supabase/externalClient";
import {
  PROVIDER_DOSSIER_COLUMNS,
  aggregateProviderDossier,
  isType1Npi,
  type ProviderDossier,
} from "@/lib/providerDossier";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type { ProviderDossier } from "@/lib/providerDossier";

export interface ProviderDossierCtx {
  db: SupabaseClient<Database>;
}

function browserCtx(): ProviderDossierCtx {
  return { db: supabase };
}

export async function loadProviderDossier(
  npi: string,
  authorizedOrgNames: ReadonlyMap<string, string>,
  ctx: ProviderDossierCtx = browserCtx(),
): Promise<ProviderDossier | null> {
  if (!isType1Npi(npi) || authorizedOrgNames.size === 0) return null;

  const { data, error } = await ctx.db
    .from("providers")
    .select(PROVIDER_DOSSIER_COLUMNS)
    .eq("npi", npi);
  if (error) throw error;

  return aggregateProviderDossier((data ?? []) as unknown[], authorizedOrgNames, npi);
}
