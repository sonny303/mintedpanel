// Field dictionary (org-scoped label -> token memory). Mapping review upserts a
// suggested entry on each token approval; the Fix-it queue confirms/rejects a
// twice-seen suggestion. Writer-only (RLS). Browser path.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg, currentUserId, writeAudit } from "@/lib/audit";
import { normalizeFieldLabel } from "@/lib/tokenFormat";
import type { FieldDictionaryEntry, FieldDictionaryStatus } from "@/types";

const COLUMNS =
  "id, org_id, label_normalized, token, status, seen_count, decided_at, decided_by, created_at, updated_at";

export async function listFieldDictionary(): Promise<FieldDictionaryEntry[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("field_dictionary")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .order("label_normalized", { ascending: true });
  if (error) throw error;
  return camelizeRow<FieldDictionaryEntry[]>(data ?? []);
}

export interface UpsertResult {
  entry: FieldDictionaryEntry | null;
  // True when this approval taught the dictionary something new — a created
  // entry, a bumped suggestion, or a changed token. Drives the "labels learned"
  // tally. Re-approving an already-confirmed rule teaches nothing (false).
  learned: boolean;
}

// Called on every token approval in training. Never auto-confirms — confirmation
// is the human's explicit "Yes, always" in the Fix-it dictionary card.
export async function upsertDictionaryEntry(
  labelRaw: string | null | undefined,
  token: string,
): Promise<UpsertResult> {
  const orgId = requireActiveOrg();
  const labelNormalized = normalizeFieldLabel(labelRaw);
  if (!labelNormalized) return { entry: null, learned: false };

  const { data: existingRow, error: readErr } = await supabase
    .from("field_dictionary")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("label_normalized", labelNormalized)
    .maybeSingle();
  if (readErr) throw readErr;

  if (!existingRow) {
    const { data, error } = await supabase
      .from("field_dictionary")
      .insert({
        org_id: orgId,
        label_normalized: labelNormalized,
        token,
        status: "suggested",
        seen_count: 1,
      } as never)
      .select(COLUMNS)
      .single();
    if (error) throw error;
    return { entry: camelizeRow<FieldDictionaryEntry>(data), learned: true };
  }

  const existing = camelizeRow<FieldDictionaryEntry>(existingRow);

  // A rejected label was deliberately silenced — never touch it here.
  if (existing.status === "rejected") return { entry: existing, learned: false };

  // Already confirmed and unchanged: this approval teaches nothing new.
  if (existing.status === "confirmed" && existing.token === token) {
    return { entry: existing, learned: false };
  }

  const patch =
    existing.token === token
      ? { seen_count: existing.seenCount + 1 }
      : { token, seen_count: 1, status: "suggested" as FieldDictionaryStatus };

  const { data, error } = await supabase
    .from("field_dictionary")
    .update(patch as never)
    .eq("id", existing.id)
    .eq("org_id", orgId)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return { entry: camelizeRow<FieldDictionaryEntry>(data), learned: true };
}

// The Fix-it "confirm" card: Yes -> confirmed (future matches are high-confidence),
// No -> rejected (never guessed again, never re-asked).
export async function decideDictionaryEntry(
  id: string,
  status: Extract<FieldDictionaryStatus, "confirmed" | "rejected">,
): Promise<FieldDictionaryEntry> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("field_dictionary")
    .update({
      status,
      decided_at: new Date().toISOString(),
      decided_by: currentUserId(),
    } as never)
    .eq("id", id)
    .eq("org_id", orgId)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  const entry = camelizeRow<FieldDictionaryEntry>(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "field_dictionary",
    entityId: id,
    after: { labelNormalized: entry.labelNormalized, token: entry.token, status: entry.status },
    description: `Dictionary rule ${status}: "${entry.labelNormalized}" → ${entry.token}`,
  });
  return entry;
}
