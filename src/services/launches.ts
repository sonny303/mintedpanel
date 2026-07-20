// Launch-locations service — slimmed by E6.6 F6.6.2 to the one surviving
// read. A launch is a facilities row with a go-live `effective_date`; the
// Launches pages retired (E6.1) and the report derivation lives in
// src/lib/launchReport.ts over the shared caches. The launch-specific
// create/update/assign writers are gone (facility CRUD lives in the wizard
// Facilities section + the Groups surfaces; assignments go through
// src/services/providerAssignments.ts).
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg } from "@/lib/audit";
import type { Facility } from "@/types";

export async function getLaunchLocation(id: string): Promise<Facility | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("facilities")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<Facility>(data) : null;
}
