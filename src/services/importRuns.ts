// E3.0 — the import_runs / import_rows staging service (TE-2/TE-3). The ONLY
// Supabase caller for the bulk-roster-import pipeline. Nothing here touches
// live provider/group/facility tables — staged rows wait for E3.1's
// preview/commit. Writes are admin-only under RLS (the F3.0.1 gate); every
// lifecycle event is audited per TE-10 (upload created, scan completed, scan
// failed, run cancelled). Scanned cells reach this boundary ALREADY
// SSN-redacted by src/lib/rosterImport (TE-6) — this service never sees a
// full SSN.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { currentUserId, requireActiveOrg, writeAudit } from "@/lib/audit";
import { translateDbError } from "@/lib/dbErrors";
import { ensureFirstFacilityPrimary, insertAssignmentRows } from "@/services/providerAssignments";
import { createEnrollmentFact, listEnrollmentFacts } from "@/services/enrollmentFacts";
import {
  createFacility,
  createProviderGroup,
  type FacilityInput,
  type ProviderGroupInput,
} from "@/services/orgSettings";
import { decodeDelimited } from "@/lib/importSections";
import { normalizeWebsiteUrl } from "@/lib/providerGroup";
import { attachGroupPayer, listPayerNetworkTargets } from "@/services/payerNetworkTargets";
import type { ScannedRow } from "@/lib/rosterImport";
import type {
  BatchAssignmentPlan,
  CommitPlan,
  SectionBlockedEntry,
  SectionCreateEntry,
  StagedImportRow,
} from "@/lib/importDedupe";
import type { ImportEntityKind, ImportRun, ImportRunErrorEntry, ImportRunSource } from "@/types";

const RUN_LIST_LIMIT = 20;

export async function listImportRuns(): Promise<ImportRun[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("import_runs")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(RUN_LIST_LIMIT);
  if (error) throw error;
  return camelizeRow<ImportRun[]>(data ?? []);
}

export async function getImportRun(id: string): Promise<ImportRun | null> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("import_runs")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<ImportRun>(data) : null;
}

export interface CreateImportRunInput {
  source: ImportRunSource;
  /** E3.3 TE-1: the per-section discriminator written onto the run. */
  entityKind: ImportEntityKind;
  fileName: string;
  totalRows: number;
}

/** Insert the durable run header (state 'uploading'). The scan driver flips it
 * to 'scanning' as its first act, so a run that dies immediately is honestly
 * stale rather than invisible. */
export async function createImportRun(input: CreateImportRunInput): Promise<ImportRun> {
  const orgId = requireActiveOrg();
  const userId = currentUserId();
  if (!userId) throw new Error("No authenticated user");
  const { data, error } = await supabase
    .from("import_runs")
    .insert({
      org_id: orgId,
      created_by: userId,
      source: input.source,
      entity_kind: input.entityKind,
      file_name: input.fileName,
      state: "uploading",
      total_rows: input.totalRows,
      staged_rows: 0,
      error_rows: 0,
    })
    .select("*")
    .single();
  if (error) throw error;
  const run = camelizeRow<ImportRun>(data);
  await writeAudit({
    actionType: "CREATE",
    entityType: "import_run",
    entityId: run.id,
    after: { id: run.id, source: run.source, fileName: run.fileName, totalRows: run.totalRows },
    description: `Roster import upload created (${run.fileName ?? "file"}, ${run.totalRows ?? 0} rows)`,
  });
  return run;
}

