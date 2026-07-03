// Read-only lookup queries used by list screens: provider groups for the
// active org, coordinators, state licenses, mso routing rules, plus notes.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow, snakeizeRow } from "@/lib/case";
import { currentUserId, requireActiveOrg, writeAudit } from "@/lib/audit";
import type {
  Facility,
  MsoRoutingRule,
  Note,
  NoteEntityType,
  Profile,
  ProviderGroup,
} from "@/types";

export interface StateLicense {
  id: string;
  orgId: string;
  providerId: string | null;
  state: string;
  licenseNumber: string | null;
  licenseType: string | null;
  issueDate: string | null;
  expirationDate: string | null;
  status: string | null;
  createdAt: string | null;
}

export async function getStateLicensesByProvider(providerId: string): Promise<StateLicense[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("state_licenses")
    .select("*")
    .eq("org_id", orgId)
    .eq("provider_id", providerId)
    .order("state", { ascending: true });
  if (error) throw error;
  return camelizeRow<StateLicense[]>(data ?? []);
}

export async function getFacilities(groupId?: string | null): Promise<Facility[]> {
  const orgId = requireActiveOrg();
  let query = supabase
    .from("facilities")
    .select("*")
    .eq("org_id", orgId)
    .order("name", { ascending: true });
  if (groupId) query = query.eq("group_id", groupId);
  const { data, error } = await query;
  if (error) throw error;
  return camelizeRow<Facility[]>(data ?? []);
}

export async function getProviderGroups(): Promise<ProviderGroup[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("provider_groups")
    .select("*")
    .eq("org_id", orgId)
    .order("name", { ascending: true });
  if (error) throw error;
  return camelizeRow<ProviderGroup[]>(data ?? []);
}

export async function getCoordinators(): Promise<Profile[]> {
  const orgId = requireActiveOrg();
  // Every member of the active org (not just those already assigned to a
  // case) so brand-new invitees can be selected as coordinators.
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, profiles(id, email, full_name, created_at)")
    .eq("org_id", orgId);
  if (error) throw error;
  const rows = (
    (data ?? []) as unknown as Array<{
      profiles: Record<string, unknown> | null;
    }>
  )
    .map((r) => r.profiles)
    .filter((p): p is Record<string, unknown> => Boolean(p));
  return camelizeRow<Profile[]>(rows);
}

export async function getMsoRoutingRule(
  payerId: string,
  state: string,
  specialty: string | null,
): Promise<MsoRoutingRule | null> {
  const orgId = requireActiveOrg();
  // Pull every rule for this payer in the active org, then filter and rank
  // in JS using exact, case-sensitive string equality. 'All' is the wildcard
  // for both state and specialty. Most specific match wins (specialty > state);
  // ties broken by created_at desc. Never returns early inside the scan.
  const { data, error } = await supabase
    .from("mso_routing_rules")
    .select("*")
    .eq("org_id", orgId)
    .eq("payer_id", payerId);
  if (error) throw error;
  const rows = camelizeRow<MsoRoutingRule[]>(data ?? []);

  const candidates: Array<{ rule: MsoRoutingRule; score: number; createdMs: number }> = [];
  for (const rule of rows) {
    const ruleState = rule.state ?? "";
    const ruleSpecialty = rule.specialty ?? "";
    const stateMatches = ruleState === state || ruleState === "All";
    const specialtyMatches =
      ruleSpecialty === "All" || (specialty !== null && ruleSpecialty === specialty);
    if (!stateMatches || !specialtyMatches) continue;
    let score = 0;
    if (ruleSpecialty !== "All") score += 2;
    if (ruleState !== "All") score += 1;
    const createdMs = rule.createdAt ? new Date(rule.createdAt).getTime() : 0;

    candidates.push({ rule, score, createdMs });
  }

  candidates.sort((a, b) => b.score - a.score || b.createdMs - a.createdMs);
  return candidates[0]?.rule ?? null;
}

export interface CreateNoteInput {
  entityType: NoteEntityType;
  entityId: string;
  content: string;
}

export async function getNotesFor(entityType: NoteEntityType, entityId: string): Promise<Note[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("org_id", orgId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  const authorIds = Array.from(
    new Set(rows.map((n) => n.author_id).filter((v): v is string => Boolean(v))),
  );
  const nameMap = new Map<string, string | null>();
  if (authorIds.length > 0) {
    const { data: profs, error: profErr } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", authorIds);
    if (profErr) throw profErr;
    for (const p of profs ?? []) {
      const name = (p.full_name as string | null) ?? (p.email as string | null) ?? null;
      nameMap.set(p.id as string, name);
    }
  }

  const merged = rows.map((n) => ({
    ...n,
    author_name: n.author_id ? (nameMap.get(n.author_id as string) ?? null) : null,
  }));
  return camelizeRow<Note[]>(merged);
}

export async function createNote(input: CreateNoteInput): Promise<Note> {
  const orgId = requireActiveOrg();
  const payload = {
    ...snakeizeRow<Record<string, unknown>>(input),
    org_id: orgId,
    author_id: currentUserId(),
  };
  const { data, error } = await supabase
    .from("notes")
    .insert(payload as never)
    .select("*")
    .single();
  if (error) throw error;
  const created = camelizeRow<Note>(data);
  await writeAudit({
    actionType: "CREATE",
    entityType: "note",
    entityId: created.id,
    after: created,
    description: `Added note to ${created.entityType}`,
  });
  return created;
}
