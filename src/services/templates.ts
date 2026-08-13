// SOP template CRUD (org-scoped, admin-write enforced by RLS) with audit,
// plus the E1.7b Model A versioning surface: publish (immutable version rows
// via the publish_sop_template_version RPC — the RPC writes the audit row, so
// publishTemplate must NOT also call writeAudit) and version-history reads.
// The archived column is `archived`; TemplateInput accepts either alias.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow, snakeizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import { translateDbError } from "@/lib/dbErrors";
import { orgSopMatchKeyError, templateStates } from "@/lib/sopMatchKey";
import type { Database, Json } from "@/integrations/supabase/types";
import type { SOPTaskDefinition, SOPTemplate, SOPTemplateVersion } from "@/types";

type SopTemplateInsert = Database["public"]["Tables"]["sop_templates"]["Insert"];
type SopTemplateUpdate = Database["public"]["Tables"]["sop_templates"]["Update"];

export interface TemplateInput {
  name: string;
  groupId?: string | null;
  /** The states this template applies to (a lone `'All'` = All-states). The
   * scalar `state` column is written as a frozen mirror of `states[0]`. */
  states?: string[] | null;
  specialty?: string | null;
  payerId?: string | null;
  taskDefinitions: SOPTaskDefinition[];
  archived?: boolean;
  isArchived?: boolean;
  /** E4.2 TE-13 — governed required-profile-attribute keys (head working copy;
   * publish snapshots them into the version). */
  requiredProfileAttributes?: string[];
}

function normalizeTemplate(row: SOPTemplate): SOPTemplate {
  const archived = Boolean(row.isArchived ?? row.archived ?? false);
  const requiredProfileAttributes = Array.isArray(row.requiredProfileAttributes)
    ? row.requiredProfileAttributes
    : [];
  return { ...row, archived, isArchived: archived, requiredProfileAttributes };
}

function templatePayload(input: Partial<TemplateInput>, orgId: string): SopTemplateInsert {
  const { archived, isArchived, ...rest } = input;
  const payload = snakeizeRow<Record<string, unknown>>(rest);
  payload.org_id = orgId;
  const archiveValue = archived ?? isArchived;
  if (archiveValue !== undefined) payload.archived = archiveValue;
  // Keep the frozen `state` scalar in step with `states` on every write, so a
  // reader that predates the multi-state migration still sees a real state
  // rather than NULL. Never the reverse — `states` is authoritative.
  if (input.states !== undefined) {
    payload.state = input.states?.[0] ?? null;
  }
  return payload as unknown as SopTemplateInsert;
}

/** E4.2 SOP hardening — an ACTIVE organization template MUST target a payer AND
 * a state (the supported runtime match grain; "Any payer" / "Any state" are not
 * valid org-authored combinations). Enforced at the service boundary — not only
 * in the wizard — for active creates and for the destination key of an
 * update/restore, so no path can persist an unsupported active org SOP. Archived
 * rows are EXEMPT (legacy rows and archived migration copies stay writable and
 * archivable); reads are never gated, so legacy rows remain viewable. Uses the
 * SAME pure `orgSopMatchKeyError` rule the wizard blocks on. */
function assertActiveOrgMatchKeyComplete(key: {
  payerId: string | null;
  states: string[] | null;
  archived: boolean;
}): void {
  if (key.archived) return;
  const err = orgSopMatchKeyError({ payerId: key.payerId, states: key.states });
  if (err) throw new Error(err);
}

/** E4.2 SOP hardening — reject a match-key that would create a SECOND active
 * organization template at the supported grain (payer + state + group, group
 * NULLS-NOT-DISTINCT). This mirrors the additive `uq_sop_templates_active_org_match`
 * index and runs BEFORE the write so the author sees a clear blocking message
 * (the DB constraint stays the backstop for races). Only ACTIVE org templates
 * WITH payer + state are constrained — archived / payer-or-state-less rows are
 * outside the runtime-selectable grain and never validated here. */
