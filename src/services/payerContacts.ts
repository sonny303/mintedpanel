// E6.7 F6.7.2a — payer contacts: operational contacts on a (global) payer,
// keyed by purpose. Reads ride browser RLS (visibility = the parent payer's:
// own-org OR assigned-global); writes go through the upsert_payer_contact /
// delete_payer_contact SECURITY DEFINER RPCs, which validate the purpose
// domain + reachability (email or phone required), swap the one-default-per-
// purpose flag atomically, and write their own audit rows — this service must
// NOT also writeAudit. No rendered UI in E6.7; the Payer Detail design
// consumes this seam later.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg } from "@/lib/audit";
import type { PayerContact, PayerContactPurpose } from "@/types";

const PAYER_CONTACT_ERRORS: Record<string, string> = {
  payer_contact_purpose_invalid: "That is not a valid contact purpose.",
  payer_contact_unreachable: "A contact needs an email address or a phone number.",
  payer_contact_email_invalid: "That email address doesn't look valid.",
};

function mapContactError(error: { message?: string }): Error {
  const raw = error.message ?? "";
  for (const [code, message] of Object.entries(PAYER_CONTACT_ERRORS)) {
    if (raw.includes(code)) return new Error(message);
  }
  return error instanceof Error ? error : new Error(raw || "Contact write failed");
}

export async function listPayerContacts(payerId: string): Promise<PayerContact[]> {
  requireActiveOrg();
  const { data, error } = await supabase
    .from("payer_contacts")
    .select("*")
    .eq("payer_id", payerId)
    .order("purpose")
    .order("is_default", { ascending: false })
    .order("created_at");
  if (error) throw error;
  return camelizeRow<PayerContact[]>(data ?? []);
}

export interface PayerContactInput {
  /** Omitted/undefined = create; set = edit that row. */
  id?: string;
  payerId: string;
  purpose: PayerContactPurpose;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  note?: string | null;
  isDefault?: boolean;
}

export async function upsertPayerContact(input: PayerContactInput): Promise<PayerContact> {
  const orgId = requireActiveOrg();
  const rpc = supabase.rpc.bind(supabase);
  const { data, error } = await rpc("upsert_payer_contact", {
    p_org_id: orgId,
    // p_id carries SQL NULL on create — the RPC signature has no default for
    // it, so the generated Args type is non-optional string; the cast keeps
    // the wire honest without loosening the input type.
    p_id: (input.id ?? null) as unknown as string,
    p_payer_id: input.payerId,
    p_purpose: input.purpose,
    p_name: input.name ?? undefined,
    p_email: input.email ?? undefined,
    p_phone: input.phone ?? undefined,
    p_note: input.note ?? undefined,
    p_is_default: input.isDefault ?? false,
  });
  if (error) throw mapContactError(error);
  return camelizeRow<PayerContact>(data as Record<string, unknown>);
}

export async function deletePayerContact(id: string): Promise<void> {
  const orgId = requireActiveOrg();
  const rpc = supabase.rpc.bind(supabase);
  const { error } = await rpc("delete_payer_contact", {
    p_org_id: orgId,
    p_id: id,
  });
  if (error) throw mapContactError(error);
}
