// Inbound "contact us" lead service (redesign E0.5 / F0.5.5 / TE-7).
//
// submitInboundLead is PUBLIC (anon, from /contact) — no session, no
// requireActiveOrg. The operator readers/triage actions are authenticated but
// still CROSS-org (a lead has no org until converted): the Stage 0 model is a
// shared internal triage queue (TD-6), so these also skip requireActiveOrg.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import type { InboundLead, InboundLeadInput } from "@/types";

function boundRpc() {
  return supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

// Public (anon): submit a contact-us inquiry. Server validates required fields +
// a honeypot and inserts a `new` lead (never an org). A filled honeypot returns
// a fake success and writes nothing.
export async function submitInboundLead(input: InboundLeadInput): Promise<void> {
  const { error } = await boundRpc()("submit_inbound_lead", {
    p_payload: {
      org_name: input.orgName.trim(),
      contact_name: input.contactName.trim(),
      contact_email: input.contactEmail.trim(),
      contact_phone: input.contactPhone.trim(),
      company_website: input.companyWebsite ?? "",
    },
  });
  if (error) throw new Error(error.message);
}

// Operator: the shared inbound triage queue, newest first. RLS lets any
// authenticated user read (Stage 0 shared queue).
export async function listInboundLeads(): Promise<InboundLead[]> {
  const { data, error } = await supabase
    .from("inbound_leads")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => camelizeRow<InboundLead>(row));
}

// Operator: convert a lead into a PROSPECT org via the E0.1 create_organization
// (3-arg owner form) — the lead's org name + contact become the org + owner —
// then mark the lead converted and link the new org. Returns the new org id.
export async function convertInboundLead(lead: InboundLead): Promise<string> {
  const { data, error } = await boundRpc()("create_organization", {
    p_name: lead.orgName.trim(),
    p_owner_name: lead.contactName.trim(),
    p_owner_email: lead.contactEmail.trim(),
  });
  if (error) throw new Error(error.message);
  const orgId = data as string;
  const { error: updErr } = await supabase
    .from("inbound_leads")
    .update({ status: "converted", converted_org_id: orgId })
    .eq("id", lead.id);
  if (updErr) throw updErr;
  return orgId;
}

// Operator: dismiss a lead (spam / not a fit). No org is created.
export async function dismissInboundLead(id: string): Promise<void> {
  const { error } = await supabase
    .from("inbound_leads")
    .update({ status: "dismissed" })
    .eq("id", id);
  if (error) throw error;
}
