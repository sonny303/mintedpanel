// E4.3 TE-6 — the extension's next-best-action read. A server-scoped assembly
// of the SAME org caches the browser My Cases queue composes, fed into the SAME
// pure reducer (src/lib/nextBestActions.ts buildNextBestActions) under the org's
// F4.2.5 ranking config, returning only the QUEUE TOP — one item — or an
// explicit empty result. No ranking logic lives here (TE-6): this file is
// data assembly plus one call into the pure module.
//
// The webapp remains the execution authority; nothing is persisted (the E2.3
// queue is fully derived, TE-10). The response is a case pointer + display
// label/reason + a webapp deep link — never a token value, never PHI (the
// readiness facts read reduces DOB/SSN/home-address to booleans right here and
// never emits them, exactly like src/services/enrollmentReadiness.ts).
//
// Server-only surface (no browser-default ctx) — see caseContext.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  buildNextBestActions,
  type QueueEntry,
  type QueueReadinessInput,
  type QueueTouchInput,
} from "@/lib/nextBestActions";
import {
  evaluateEnrollmentReadiness,
  type GroupContractInput,
  type ProviderReadinessFacts,
} from "@/lib/enrollmentReadiness";
import { currentGroupReadinessDocuments } from "@/lib/documents";
import type { PayerPipelineState } from "@/lib/payerPipeline";
import { isCaseStatus } from "@/lib/caseStatus";

export interface NextBestActionServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
}

// The single item the extension renders after a fill/touch — the queue top,
// or null for an honest "queue clear" state. Deep link is the webapp case
// route path; the extension prepends its configured webapp origin.
export interface NextBestActionItem {
  caseId: string;
  providerId: string;
  providerName: string;
  payerName: string;
  groupName: string;
  state: string;
  actionKind: QueueEntry["actionKind"];
  action: string;
  reason: string;
  deadline: QueueEntry["deadline"];
  payerPipelineState?: PayerPipelineState;
  deepLink: string;
}

export interface NextBestActionResult {
  item: NextBestActionItem | null;
  // S3.3 — the ranked queue (same reducer, same order; `item` is items[0]).
  // ADDITIVE: the existing single-item consumer is untouched. Bounded by the
  // route's ?limit= (default 20) so a large org can't return its whole queue.
  items: NextBestActionItem[];
}

// Reduce a task's sop_content jsonb to its smallest positive step cadence —
// the same reduction the browser queue service does at its boundary (the jsonb
// never leaves this module).
function minStepCadence(sopContent: unknown): number | null {
  if (!Array.isArray(sopContent)) return null;
  let min: number | null = null;
  for (const step of sopContent) {
    if (typeof step !== "object" || step === null) continue;
    const value = (step as { followUpEveryDays?: unknown }).followUpEveryDays;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      min = min === null ? value : Math.min(min, value);
    }
  }
  return min;
}

interface CaseRow {
  id: string;
  provider_id: string;
  group_id: string | null;
  payer_id: string;
  state: string;
  credentialing_status_id: string | null;
  case_status?: string | null;
  facility_id: string | null;
  generation_run_id: string | null;
  payer_pipeline_state: string | null;
  created_at: string;
}

interface StatusRow {
  id: string;
  label: string;
  action_bucket: string;
}

interface TaskRow {
  case_id: string | null;
  title: string;
  status: string;
  sort_order: number;
  due_date: string | null;
  sop_content: unknown;
}

interface TouchRow {
  case_id: string;
  entry_type: string;
  touch_date: string;
  next_follow_up_date: string | null;
  created_at: string;
  id: string;
  clears_follow_up: boolean | null;
}

interface ProviderRow {
  id: string;
  first_name: string;
  last_name: string;
  start_date: string | null;
}

// Readiness facts row — the demographic columns are read ONLY to reduce them
// to presence booleans in this function; their values never leave here.
interface ReadinessFactsRow {
  id: string;
  first_name: string;
  last_name: string;
  npi: string | null;
  caqh_id: string | null;
  caqh_last_attested_date: string | null;
  date_of_birth: string | null;
  ssn_last4: string | null;
  malpractice_coverage_end: string | null;
}

/** Assemble the org-scoped queue inputs, rank via the pure reducer, and return
 * the queue top (or an empty result). `today` is a date-only ISO string passed
 * in — never a clock read here (the pure-reducer discipline). */
