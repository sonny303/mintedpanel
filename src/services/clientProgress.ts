// Read-only provider projection for the owner-facing /client-progress page.
// Additive service (Client Progress v1): PROVIDER_LIST_COLUMNS omits
// start_date, which the card shows, so this page selects its own explicit,
// PHI-safe column set instead of widening the shared list projection.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg } from "@/lib/audit";
import type { Provider } from "@/types";

export type ClientProgressProvider = Pick<
  Provider,
  "id" | "firstName" | "lastName" | "credentials" | "startDate" | "status"
>;

const CLIENT_PROGRESS_PROVIDER_COLUMNS =
  "id, first_name, last_name, credentials, start_date, status";

export async function listClientProgressProviders(): Promise<ClientProgressProvider[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("providers")
    .select(CLIENT_PROGRESS_PROVIDER_COLUMNS)
    .eq("org_id", orgId)
    .neq("status", "terminated")
    .order("last_name")
    .order("first_name");
  if (error) throw error;
  return camelizeRow<ClientProgressProvider[]>(data ?? []);
}
