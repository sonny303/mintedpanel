// S6.1/S6.2 — record that specific provider fields were verified.
//
// Written by the CAQH attestation path (C6: "Record attestation sets
// caqh_last_attested_date AND stamps every field the fill carried") and by
// manual confirmation in the webapp. Read by the Details card to show a
// per-field freshness treatment.
//
// Server ctx path (the providers.ts DI pattern). Org scoping and the actor
// come from the injected context, never a request body.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AuditInput } from "@/lib/audit";
import type { FieldVerification, VerificationSource } from "@/lib/fieldVerification";

export interface FieldVerificationServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
  userId: string;
  writeAudit: (input: AuditInput) => Promise<void>;
}

/** Stamp a set of field keys as verified for one provider.
 *
 * Upserts on (provider_id, field_key): re-verifying REPLACES the stamp rather
 * than accumulating rows, so "when was this last confirmed" has exactly one
 * answer. The audit log carries the history — these writes are audited, so
 * nothing is lost by keeping the table current-only.
 *
 * Returns the number of fields stamped. An empty key list is a no-op, not an
 * error: a fill that carried nothing verifiable simply verifies nothing. */
export async function recordFieldVerifications(
  ctx: FieldVerificationServiceCtx,
  providerId: string,
  fieldKeys: readonly string[],
  source: VerificationSource,
  nowIso: string,
): Promise<number> {
  const keys = [...new Set(fieldKeys.map((k) => k.trim()).filter(Boolean))];
  if (keys.length === 0) return 0;

  const rows = keys.map((fieldKey) => ({
    org_id: ctx.orgId,
    provider_id: providerId,
    field_key: fieldKey,
    verified_at: nowIso,
    verified_source: source,
    verified_by: ctx.userId,
    updated_at: nowIso,
  }));

  const { error } = await ctx.db
    .from("provider_field_verifications")
    .upsert(rows as never, { onConflict: "provider_id,field_key" });
  if (error) throw error;

  await ctx.writeAudit({
    actionType: "UPDATE",
    entityType: "provider",
    entityId: providerId,
    after: { verifiedFields: keys, source, verifiedAt: nowIso },
    description: `Verified ${keys.length} field${keys.length === 1 ? "" : "s"} (${source})`,
  });
  return keys.length;
}

/** The provider's current verification stamps. */
export async function listFieldVerifications(
  ctx: Pick<FieldVerificationServiceCtx, "db" | "orgId">,
  providerId: string,
): Promise<FieldVerification[]> {
  const { data, error } = await ctx.db
    .from("provider_field_verifications")
    .select("field_key, verified_at, verified_source")
    .eq("org_id", ctx.orgId)
    .eq("provider_id", providerId);
  if (error) throw error;
  return (
    (data ?? []) as Array<{
      field_key: string;
      verified_at: string;
      verified_source: string;
    }>
  ).map((r) => ({
    fieldKey: r.field_key,
    verifiedAt: r.verified_at,
    source: r.verified_source as VerificationSource,
  }));
}