export async function getNextBestAction(
  ctx: NextBestActionServiceCtx,
  today: string,
  // S3.3: how many ranked entries to return. The default keeps a big org's
  // queue from becoming an unbounded payload; the reducer still ranks the
  // whole set, so items[0] is the true top regardless of the cap.
  limit = 20,
): Promise<NextBestActionResult> {
  const { db, orgId } = ctx;

  const [
    casesRes,
    statusRes,
    tasksRes,
    touchesRes,
    providersRes,
    assignmentsRes,
    facilitiesRes,
    groupsRes,
    payersRes,
    targetsRes,
    groupAssignmentsRes,
    factsRes,
    licensesRes,
    documentsRes,
    insuranceRes,
    contractsRes,
  ] = await Promise.all([
    db
      .from("credential_cases")
      .select(
        "id, provider_id, group_id, payer_id, state, credentialing_status_id, case_status, facility_id, generation_run_id, payer_pipeline_state, created_at",
      )
      .eq("org_id", orgId),
    db.from("status_configs").select("id, label, action_bucket").eq("org_id", orgId),
    db
      .from("tasks")
      .select("case_id, title, status, sort_order, due_date, sop_content")
      .eq("org_id", orgId),
    db
      .from("touches")
      .select(
        "case_id, entry_type, touch_date, next_follow_up_date, created_at, id, clears_follow_up",
      )
      .eq("org_id", orgId)
      .eq("entry_type", "touchpoint"),
    db
      .from("providers")
      .select("id, first_name, last_name, start_date")
      .eq("org_id", orgId)
      .neq("status", "terminated"),
    db
      .from("provider_facility_assignments")
      .select("provider_id, facility_id, start_date")
      .eq("org_id", orgId),
    db
      .from("facilities")
      .select("id, name, effective_date, group_id, state, is_active")
      .eq("org_id", orgId),
    db.from("provider_groups").select("id, name").eq("org_id", orgId),
    db.from("payers").select("id, name").or(`org_id.eq.${orgId},org_id.is.null`),
    db
      .from("payer_network_targets")
      .select("group_id, payer_id, state, status")
      .eq("org_id", orgId),
    db
      .from("provider_group_assignments")
      .select("provider_id, group_id, end_date")
      .eq("org_id", orgId),
    // Readiness facts — the SAME fence as src/services/enrollmentReadiness.ts:
    // pending-verification and the org's test provider are excluded, matching
    // E2.0/E1.8 candidacy so the queue never surfaces a fenced provider.
    db
      .from("providers")
      .select(
        "id, first_name, last_name, npi, caqh_id, caqh_last_attested_date, date_of_birth, ssn_last4",
      )
      .eq("org_id", orgId)
      .neq("status", "terminated")
      .neq("verification_state", "pending_verification")
      .neq("is_test_provider", true),
    db
      .from("state_licenses")
      .select("provider_id, state, expiration_date, verified_status")
      .eq("org_id", orgId),
    // E4.5: version columns ride along ONLY so the shared reducer can keep
    // current versions — a superseded document never feeds readiness.
    db
      .from("provider_documents")
      .select(
        "id, group_id, doc_type, expiration_date, document_family_id, version_number, supersedes_document_id",
      )
      .eq("org_id", orgId)
      .not("group_id", "is", null)
      .in("doc_type", ["w9", "coi", "voided_check"]),
    db.from("group_insurance_policies").select("group_id, policy_end_date").eq("org_id", orgId),
    db
      .from("contracts")
      .select("group_id, payer_id, state, contracting_status_id")
      .eq("org_id", orgId),
  ]);

  for (const res of [
    casesRes,
    statusRes,
    tasksRes,
    touchesRes,
    providersRes,
    assignmentsRes,
    facilitiesRes,
    groupsRes,
    payersRes,
    targetsRes,
    groupAssignmentsRes,
    factsRes,
    licensesRes,
    documentsRes,
    insuranceRes,
    contractsRes,
  ]) {
    if (res.error) throw res.error;
  }

  const statusRows = (statusRes.data ?? []) as StatusRow[];
  const labelById = new Map(statusRows.map((s) => [s.id, s.label]));

  const facts: ProviderReadinessFacts[] = ((factsRes.data ?? []) as ReadinessFactsRow[]).map(
    (r) => ({
      providerId: r.id,
      providerName: `${r.first_name} ${r.last_name}`.trim(),
      npiPresent: Boolean(r.npi?.trim()),
      caqhIdPresent: Boolean(r.caqh_id?.trim()),
      caqhLastAttestedDate: r.caqh_last_attested_date,
      dobPresent: Boolean(r.date_of_birth),
      ssnLast4Present: Boolean(r.ssn_last4?.trim()),
    }),
  );

  const contracts: GroupContractInput[] = (
    (contractsRes.data ?? []) as Array<{
      group_id: string | null;
      payer_id: string | null;
      state: string;
      contracting_status_id: string | null;
    }>
  ).map((c) => ({
    groupId: c.group_id,
    payerId: c.payer_id,
    state: c.state,
    statusLabel: c.contracting_status_id ? (labelById.get(c.contracting_status_id) ?? null) : null,
  }));

  // ONE readiness evaluation pass (TE-5), reduced to open-gap labels and joined
  // to queue entries by the 4-part key inside the pure module.
  const readiness: QueueReadinessInput[] = evaluateEnrollmentReadiness({
    today,
    targets: (
      (targetsRes.data ?? []) as Array<{
        group_id: string;
        payer_id: string;
        state: string;
        status: "active" | "archived";
      }>
    ).map((t) => ({ groupId: t.group_id, payerId: t.payer_id, state: t.state, status: t.status })),
    groupAssignments: (
      (groupAssignmentsRes.data ?? []) as Array<{
        provider_id: string | null;
        group_id: string | null;
        end_date: string | null;
      }>
    ).map((a) => ({ providerId: a.provider_id, groupId: a.group_id, endDate: a.end_date })),
    providers: facts,
    licenses: (
      (licensesRes.data ?? []) as Array<{
        provider_id: string | null;
        state: string;
        expiration_date: string | null;
        verified_status: string | null;
      }>
    ).map((l) => ({
      providerId: l.provider_id,
      state: l.state,
      expirationDate: l.expiration_date,
      verifiedStatus: (l.verified_status ?? "unverified") as "unverified" | "verified" | "failed",
    })),
    facilities: (
      (facilitiesRes.data ?? []) as Array<{
        group_id: string | null;
        state: string | null;
        is_active: boolean | null;
      }>
    ).map((f) => ({ groupId: f.group_id, state: f.state, isActive: f.is_active ?? true })),
    groupDocuments: currentGroupReadinessDocuments(
      (
        (documentsRes.data ?? []) as Array<{
          id: string;
          group_id: string | null;
          doc_type: string;
          expiration_date: string | null;
          document_family_id: string;
          version_number: number;
          supersedes_document_id: string | null;
        }>
      ).map((d) => ({
        id: d.id,
        groupId: d.group_id,
        docType: d.doc_type,
        expirationDate: d.expiration_date,
        documentFamilyId: d.document_family_id,
        versionNumber: d.version_number,
        supersedesDocumentId: d.supersedes_document_id,
      })),
    ),
    groupInsurancePolicies: (
      (insuranceRes.data ?? []) as Array<{ group_id: string; policy_end_date: string | null }>
    ).map((p) => ({ groupId: p.group_id, policyEndDate: p.policy_end_date })),
    contracts,
  }).map((row) => ({
    providerId: row.providerId,
    groupId: row.groupId,
    payerId: row.payerId,
    state: row.state,
    openGapLabels: row.checks.filter((c) => !c.pass).map((c) => c.label),
  }));

  const touches: QueueTouchInput[] = ((touchesRes.data ?? []) as TouchRow[]).map((t) => ({
    caseId: t.case_id,
    entryType: t.entry_type,
    touchDate: t.touch_date,
    nextFollowUpDate: t.next_follow_up_date,
    createdAt: t.created_at,
    id: t.id,
    clearsFollowUp: t.clears_follow_up ?? false,
  }));

  const entries = buildNextBestActions({
    today,
    cases: ((casesRes.data ?? []) as CaseRow[]).map((c) => ({
      id: c.id,
      providerId: c.provider_id,
      groupId: c.group_id,
      payerId: c.payer_id,
      state: c.state,
      credentialingStatusId: c.credentialing_status_id,
      facilityId: c.facility_id,
      generationRunId: c.generation_run_id,
      payerPipelineState: (c.payer_pipeline_state ?? undefined) as PayerPipelineState | undefined,
      caseStatus: isCaseStatus(c.case_status) ? c.case_status : undefined,
      createdAt: c.created_at,
    })),
    statusConfigs: statusRows.map((s) => ({ id: s.id, actionBucket: s.action_bucket })),
    tasks: ((tasksRes.data ?? []) as TaskRow[]).map((t) => ({
      caseId: t.case_id,
      title: t.title,
      status: t.status,
      sortOrder: t.sort_order,
      dueDate: t.due_date,
      cadenceDays: minStepCadence(t.sop_content),
    })),
    touches,
    providers: ((providersRes.data ?? []) as ProviderRow[]).map((p) => ({
      id: p.id,
      name: `${p.first_name} ${p.last_name}`.trim(),
      startDate: p.start_date,
    })),
    facilityAssignments: (
      (assignmentsRes.data ?? []) as Array<{
        provider_id: string | null;
        facility_id: string | null;
        start_date: string | null;
      }>
    ).map((a) => ({
      providerId: a.provider_id,
      facilityId: a.facility_id,
      startDate: a.start_date,
    })),
    facilities: (
      (facilitiesRes.data ?? []) as Array<{
        id: string;
        name: string;
        effective_date: string | null;
      }>
    ).map((f) => ({ id: f.id, name: f.name, effectiveDate: f.effective_date })),
    groups: ((groupsRes.data ?? []) as Array<{ id: string; name: string }>).map((g) => ({
      id: g.id,
      name: g.name,
    })),
    payers: ((payersRes.data ?? []) as Array<{ id: string; name: string }>).map((p) => ({
      id: p.id,
      name: p.name,
    })),
    readiness,
  });

  const items = entries.slice(0, limit).map((entry): NextBestActionItem => ({
    caseId: entry.caseId,
    providerId: entry.providerId,
    providerName: entry.providerName,
    payerName: entry.payerName,
    groupName: entry.groupName,
    state: entry.state,
    actionKind: entry.actionKind,
    action: entry.action,
    reason: entry.reason,
    deadline: entry.deadline,
    payerPipelineState: entry.payerPipelineState,
    deepLink: `/cases/${entry.caseId}`,
  }));
  // `item` stays the queue TOP so the pre-S3.3 consumer is bit-for-bit
  // unchanged; `items` is the same ranking, just not truncated to one.
  return { item: items[0] ?? null, items };
}