async function assertUniqueActiveMatch(
  orgId: string,
  key: {
    payerId: string | null;
    states: string[] | null;
    groupId: string | null;
    archived: boolean;
  },
  excludeId?: string,
): Promise<void> {
  if (key.archived || !key.payerId || !key.states || key.states.length === 0) return;
  let query = supabase
    .from("sop_templates")
    .select("id, name, states")
    .eq("org_id", orgId)
    .eq("archived", false)
    .eq("payer_id", key.payerId)
    // Multi-state: the collision is an OVERLAP, not equality — `overlaps` is
    // PostgREST's `&&`. The DB trigger is the race-proof backstop; this pre-check
    // exists so the author gets a message naming the actual clashing states.
    .overlaps("states", key.states);
  query = key.groupId === null ? query.is("group_id", null) : query.eq("group_id", key.groupId);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  const existing = data?.[0] as { name: string; states: string[] | null } | undefined;
  if (existing) {
    const clashing = (existing.states ?? []).filter((s) => key.states?.includes(s));
    const which = clashing.length > 0 ? clashing.slice().sort().join(", ") : "these states";
    throw new Error(
      `“${existing.name}” already covers ${which} for this payer and group. ` +
        `Remove ${clashing.length === 1 ? "that state" : "those states"} here, or edit that template instead.`,
    );
  }
}

export async function listTemplates(): Promise<SOPTemplate[]> {
  const orgId = requireActiveOrg();
  // Own-org rows plus global-catalog SOPs (org_id NULL). RLS returns only global
  // SOPs whose payer the org is assigned (org_payer_assignments); no global SOPs
  // exist yet, so this is behaviour-identical to the prior own-org query today.
  const { data, error } = await supabase
    .from("sop_templates")
    .select("*")
    .or(`org_id.eq.${orgId},org_id.is.null`)
    .order("name");
  if (error) throw error;
  return camelizeRow<SOPTemplate[]>(data ?? []).map(normalizeTemplate);
}

export async function getTemplate(id: string): Promise<SOPTemplate | null> {
  const orgId = requireActiveOrg();
  // Own-org OR global (the listTemplates form) so the seeded fallback and any
  // assigned global SOP can be opened read-only and its history viewed (E1.7b
  // TE-2). RLS scopes which global rows are visible; writes stay own-org —
  // updateTemplate below still filters org_id, and RLS rejects global writes.
  const { data, error } = await supabase
    .from("sop_templates")
    .select("*")
    .eq("id", id)
    .or(`org_id.eq.${orgId},org_id.is.null`)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeTemplate(camelizeRow<SOPTemplate>(data)) : null;
}

/**
 * Thrown when a publish loses the optimistic-concurrency race (the RPC's
 * `sop_version_conflict` RAISE): someone else published a newer version since
 * this editor loaded the head. The wizard maps it to a friendly toast.
 */
export class SopVersionConflictError extends Error {
  constructor() {
    super("Someone else published a newer version of this template.");
    this.name = "SopVersionConflictError";
  }
}

export interface PublishResult {
  templateId: string;
  version: number;
}

/** One transaction on the server: insert version N+1, update the head jsonb,
 * bump current_version (optimistic-concurrency guarded), write the audit row. */
export async function publishTemplate(
  templateId: string,
  expectedVersion: number,
  name: string,
  taskDefinitions: SOPTaskDefinition[],
  changeNote?: string | null,
  requiredProfileAttributes?: string[],
): Promise<PublishResult> {
  requireActiveOrg();
  const rpc = supabase.rpc.bind(supabase);
  const { data, error } = await rpc("publish_sop_template_version", {
    p_template_id: templateId,
    p_expected_version: expectedVersion,
    p_name: name,
    p_task_definitions: taskDefinitions as unknown as Json,
    p_change_note: changeNote ?? undefined,
    p_required_profile_attributes: (requiredProfileAttributes ?? []) as unknown as Json,
  });
  if (error) {
    if (error.message.includes("sop_version_conflict")) throw new SopVersionConflictError();
    throw error;
  }
  const result = data as unknown as { template_id: string; version: number };
  return { templateId: result.template_id, version: result.version };
}