export async function markImportRunScanning(id: string): Promise<void> {
  const orgId = requireActiveOrg();
  const { error } = await supabase
    .from("import_runs")
    .update({ state: "scanning", updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", id)
    .eq("state", "uploading");
  if (error) throw error;
}

/** One batched chunk through the SECURITY DEFINER stage_import_rows RPC —
 * inserts the rows AND recomputes the run's staged/error counts in one round
 * trip. Idempotent under UNIQUE (run_id, line): a re-sent chunk neither
 * duplicates rows nor double-counts. */
export async function stageImportRows(runId: string, rows: ScannedRow[]): Promise<void> {
  if (rows.length === 0) return;
  // `supabase.rpc` must be called bound — extracting the method throws at call
  // time (CLAUDE.md gotcha).
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { error } = await rpc("stage_import_rows", {
    p_run_id: runId,
    p_rows: rows.map((r) => ({
      line: r.line,
      raw: r.raw,
      mapped: r.mapped,
      row_state: r.rowState,
      error_column: r.errorColumn,
      error_reason: r.errorReason,
    })),
  });
  if (error) throw new Error(error.message);
}

/** Scan finished: land the run in ready_for_review with the compact error
 * report (the download source that survives the TE-7 purge). */
export async function completeImportRun(
  id: string,
  errorReport: ImportRunErrorEntry[],
): Promise<void> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("import_runs")
    .update({
      state: "ready_for_review",
      error_report: errorReport as never,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId)
    .eq("id", id)
    .select("staged_rows, error_rows")
    .single();
  if (error) throw error;
  const counts = camelizeRow<{ stagedRows: number | null; errorRows: number | null }>(data);
  await writeAudit({
    actionType: "UPDATE",
    entityType: "import_run",
    entityId: id,
    after: { id, state: "ready_for_review", ...counts },
    description: `Roster import scan completed (${counts.stagedRows ?? 0} staged, ${counts.errorRows ?? 0} errors)`,
  });
}

/** Catastrophic scan failure (e.g. a staging batch kept failing): the run is
 * honestly 'failed' with the reason in error_report — never a silent hang. */
export async function failImportRun(id: string, reason: string): Promise<void> {
  const orgId = requireActiveOrg();
  const report: ImportRunErrorEntry[] = [{ line: 0, column: null, reason }];
  const { error } = await supabase
    .from("import_runs")
    .update({
      state: "failed",
      error_report: report as never,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw error;
  await writeAudit({
    actionType: "UPDATE",
    entityType: "import_run",
    entityId: id,
    after: { id, state: "failed" },
    description: "Roster import scan failed",
  });
}

/** Cancel a run: PURGE its staged rows first (TE-7 — staged PII is deleted on
 * terminal transitions), then flip the run header. Re-running after a partial
 * failure deletes zero rows and still lands the state. */
export async function cancelImportRun(id: string): Promise<void> {
  const orgId = requireActiveOrg();
  const { error: purgeError } = await supabase
    .from("import_rows")
    .delete()
    .eq("org_id", orgId)
    .eq("run_id", id);
  if (purgeError) throw purgeError;
  const { error } = await supabase
    .from("import_runs")
    .update({ state: "cancelled", updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw error;
  await writeAudit({
    actionType: "UPDATE",
    entityType: "import_run",
    entityId: id,
    after: { id, state: "cancelled" },
    description: "Roster import run cancelled (staged rows purged)",
  });
}

/* ----------------------- E3.1 — preview + staged commit ----------------------- */

/** One run's staged rows — the dedupe/conflict input (src/lib/importDedupe).
 * Error rows stay out: they are already counted + reported on the run row. */
export async function listStagedImportRows(runId: string): Promise<StagedImportRow[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("import_rows")
    .select("line, mapped")
    .eq("org_id", orgId)
    .eq("run_id", runId)
    .eq("row_state", "staged")
    .order("line", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    line: r.line,
    mapped: (r.mapped as Record<string, string | null> | null) ?? null,
  }));
}

export interface CommitImportRunResult {
  alreadyCommitted: boolean;
  created: number;
  updated: number;
  createdProviderIds: string[];
  updatedProviderIds: string[];
  /** E6.4 F6.4.6 — the post-commit relationship pass's unified summary. */
  relationships: ProviderRelationshipSummary;
}

export interface ProviderRelationshipSummary {
  facilityAssignments: number;
  groupAssignments: number;
  enrollmentFacts: number;
}

/** E6.4 F6.4.6 — the one-row-per-relationship pass. Staged rows carry ids the
 * scan already resolved (facility_id, enrollment_payer_id — never re-resolved
 * names); providers are joined by NPI against the RPC's created+updated ids.
 * Every write is idempotent (assignment uniques ignoreDuplicates; facts
 * skip-on-live-match), so a mid-pass failure leaves a resumable state and a
 * replay adds nothing. Runs AFTER the transactional provider commit — the
 * provider rows are live by the time relationships attach to them. */
async function applyProviderRelationships(
  stagedRows: { mapped: Record<string, string | null> | null }[],
  providerIds: string[],
): Promise<ProviderRelationshipSummary> {
  const summary: ProviderRelationshipSummary = {
    facilityAssignments: 0,
    groupAssignments: 0,
    enrollmentFacts: 0,
  };
  const rows = stagedRows
    .map((r) => r.mapped)
    .filter((m): m is Record<string, string | null> => m !== null)
    .filter((m) => m.facility_id || m.enrollment_payer_id || m.group_name || m.group_tin);
  if (rows.length === 0 || providerIds.length === 0) return summary;
  const orgId = requireActiveOrg();

  const { data: providerRows, error: pErr } = await supabase
    .from("providers")
    .select("id, npi")
    .eq("org_id", orgId)
    .in("id", providerIds);
  if (pErr) throw pErr;
  const providerByNpi = new Map(
    (providerRows ?? []).filter((r) => r.npi).map((r) => [String(r.npi), r.id as string]),
  );

  const { data: groupRows, error: gErr } = await supabase
    .from("provider_groups")
    .select("id, name, tin")
    .eq("org_id", orgId);
  if (gErr) throw gErr;
  const groupByTin = new Map(
    (groupRows ?? []).filter((g) => g.tin).map((g) => [String(g.tin), g.id as string]),
  );
  const groupByName = new Map(
    (groupRows ?? []).map((g) => [String(g.name).trim().toLowerCase(), g.id as string]),
  );
  const resolveGroup = (m: Record<string, string | null>): string | null =>
    (m.group_tin ? groupByTin.get(m.group_tin) : undefined) ??
    (m.group_name ? groupByName.get(m.group_name.trim().toLowerCase()) : undefined) ??
    null;

  const existingFacts = await listEnrollmentFacts();
  const liveFactKeys = new Set(
    existingFacts
      .filter((f) => f.expiredAt === null)
      .map((f) => `${f.providerId}|${f.groupId}|${f.payerId}|${f.state}`),
  );

  const facilityInserts: { providerId: string; facilityId: string }[] = [];
  const groupInserts: { providerId: string; groupId: string }[] = [];
  const seenFacility = new Set<string>();
  const seenGroup = new Set<string>();
  for (const m of rows) {
    const npi = m.npi ? String(m.npi) : null;
    const providerId = npi ? providerByNpi.get(npi) : undefined;
    if (!providerId) continue;
    if (m.facility_id) {
      const key = `${providerId}|${m.facility_id}`;
      if (!seenFacility.has(key)) {
        seenFacility.add(key);
        facilityInserts.push({ providerId, facilityId: m.facility_id });
      }
    }
    const groupId = resolveGroup(m);
    if (groupId) {
      const key = `${providerId}|${groupId}`;
      if (!seenGroup.has(key)) {
        seenGroup.add(key);
        groupInserts.push({ providerId, groupId });
      }
    }
    if (m.enrollment_payer_id && m.enrollment_state) {
      const factGroup = groupId;
      if (factGroup) {
        const key = `${providerId}|${factGroup}|${m.enrollment_payer_id}|${m.enrollment_state}`;
        if (!liveFactKeys.has(key)) {
          liveFactKeys.add(key);
          await createEnrollmentFact({
            providerId,
            groupId: factGroup,
            payerId: m.enrollment_payer_id,
            state: m.enrollment_state,
            effectiveDate: m.enrollment_effective_date ?? null,
          });
          summary.enrollmentFacts += 1;
        }
      }
    }
  }

  if (facilityInserts.length > 0) {
    // The pfa start_date CHECK rejects dateless inserts — relationship rows
    // from the CSV default to today (the batch-assign precedent).
    const today = new Date().toISOString().slice(0, 10);
    await insertAssignmentRows(
      facilityInserts.map((f) => ({
        providerId: f.providerId,
        facilityId: f.facilityId,
        startDate: today,
      })),
    );
    summary.facilityAssignments = facilityInserts.length;
  }
  await ensureFirstFacilityPrimary(providerIds);
  if (groupInserts.length > 0) {
    // Idempotent non-primary upserts under UNIQUE (provider_id, group_id) —
    // the commit plan already set each provider's primary group.
    const { error } = await supabase.from("provider_group_assignments").upsert(
      groupInserts.map((g) => ({
        org_id: orgId,
        provider_id: g.providerId,
        group_id: g.groupId,
        is_primary: false,
      })),
      { onConflict: "provider_id,group_id", ignoreDuplicates: true },
    );
    if (error) throw error;
    summary.groupAssignments = groupInserts.length;
  }
  return summary;
}

/** Commit the run through the ONE transactional SECURITY DEFINER RPC (TE-5):
 * a failure rolls every live write back and the run stays ready_for_review
 * (resumable); a replay sees 'committed' and no-ops. The RPC writes the
 * run-level AND per-entity audit rows inside the transaction, so this service
 * deliberately does NOT also writeAudit (the E1.7b publish-RPC rule). */
export async function commitImportRun(
  runId: string,
  plan: CommitPlan,
): Promise<CommitImportRunResult> {
  requireActiveOrg();
  // Snapshot the staged rows BEFORE the RPC — commit purges import_rows
  // (TE-7), and the relationship pass reads the scan-resolved ids off them.
  const stagedSnapshot = await listStagedImportRows(runId);
  // `supabase.rpc` must be called bound (CLAUDE.md gotcha).
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("commit_import_run", {
    p_run_id: runId,
    p_plan: plan as unknown as Record<string, unknown>,
  });
  if (error) throw new Error(error.message);
  const raw = (data ?? {}) as {
    already_committed?: boolean;
    created?: number;
    updated?: number;
    created_provider_ids?: string[] | null;
    updated_provider_ids?: string[] | null;
  };
  const result = {
    alreadyCommitted: Boolean(raw.already_committed),
    created: raw.created ?? 0,
    updated: raw.updated ?? 0,
    createdProviderIds: raw.created_provider_ids ?? [],
    updatedProviderIds: raw.updated_provider_ids ?? [],
  };
  // E6.4 F6.4.6 — attach the CSV's relationship rows (facilities, extra
  // groups, enrollment facts) to the now-live providers. A replayed commit
  // (alreadyCommitted) re-runs nothing; the pass itself is idempotent.
  let relationships: ProviderRelationshipSummary = {
    facilityAssignments: 0,
    groupAssignments: 0,
    enrollmentFacts: 0,
  };
  if (!result.alreadyCommitted) {
    relationships = await applyProviderRelationships(stagedSnapshot, [
      ...result.createdProviderIds,
      ...result.updatedProviderIds,
    ]);
    await ensureFirstFacilityPrimary([...result.createdProviderIds, ...result.updatedProviderIds]);
  }
  return { ...result, relationships };
}

export interface BatchAssignmentResult {
  groupsAdded: number;
  facilitiesAdded: number;
  skippedProviders: number;
}

/** F3.1.5 — the one-shot batch assignment for a committed run's providers.
 * The plan comes from the pure planBatchAssignment (explicit row data wins —
 * only assignment GAPS are filled); both insert paths are idempotent under
 * the DB uniques (TE-7), so running it twice adds nothing. New facility
 * assignments carry the caller's start date (the pfa start_date CHECK
 * rejects dateless inserts). */
export async function applyBatchAssignment(input: {
  runId: string;
  groupId: string | null;
  facilityIds: string[];
  startDate: string;
  plan: BatchAssignmentPlan;
}): Promise<BatchAssignmentResult> {
  const orgId = requireActiveOrg();
  if (input.plan.groupInserts.length > 0) {
    const { error } = await supabase.from("provider_group_assignments").upsert(
      input.plan.groupInserts.map((g) => ({
        org_id: orgId,
        provider_id: g.providerId,
        group_id: g.groupId,
        is_primary: g.isPrimary,
      })),
      { onConflict: "provider_id,group_id", ignoreDuplicates: true },
    );
    if (error) throw translateDbError(error);
  }
  if (input.plan.facilityInserts.length > 0) {
    await insertAssignmentRows(
      input.plan.facilityInserts.map((f, i, all) => ({
        providerId: f.providerId,
        facilityId: f.facilityId,
        startDate: input.startDate,
        isPrimary: all.findIndex((x) => x.providerId === f.providerId) === i,
      })),
    );
  }
  const touchedProviderIds = [
    ...new Set([
      ...input.plan.groupInserts.map((g) => g.providerId),
      ...input.plan.facilityInserts.map((f) => f.providerId),
    ]),
  ];
  await ensureFirstFacilityPrimary(touchedProviderIds);
  const result: BatchAssignmentResult = {
    groupsAdded: input.plan.groupInserts.length,
    facilitiesAdded: input.plan.facilityInserts.length,
    skippedProviders: input.plan.skippedProviderIds.length,
  };
  await writeAudit({
    actionType: "UPDATE",
    entityType: "import_run",
    entityId: input.runId,
    after: {
      id: input.runId,
      groupId: input.groupId,
      facilityIds: input.facilityIds,
      ...result,
    },
    description: "Batch assignment applied to imported providers",
  });
  return result;
}

/* ----- E3.3 TE-8 — provider_group / facility commit fan-out ----- */
//
// The provider commit is the transactional commit_import_run RPC. Groups and
// facilities are simpler (skip-on-match, no conflict review), so their commit
// fans out through the EXISTING create services (createProviderGroup /
// createFacility) — a thin per-kind branch, NOT a second engine (TE-8). Those
// services set org_id, translate DB errors, and write their own per-entity
// audit rows; here we run the create loop, then flip the run to committed and
// purge the staged rows (the E3.0 error-report + purge pattern). Not
// single-transaction like the RPC: a mid-loop failure leaves the run
// ready_for_review and re-commit is safe — the TIN / name+address dedupe skips
// what already landed.

function groupInputFromMapped(m: Record<string, string | null>): ProviderGroupInput {
  const states = m.operating_states ? decodeDelimited(m.operating_states) : [];
  return {
    name: m.name ?? "",
    tin: m.tin ?? null,
    npiType2: m.npi_type2 ?? null,
    states: states.length > 0 ? states : null,
    websiteUrl: m.website_url?.trim() ? normalizeWebsiteUrl(m.website_url) : null,
    billingStreet: m.billing_street ?? null,
    billingSuite: m.billing_suite ?? null,
    billingCity: m.billing_city ?? null,
    billingState: m.billing_state ?? null,
    billingZip: m.billing_zip ?? null,
    billingContactName: m.billing_contact_name ?? null,
    billingPhone: m.billing_phone ?? null,
    billingFax: m.billing_fax ?? null,
    billingEmail: m.billing_email ?? null,
    correspondenceStreet: m.corr_street ?? null,
    correspondenceSuite: m.corr_suite ?? null,
    correspondenceCity: m.corr_city ?? null,
    correspondenceState: m.corr_state ?? null,
    correspondenceZip: m.corr_zip ?? null,
    correspondenceContactName: m.corr_contact_name ?? null,
    correspondencePhone: m.corr_phone ?? null,
    correspondenceFax: m.corr_fax ?? null,
    correspondenceEmail: m.corr_email ?? null,
    credentialingStreet: m.cred_street ?? null,
    credentialingSuite: m.cred_suite ?? null,
    credentialingCity: m.cred_city ?? null,
    credentialingState: m.cred_state ?? null,
    credentialingZip: m.cred_zip ?? null,
    credentialingContactName: m.cred_contact_name ?? null,
    credentialingPhone: m.cred_phone ?? null,
    credentialingFax: m.cred_fax ?? null,
    credentialingEmail: m.cred_email ?? null,
  };
}

function facilityInputFromMapped(m: Record<string, string | null>, groupId: string): FacilityInput {
  const ada: { accessible?: boolean; notes?: string } = {};
  if (m.ada_accessible != null) ada.accessible = m.ada_accessible === "true";
  if (m.ada_notes) ada.notes = m.ada_notes;
  const languages = m.languages_offered ? decodeDelimited(m.languages_offered) : [];
  const interpreters = m.interpreter_languages ? decodeDelimited(m.interpreter_languages) : [];
  return {
    name: m.facility_name ?? "",
    groupId,
    street: m.street ?? null,
    suite: m.suite ?? null,
    city: m.city ?? null,
    state: m.state ?? null,
    zip: m.zip ?? null,
    county: m.county ?? null,
    phone: m.phone ?? null,
    fax: m.fax ?? null,
    email: m.email ?? null,
    appointmentPhone: m.appointment_phone ?? null,
    contactName: m.contact_name ?? null,
    acceptingNewPatients:
      m.accepting_new_patients == null ? null : m.accepting_new_patients === "true",
    languagesOffered: languages.length > 0 ? languages : null,
    interpreterLanguages: interpreters.length > 0 ? interpreters : null,
    adaCompliance: Object.keys(ada).length > 0 ? ada : null,
  };
}

export interface SectionCommitResult {
  alreadyCommitted: boolean;
  created: number;
  skipped: number;
  blocked: number;
}

export async function commitSectionImportRun(input: {
  runId: string;
  entityKind: "provider_group" | "facility";
  creates: SectionCreateEntry[];
  skippedCount: number;
  blocked: SectionBlockedEntry[];
}): Promise<SectionCommitResult> {
  const orgId = requireActiveOrg();
  const run = await getImportRun(input.runId);
  if (!run) throw new Error("Import run not found");
  if (run.state === "committed") {
    return { alreadyCommitted: true, created: 0, skipped: 0, blocked: 0 };
  }
  if (run.state !== "ready_for_review") {
    throw new Error(`Import run is not ready to commit (state ${run.state})`);
  }

  let created = 0;
  for (const entry of input.creates) {
    if (input.entityKind === "provider_group") {
      await createProviderGroup(groupInputFromMapped(entry.mapped));
    } else {
      if (!entry.groupId) throw new Error(`Facility on line ${entry.line} has no resolved group`);
      await createFacility(facilityInputFromMapped(entry.mapped, entry.groupId));
    }
    created += 1;
  }

  // Flip the run to committed, append blocked entries to the durable error
  // report (they survive the purge), and purge the staged rows.
  const blockedEntries: ImportRunErrorEntry[] = input.blocked.map((b) => ({
    line: b.line,
    column: b.column,
    reason: b.reason,
  }));
  const nextReport = [...(run.errorReport ?? []), ...blockedEntries];
  const { error } = await supabase
    .from("import_runs")
    .update({
      state: "committed",
      committed_at: new Date().toISOString(),
      error_report: nextReport as never,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId)
    .eq("id", input.runId)
    .eq("state", "ready_for_review");
  if (error) throw error;

  const { error: purgeError } = await supabase
    .from("import_rows")
    .delete()
    .eq("org_id", orgId)
    .eq("run_id", input.runId);
  if (purgeError) throw purgeError;

  await writeAudit({
    actionType: "UPDATE",
    entityType: "import_run",
    entityId: input.runId,
    after: {
      id: input.runId,
      entityKind: input.entityKind,
      created,
      skipped: input.skippedCount,
      blocked: blockedEntries.length,
    },
    description: `Roster import run committed (${input.entityKind}, ${created} created)`,
  });

  return {
    alreadyCommitted: false,
    created,
    skipped: input.skippedCount,
    blocked: blockedEntries.length,
  };
}

/* ------------------- E6.2 — payer-attach commit fan-out -------------------- */

export interface PayerAttachCommitResult {
  alreadyCommitted: boolean;
  createdTargets: number;
  restoredTargets: number;
  skippedTargets: number;
}

/**
 * Commit a `payer_attach` run: each staged row carries the scan-resolved
 * `group_id`/`payer_id` (the descriptor's contextScan stamp) and its
 * ';'-delimited states. Idempotent skip-on-match against existing targets —
 * an already-active target skips, an archived one RESTORES (never a duplicate
 * insert under the (group, payer, state) unique), and the org-level enablement
 * rides attachGroupPayer (OPA-RETIRE: targets only). A mid-loop failure leaves
 * the run resumable (the same rows skip on retry).
 */
export async function commitPayerAttachImportRun(input: {
  runId: string;
}): Promise<PayerAttachCommitResult> {
  const orgId = requireActiveOrg();
  const run = await getImportRun(input.runId);
  if (!run) throw new Error("Import run not found");
  if (run.state === "committed") {
    return { alreadyCommitted: true, createdTargets: 0, restoredTargets: 0, skippedTargets: 0 };
  }
  if (run.state !== "ready_for_review") {
    throw new Error(`Import run is not ready to commit (state ${run.state})`);
  }

  const staged = await listStagedImportRows(input.runId);
  const existing = await listPayerNetworkTargets();
  const targetByKey = new Map(existing.map((t) => [`${t.groupId}|${t.payerId}|${t.state}`, t]));

  let createdTargets = 0;
  let restoredTargets = 0;
  let skippedTargets = 0;
  const planByPayer = new Map<
    string,
    { inserts: Array<{ groupId: string; state: string }>; restoreIds: string[] }
  >();
  const planned = new Set<string>();

  for (const row of staged) {
    const mapped = row.mapped ?? {};
    const groupId = mapped.group_id;
    const payerId = mapped.payer_id;
    if (!groupId || !payerId) continue; // defensive — contextScan stamps both
    for (const state of decodeDelimited(mapped.states ?? "")) {
      const key = `${groupId}|${payerId}|${state}`;
      if (planned.has(key)) continue; // repeated combos in the file plan once
      planned.add(key);
      const match = targetByKey.get(key);
      if (match && match.status === "active") {
        skippedTargets += 1;
        continue;
      }
      const plan = planByPayer.get(payerId) ?? { inserts: [], restoreIds: [] };
      if (match) {
        plan.restoreIds.push(match.id);
        restoredTargets += 1;
      } else {
        plan.inserts.push({ groupId, state });
        createdTargets += 1;
      }
      planByPayer.set(payerId, plan);
    }
  }

  for (const [payerId, plan] of planByPayer) {
    await attachGroupPayer(payerId, plan);
  }

  const { error } = await supabase
    .from("import_runs")
    .update({
      state: "committed",
      committed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId)
    .eq("id", input.runId)
    .eq("state", "ready_for_review");
  if (error) throw error;

  const { error: purgeError } = await supabase
    .from("import_rows")
    .delete()
    .eq("org_id", orgId)
    .eq("run_id", input.runId);
  if (purgeError) throw purgeError;

  await writeAudit({
    actionType: "UPDATE",
    entityType: "import_run",
    entityId: input.runId,
    after: {
      id: input.runId,
      entityKind: "payer_attach",
      createdTargets,
      restoredTargets,
      skippedTargets,
    },
    description: `Payer attach import committed (${createdTargets} created, ${restoredTargets} restored, ${skippedTargets} skipped)`,
  });

  return { alreadyCommitted: false, createdTargets, restoredTargets, skippedTargets };
}
