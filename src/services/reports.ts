// Org-wide read helpers for the Reports page: touch summary rows for the
// Summary tab and roster aux (assignments/licenses/facilities) for the Roster tab.
import { supabase } from "@/integrations/supabase/externalClient";
import { requireActiveOrg } from "@/lib/audit";
import { camelizeRow } from "@/lib/case";

export interface TouchSummaryRow {
  coordinatorId: string | null;
  touchDate: string | null;
}

export async function getTouchSummary(): Promise<TouchSummaryRow[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("touches")
    .select("coordinator_id, touch_date")
    .eq("org_id", orgId);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    coordinatorId: (r.coordinator_id as string | null) ?? null,
    touchDate: (r.touch_date as string | null) ?? null,
  }));
}

export interface RosterAuxAssignment {
  providerId: string;
  facilityId: string;
}

export interface RosterAuxFacility {
  id: string;
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface RosterAuxLicense {
  providerId: string;
  state: string;
  licenseNumber: string | null;
  expirationDate: string | null;
}

export interface RosterAuxData {
  assignments: RosterAuxAssignment[];
  facilities: RosterAuxFacility[];
  licenses: RosterAuxLicense[];
}

export async function getRosterAux(): Promise<RosterAuxData> {
  const orgId = requireActiveOrg();
  const [aRes, lRes, fRes] = await Promise.all([
    supabase
      .from("provider_facility_assignments")
      .select("provider_id, facility_id")
      .eq("org_id", orgId),
    supabase
      .from("state_licenses")
      .select("provider_id, state, license_number, expiration_date")
      .eq("org_id", orgId),
    supabase.from("facilities").select("id, name, street, city, state, zip").eq("org_id", orgId),
  ]);
  if (aRes.error) throw aRes.error;
  if (lRes.error) throw lRes.error;
  if (fRes.error) throw fRes.error;
  const assignments: RosterAuxAssignment[] = (aRes.data ?? []).map((r) => ({
    providerId: r.provider_id as string,
    facilityId: r.facility_id as string,
  }));
  const licenses: RosterAuxLicense[] = (lRes.data ?? []).map((r) => ({
    providerId: r.provider_id as string,
    state: r.state as string,
    licenseNumber: (r.license_number as string | null) ?? null,
    expirationDate: (r.expiration_date as string | null) ?? null,
  }));
  const facilities = camelizeRow<RosterAuxFacility[]>(fRes.data ?? []);
  return { assignments, facilities, licenses };
}
