// Story 8: batch touchpoint. One parent communication_event per payer call, one
// child touchpoint per selected case (touches.communication_event_id links them).
// A single-case touchpoint is just the same model with communication_event_id
// left NULL — we do not fork a separate concept.
import { supabase } from "@/integrations/supabase/externalClient";
import { currentUserId, requireActiveOrg, writeAudit } from "@/lib/audit";
import { touchTypeForChannel, type Channel } from "@/lib/touchOutcomes";
import type { TouchOutcome } from "@/types";

export interface PayerCaseOption {
  caseId: string;
  providerName: string;
  state: string;
  credentialingStatusId: string | null;
}

// Open cases for a payer (multi-select source, scoped to one payer). "Open" is
// decided by the caller against the status_configs cache (action_bucket), same
// as the rest of the app — this returns every case for the payer + the fields
// needed to filter and label it.
export async function getCasesForPayer(payerId: string): Promise<PayerCaseOption[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("credential_cases")
    .select("id, state, credentialing_status_id, provider:providers(first_name, last_name)")
    .eq("org_id", orgId)
    .eq("payer_id", payerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: string;
    state: string;
    credentialing_status_id: string | null;
    provider: { first_name: string | null; last_name: string | null } | null;
  }>;
  return rows.map((r) => ({
    caseId: r.id,
    providerName:
      `${r.provider?.first_name ?? ""} ${r.provider?.last_name ?? ""}`.trim() || "Unknown provider",
    state: r.state,
    credentialingStatusId: r.credentialing_status_id,
  }));
}

export interface BatchChild {
  caseId: string;
  outcome: TouchOutcome;
  note?: string | null;
}

export interface BatchTouchpointInput {
  payerId: string;
  channel: Channel;
  occurredAt: string; // yyyy-mm-dd
  children: BatchChild[];
}

// Writes the parent event then one child touchpoint per case. Not a DB
// transaction (supabase-js has none) — an orphan parent is harmless (append-only,
// nothing reads a childless event), and children insert in one call so they are
// all-or-nothing relative to each other.
export async function logBatchTouchpoint(input: BatchTouchpointInput): Promise<string> {
  const orgId = requireActiveOrg();
  const touchType = touchTypeForChannel(input.channel);
  const userId = currentUserId();

  const { data: ev, error: evErr } = await supabase
    .from("communication_event")
    .insert({
      org_id: orgId,
      payer_id: input.payerId,
      channel: touchType,
      occurred_at: input.occurredAt,
      created_by: userId,
    } as never)
    .select("id")
    .single();
  if (evErr) throw evErr;
  const eventId = (ev as { id: string }).id;

  const rows = input.children.map((c) => ({
    org_id: orgId,
    case_id: c.caseId,
    touch_date: input.occurredAt,
    entry_type: "touchpoint",
    touch_type: touchType,
    outcome: c.outcome,
    notes: c.note && c.note.trim() ? c.note.trim() : null,
    coordinator_id: userId,
    communication_event_id: eventId,
    source: "manual",
  }));
  const { error: tErr } = await supabase.from("touches").insert(rows as never);
  if (tErr) throw tErr;

  await writeAudit({
    actionType: "TOUCH_LOGGED",
    entityType: "communication_event",
    entityId: eventId,
    after: { payerId: input.payerId, channel: touchType, cases: input.children.length },
    description: `Logged ${input.channel} call across ${input.children.length} case(s)`,
  });
  return eventId;
}