function versionFromRow(row: Record<string, unknown>): SOPTemplateVersion {
  return camelizeRow<SOPTemplateVersion>(row);
}

/** Version history, newest first, with publisher display names resolved via
 * profiles (backfilled rows have publishedBy NULL). */
export async function listTemplateVersions(templateId: string): Promise<SOPTemplateVersion[]> {
  requireActiveOrg();
  const { data, error } = await supabase
    .from("sop_template_versions")
    .select("*")
    .eq("template_id", templateId)
    .order("version", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []).map((r) => versionFromRow(r as Record<string, unknown>));
  const publisherIds = [...new Set(rows.map((r) => r.publishedBy).filter(Boolean))] as string[];
  const nameMap = new Map<string, string | null>();
  if (publisherIds.length > 0) {
    const { data: profs, error: profErr } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", publisherIds);
    if (profErr) throw profErr;
    for (const p of profs ?? []) {
      nameMap.set(p.id as string, (p.full_name as string | null) ?? (p.email as string | null));
    }
  }
  return rows.map((r) => ({
    ...r,
    publishedByName: r.publishedBy ? (nameMap.get(r.publishedBy) ?? null) : null,
  }));
}

export async function getTemplateVersion(
  templateId: string,
  version: number,
): Promise<SOPTemplateVersion | null> {
  requireActiveOrg();
  const { data, error } = await supabase
    .from("sop_template_versions")
    .select("*")
    .eq("template_id", templateId)
    .eq("version", version)
    .maybeSingle();
  if (error) throw error;
  return data ? versionFromRow(data as Record<string, unknown>) : null;
}

// ---------------------------------------------------------------------------
// E6.5 F6.5.6 — GLOBAL SOP authoring via the author_global_sop RPC ("authored
// once, inherited by every org"). Create takes name + task definitions (the
// AFTER INSERT trigger seeds version 1); update edits the match key / archived
// flag ONLY — content changes go through publishTemplate, mirroring the org
// path's TE-5 save split. NO writeAudit: audit_log requires an org_id and
// global rows are cross-org; the immutable version rows + published_by are the
// trail (interim posture, R7 hardens platform governance).
// ---------------------------------------------------------------------------
export interface GlobalSopInput {
  /** Existing global head id to update; null/undefined creates. */
  id?: string | null;
  name: string;
  payerId: string | null;
  states: string[] | null;
  groupId?: string | null;
  /** Create only — ignored on update (publish owns content). */
  taskDefinitions?: SOPTaskDefinition[];
  /** Create only — versioned with content thereafter (publish owns it). */
  requiredProfileAttributes?: string[];
  archived?: boolean;
}

export async function authorGlobalSop(input: GlobalSopInput): Promise<SOPTemplate> {
  requireActiveOrg();
  const rpc = supabase.rpc.bind(supabase);
  const { data, error } = await rpc("author_global_sop", {
    p_id: (input.id ?? null) as unknown as string,
    p_name: input.name.trim(),
    p_payer_id: input.payerId as unknown as string,
    p_states: (input.states ?? null) as unknown as string[],
    p_group_id: (input.groupId ?? null) as unknown as string,
    p_task_definitions: (input.taskDefinitions ?? []) as unknown as Json,
    p_archived: (input.archived ?? false) as boolean,
    p_required_profile_attributes: (input.requiredProfileAttributes ?? []) as unknown as Json,
  });
  if (error) {
    if (error.message.includes("global_sop_duplicate_match")) {
      // The RPC appends the clashing states after the code — surface them, since
      // "somewhere in your selection" is not actionable.
      const clash = error.message.split("global_sop_duplicate_match:")[1]?.trim();
      throw new Error(
        clash
          ? `An active global SOP already covers ${clash} for this payer and group. Edit that SOP instead of creating a duplicate.`
          : "An active global SOP already exists for this payer, state, and group. " +
              "Edit that SOP instead of creating a duplicate.",
      );
    }
    if (error.message.includes("global_sop_match_key_incomplete")) {
      throw new Error("A global SOP requires a payer and at least one state.");
    }
    if (error.message.includes("fallback_sop_locked")) {
      throw new Error("The generic fallback SOP is platform-managed and cannot be edited here.");
    }
    throw error;
  }
  return normalizeTemplate(camelizeRow<SOPTemplate>(data));
}

