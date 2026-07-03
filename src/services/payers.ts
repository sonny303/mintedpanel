// Payer CRUD (org-scoped) with audit on writes.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow, snakeizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import type { Payer } from "@/types";

export interface PayerInput {
  name: string;
  isActive?: boolean;
  avgDecisionDays?: number | null;
  provisionalBillingAllowed?: boolean;
  provisionalBillingNotes?: string | null;
  retroBillingAllowed?: boolean;
  retroBillingWindowDays?: number | null;
  caqhPullDeadlineDays?: number | null;
  providerTypePath?: "individual" | "organizational" | null;
  priorAuthVendor?: string | null;
  payerBillingId?: string | null;
  portalUrl?: string | null;
}

export async function listPayers(): Promise<Payer[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("payers")
    .select("*")
    .eq("org_id", orgId)
    .order("name");
  if (error) throw error;
  return camelizeRow<Payer[]>(data ?? []);
}

export async function getPayer(id: string): Promise<Payer | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("payers")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<Payer>(data) : null;
}

export async function createPayer(input: PayerInput): Promise<Payer> {
  const orgId = requireActiveOrg();
  const payload = { ...snakeizeRow<Record<string, unknown>>(input), org_id: orgId };
  const { data, error } = await supabase
    .from("payers")
    .insert(payload as never)
    .select("*")
    .single();
  if (error) throw error;
  const created = camelizeRow<Payer>(data);
  await writeAudit({
    actionType: "CREATE",
    entityType: "payer",
    entityId: created.id,
    after: created,
    description: `Created payer ${created.name}`,
  });
  return created;
}

export async function updatePayer(id: string, patch: Partial<PayerInput>): Promise<Payer> {
  const orgId = requireActiveOrg();
  const before = await getPayer(id);
  const payload = snakeizeRow<Record<string, unknown>>(patch);
  const { data, error } = await supabase
    .from("payers")
    .update(payload as never)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (error) throw error;
  const after = camelizeRow<Payer>(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "payer",
    entityId: id,
    before,
    after,
    description: `Updated payer ${after.name}`,
  });
  return after;
}
