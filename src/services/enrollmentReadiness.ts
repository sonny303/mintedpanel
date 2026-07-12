// E1.8 TE-2/TE-5 — the readiness read layer: batched org-scoped reads (one
// query per source table, joined in memory by the pure evaluator — never
// per-row round-trips). First application consumer of provider_documents and
// second of group_insurance_policies (both dormant until now; read-only here).
//
// PHI boundary (TE-9): the provider facts read pulls the demographic columns
// ONLY to reduce them to presence booleans right here — date of birth, SSN
// last-4, and home address values never leave this module, never enter the
// cache, and never render.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg } from "@/lib/audit";
import type {
  GroupDocumentInput,
  GroupInsuranceInput,
  ProviderReadinessFacts,
} from "@/lib/enrollmentReadiness";

interface ProviderFactsRow {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  npi: string | null;
  caqhId: string | null;
  caqhLastAttestedDate: string | null;
  dateOfBirth: string | null;
  ssnLast4: string | null;
  homeStreet: string | null;
  homeCity: string | null;
  homeState: string | null;
  homeZip: string | null;
  malpracticeCoverageEnd: string | null;
}

export async function listProviderReadinessFacts(): Promise<ProviderReadinessFacts[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("providers")
    .select(
      "id, first_name, last_name, status, npi, caqh_id, caqh_last_attested_date, date_of_birth, ssn_last4, home_street, home_city, home_state, home_zip, malpractice_coverage_end",
    )
    .eq("org_id", orgId)
    .neq("status", "terminated");
  if (error) throw error;
  const rows = camelizeRow<ProviderFactsRow[]>(data ?? []);
  return rows.map((r) => ({
    providerId: r.id,
    providerName: `${r.firstName} ${r.lastName}`.trim(),
    npiPresent: Boolean(r.npi?.trim()),
    caqhIdPresent: Boolean(r.caqhId?.trim()),
    caqhLastAttestedDate: r.caqhLastAttestedDate,
    dobPresent: Boolean(r.dateOfBirth),
    ssnLast4Present: Boolean(r.ssnLast4?.trim()),
    homeAddressPresent: Boolean(
      r.homeStreet?.trim() && r.homeCity?.trim() && r.homeState?.trim() && r.homeZip?.trim(),
    ),
    malpracticeCoverageEnd: r.malpracticeCoverageEnd,
  }));
}

/** Group-owned documents relevant to the group checklist (presence +
 * expiration only — never file paths or contents). */
export async function listGroupReadinessDocuments(): Promise<GroupDocumentInput[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("provider_documents")
    .select("group_id, doc_type, expiration_date")
    .eq("org_id", orgId)
    .not("group_id", "is", null)
    .in("doc_type", ["w9", "coi", "voided_check"]);
  if (error) throw error;
  return camelizeRow<GroupDocumentInput[]>(data ?? []);
}

export async function listGroupInsurancePolicies(): Promise<GroupInsuranceInput[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("group_insurance_policies")
    .select("group_id, policy_end_date")
    .eq("org_id", orgId);
  if (error) throw error;
  return camelizeRow<GroupInsuranceInput[]>(data ?? []);
}