export async function createTemplate(input: TemplateInput): Promise<SOPTemplate> {
  const orgId = requireActiveOrg();
  const archived = Boolean(input.archived ?? input.isArchived ?? false);
  assertActiveOrgMatchKeyComplete({
    payerId: input.payerId ?? null,
    states: input.states ?? null,
    archived,
  });
  await assertUniqueActiveMatch(orgId, {
    payerId: input.payerId ?? null,
    states: input.states ?? null,
    groupId: input.groupId ?? null,
    archived,
  });
  const { data, error } = await supabase
    .from("sop_templates")
    .insert(templatePayload(input, orgId))
    .select("*")
    .single();
  if (error) throw translateDbError(error);
  const created = normalizeTemplate(camelizeRow<SOPTemplate>(data));
  await writeAudit({
    actionType: "CREATE",
    entityType: "sop_template",
    entityId: created.id,
    after: created,
    description: `Created SOP template ${created.name}`,
  });
  return created;
}

export async function updateTemplate(
  id: string,
  patch: Partial<TemplateInput>,
): Promise<SOPTemplate> {
  const orgId = requireActiveOrg();
  const before = await getTemplate(id);
  // Validate the DESTINATION key (before + patch) before saving a match-key or
  // restore edit — a match-key change or an unarchive must land on a supported,
  // non-colliding active grain. Fields absent from the patch keep their prior
  // value. Archiving a legacy row (destination archived) stays exempt, so
  // read/archive of existing rows is never blocked.
  if (before) {
    const nextArchived = Boolean(patch.archived ?? patch.isArchived ?? before.archived);
    const destPayerId = patch.payerId !== undefined ? patch.payerId : before.payerId;
    const destStates = patch.states !== undefined ? patch.states : templateStates(before);
    const destGroupId = patch.groupId !== undefined ? patch.groupId : before.groupId;
    const beforeStates = templateStates(before);
    const statesChanged =
      destStates === null ||
      destStates.length !== beforeStates.length ||
      destStates.some((s) => !beforeStates.includes(s));
    const routingMatchKeyChanged =
      destPayerId !== before.payerId || statesChanged || destGroupId !== before.groupId;
    const restoring = Boolean(before.archived ?? before.isArchived) && !nextArchived;
    if (routingMatchKeyChanged || restoring) {
      assertActiveOrgMatchKeyComplete({
        payerId: destPayerId,
        states: destStates,
        archived: nextArchived,
      });
      await assertUniqueActiveMatch(
        orgId,
        { payerId: destPayerId, states: destStates, groupId: destGroupId, archived: nextArchived },
        id,
      );
    }
  }
  const payload = templatePayload(patch, orgId) as unknown as SopTemplateUpdate;
  const { data, error } = await supabase
    .from("sop_templates")
    .update(payload)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (error) throw translateDbError(error);
  const after = normalizeTemplate(camelizeRow<SOPTemplate>(data));
  await writeAudit({
    actionType: "UPDATE",
    entityType: "sop_template",
    entityId: id,
    before,
    after,
    description: `Updated SOP template ${after.name}`,
  });
  return after;
}
