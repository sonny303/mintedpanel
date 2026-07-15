// Provider CRUD with org filtering and audit logging.
//
// Dependency-injection seam: the four functions the API layer pilots
// (listProviders/getProviders, getProvider, createProvider, updateProvider)
// accept an optional `ProviderServiceCtx`. Browser callers omit it and get the
// auth-store-backed default (client-direct hooks, unchanged). The server API
// routes pass a ctx built from the service-role client and the org resolved from
// the authenticated membership. The query logic itself is written once.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow, snakeizeRow } from "@/lib/case";
import { currentUserId, requireActiveOrg, writeAudit, type AuditInput } from "@/lib/audit";
import { resolvePsvColumns, type PsvStatus, type PsvStored } from "@/lib/licensePsv";
import { planAssignmentSync, type GroupAssignmentInput } from "@/lib/groupAssignments";
import { insertAssignmentRows } from "@/services/providerAssignments";
import { normalizeStateCode, normalizeOptionalStateCode } from "@/lib/stateCode";
import { translateDbError } from "@/lib/dbErrors";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { Provider, ProviderGroupAssignment, ProviderStatus } from "@/types";

type ProviderInsert = Database["public"]["Tables"]["providers"]["Insert"];
type ProviderUpdate = Database["public"]["Tables"]["providers"]["Update"];
type StateLicenseInsert = Database["public"]["Tables"]["state_licenses"]["Insert"];
type TaskInsert = Database["public"]["Tables"]["tasks"]["Insert"];

export interface ProviderFilters {
  groupId?: string;
  state?: string;
  payerId?: string;
  status?: ProviderStatus;
  search?: string;
}

export interface ProviderInput {
  groupId?: string | null;
  launchId?: string | null;
  firstName: string;
  lastName: string;
  credentials?: string | null;
  /** CAQH-required demographic (E1.3); existing baseline column. */
  gender?: string | null;
  email?: string | null;
  phone?: string | null;
  npi?: string | null;
  caqhId?: string | null;
  caqhLastAttestedDate?: string | null;
  deaNumber?: string | null;
  taxonomyCode?: string | null;
  specialty?: string | null;
  startDate?: string | null;
  status?: ProviderStatus;
  isNewGrad?: boolean;
  dateOfBirth?: string | null;
  ssnLast4?: string | null;
  homeStreet?: string | null;
  homeCity?: string | null;
  homeState?: string | null;
  homeZip?: string | null;
  degree?: string | null;
  schoolName?: string | null;
  graduationDate?: string | null;
  malpracticeCarrier?: string | null;
  malpracticePolicyNumber?: string | null;
  malpracticeCoverageStart?: string | null;
  malpracticeCoverageEnd?: string | null;
  // Onboarding-import flag (Epic 2e). Optional; when omitted the column is not
  // written and the DB default (false) applies, so browser callers are
  // unchanged. The CSV import sets it from the per-import toggle. Rides through
  // snakeizeRow → reference_only on insert.
  referenceOnly?: boolean;
  // E4.2 F4.2.7 — designate this provider as the org's dry-run test provider.
  // Optional; omitted → DB default false, so browser callers are unchanged.
  isTestProvider?: boolean;
}

// The list projection is PHI-safe by construction: no ssn_last4, date_of_birth,
// or home-address columns (home_street/home_city/home_zip) are ever selected
// here. home_state is deliberately included — it drives MSO routing and display,
// not an address. specialty and email ride along for MSO routing resolution and
// SOP tokens in the launch case-kickoff flow, which works off this list projection.
const PROVIDER_LIST_COLUMNS =
  "id, first_name, last_name, credentials, npi, home_state, caqh_id, caqh_last_attested_date, taxonomy_code, status, group_id, specialty, email, reference_only, verification_state, is_test_provider, updated_at";

// Per-request context injected by callers. `db` is the Supabase client to use
// (browser anon client under RLS, or the server service-role client), `orgId`
// scopes every query, and `writeAudit` records the mutation.
export interface ProviderServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
  writeAudit: (input: AuditInput) => Promise<void>;
}

// Default context for browser callers: the anon client + active org from the
// auth store + the store-backed audit writer. Evaluated lazily, only when a
// caller omits an explicit ctx.
function browserCtx(): ProviderServiceCtx {
  return { db: supabase, orgId: requireActiveOrg(), writeAudit };
}

export interface ListProvidersOptions {
  // 1-based page; when set, the result is paginated and `total` is an exact count.
  page?: number;
  pageSize?: number;
  sortColumn?: string;
  sortAscending?: boolean;
}

export interface ProviderPage {
  rows: Provider[];
  total: number;
}

const SORTABLE_COLUMNS = new Set(["last_name", "first_name", "created_at", "updated_at", "status"]);

// Single source of the provider list query. Serves both the browser
// (unpaginated) and the API list route (paginated with exact total).
export async function listProviders(
  ctx: ProviderServiceCtx,
  filters: ProviderFilters = {},
  options: ListProvidersOptions = {},
): Promise<ProviderPage> {
  const { db, orgId } = ctx;
  let selectStr = PROVIDER_LIST_COLUMNS;
  if (filters.state) selectStr += ", state_licenses!inner(state, org_id)";
  if (filters.payerId) selectStr += ", credential_cases!inner(payer_id, org_id)";

  const paged = typeof options.page === "number";
  const sortColumn =
    options.sortColumn && SORTABLE_COLUMNS.has(options.sortColumn)
      ? options.sortColumn
      : "last_name";
  const ascending = options.sortAscending ?? true;

  let query = db
    .from("providers")
    .select(selectStr, paged ? { count: "exact" } : {})
    .eq("org_id", orgId)
    .order(sortColumn, { ascending });

  if (filters.groupId) query = query.eq("group_id", filters.groupId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.search) {
    const term = `%${filters.search}%`;
    query = query.or(
      `first_name.ilike.${term},last_name.ilike.${term},npi.ilike.${term},email.ilike.${term}`,
    );
  }
  if (filters.state) {
    query = query.eq("state_licenses.org_id", orgId).eq("state_licenses.state", filters.state);
  }
  if (filters.payerId) {
    query = query
      .eq("credential_cases.org_id", orgId)
      .eq("credential_cases.payer_id", filters.payerId);
  }

  if (paged) {
    const pageSize = Math.min(Math.max(options.pageSize ?? 25, 1), 100);
    const page = Math.max(options.page ?? 1, 1);
    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  const stripped = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
    const { state_licenses: _sl, credential_cases: _cc, ...rest } = row;
    return rest;
  });
  const rows = camelizeRow<Provider[]>(stripped);
  return { rows, total: paged ? (count ?? rows.length) : rows.length };
}

export async function getProviders(
  filters: ProviderFilters = {},
  ctx: ProviderServiceCtx = browserCtx(),
): Promise<Provider[]> {
  const { rows } = await listProviders(ctx, filters);
  return rows;
}

export async function getProvider(
  id: string,
  ctx: ProviderServiceCtx = browserCtx(),
): Promise<Provider | null> {
  const { data, error } = await ctx.db
    .from("providers")
    .select("*")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? camelizeRow<Provider>(data) : null;
}

export async function createProvider(
  input: ProviderInput,
  ctx: ProviderServiceCtx = browserCtx(),
): Promise<Provider> {
  // org_id comes from the context only; never trust a client-supplied org.
  const { orgId: _o1, org_id: _o2, ...clean } = input as unknown as Record<string, unknown>;
  const payload: Record<string, unknown> = {
    ...snakeizeRow<Record<string, unknown>>(clean),
    org_id: ctx.orgId,
  };
  // E0.10: home_state / license_state are DB-checked to ^[A-Z]{2}$ when present.
  if ("homeState" in input) payload.home_state = normalizeOptionalStateCode(input.homeState);
  if ("licenseState" in clean)
    payload.license_state = normalizeOptionalStateCode(clean.licenseState as string | null);
  const { data, error } = await ctx.db
    .from("providers")
    .insert(payload as unknown as ProviderInsert)
    .select("*")
    .single();
  if (error) throw translateDbError(error);
  const created = camelizeRow<Provider>(data);
  await ctx.writeAudit({
    actionType: "CREATE",
    entityType: "provider",
    entityId: created.id,
    after: created,
    description: `Created provider ${created.firstName} ${created.lastName}`,
  });
  return created;
}

export async function updateProvider(
  id: string,
  patch: Partial<ProviderInput>,
  ctx: ProviderServiceCtx = browserCtx(),
): Promise<Provider> {
  const before = await getProvider(id, ctx);
  // Strip any client-supplied org so a write can never move a row across tenants.
  const { orgId: _o1, org_id: _o2, ...clean } = patch as unknown as Record<string, unknown>;
  const payload = snakeizeRow<Record<string, unknown>>(clean);
  if ("homeState" in patch) payload.home_state = normalizeOptionalStateCode(patch.homeState);
  if ("licenseState" in clean)
    payload.license_state = normalizeOptionalStateCode(clean.licenseState as string | null);
  const { data, error } = await ctx.db
    .from("providers")
    .update(payload as unknown as ProviderUpdate)
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .select("*")
    .single();
  if (error) throw translateDbError(error);
  const after = camelizeRow<Provider>(data);
  await ctx.writeAudit({
    actionType: "UPDATE",
    entityType: "provider",
    entityId: id,
    before,
    after,
    description: `Updated provider ${after.firstName} ${after.lastName}`,
  });
  return after;
}

export interface LicenseInput {
  id?: string | null;
  state: string;
  licenseNumber: string | null;
  licenseType: string | null;
  issueDate: string | null;
  expirationDate: string | null;
  // PSV trail (E1.3 F1.3.3). Status/URL come from the form; verified_at and
  // verified_by are stamped by the SERVICE via resolvePsvColumns — never
  // client-supplied. Omitted → treated as unverified (legacy callers).
  verifiedStatus?: PsvStatus;
  verificationSourceUrl?: string | null;
}

export interface UpdateProviderWithLicensesInput {
  patch: Partial<ProviderInput>;
  licenses: LicenseInput[];
  /** E1.3 M:N group assignments; when provided the full set is synced
   * (≥1 required, exactly one primary — invariants enforced in the pure
   * planner) and providers.group_id mirrors the primary. */
  groupAssignments?: GroupAssignmentInput[];
}

export interface CreateProviderWithDetailsInput {
  provider: ProviderInput;
  licenses: LicenseInput[];
  facilityIds: string[];
  /** E1.3 M:N group assignments (wizard path requires ≥1 + one primary). */
  groupAssignments?: GroupAssignmentInput[];
}

export interface CreateProviderWithDetailsResult {
  provider: Provider;
  warnings: string[];
}

export async function createProviderWithDetails(
  input: CreateProviderWithDetailsInput,
): Promise<CreateProviderWithDetailsResult> {
  const orgId = requireActiveOrg();
  // E1.3: validate the assignment set up front (≥1, exactly one primary) and
  // mirror the primary onto providers.group_id (frozen legacy mirror).
  const assignmentPlan = input.groupAssignments
    ? planAssignmentSync(input.groupAssignments, [])
    : null;
  const payload: Record<string, unknown> = {
    ...snakeizeRow<Record<string, unknown>>(input.provider),
    org_id: orgId,
  };
  if ("homeState" in input.provider)
    payload.home_state = normalizeOptionalStateCode(input.provider.homeState);
  if (assignmentPlan) payload.group_id = assignmentPlan.primaryGroupId;
  const { data, error } = await supabase
    .from("providers")
    .insert(payload as unknown as ProviderInsert)
    .select("*")
    .single();
  if (error) throw translateDbError(error);
  const created = camelizeRow<Provider>(data);

  const warnings: string[] = [];
  const nowIso = new Date().toISOString();
  const userId = currentUserId();

  const licenseRows: StateLicenseInsert[] = input.licenses
    .filter((l) => l.state && l.state.trim().length > 0)
    .map((l) => ({
      org_id: orgId,
      provider_id: created.id,
      // E0.10: state_licenses.state is DB-checked to ^[A-Z]{2}$.
      state: normalizeStateCode(l.state),
      license_number: l.licenseNumber,
      license_type: l.licenseType,
      issue_date: l.issueDate,
      expiration_date: l.expirationDate,
      status: "active",
      // PSV columns resolved by the pure rule module (stamps server-side).
      ...resolvePsvColumns(
        {
          verifiedStatus: l.verifiedStatus ?? "unverified",
          verificationSourceUrl: l.verificationSourceUrl ?? null,
          expirationDate: l.expirationDate,
        },
        null,
        nowIso,
        userId,
      ),
    }));

  let insertedLicenses: StateLicenseInsert[] = [];
  if (licenseRows.length > 0) {
    const { error: licErr } = await supabase.from("state_licenses").insert(licenseRows);
    if (licErr) {
      const translated = translateDbError(licErr);
      warnings.push(
        `Licenses not saved: ${translated instanceof Error ? translated.message : licErr.message}`,
      );
    } else {
      insertedLicenses = licenseRows;
    }
  }

  // E1.4 TE-3: assignment writes route through the shared service.
  const facilityIds = input.facilityIds.filter((fid) => fid);
  let insertedFacilityIds: string[] = [];
  if (facilityIds.length > 0) {
    try {
      await insertAssignmentRows(
        facilityIds.map((facilityId) => ({ providerId: created.id, facilityId })),
      );
      insertedFacilityIds = facilityIds;
    } catch (facErr) {
      warnings.push(
        `Facility assignments not saved: ${facErr instanceof Error ? facErr.message : "unknown error"}`,
      );
    }
  }

  // E1.3: the M:N group assignments. A failed write here is NOT a warning —
  // "no provider exists unassigned" is a hard rule, so surface the error.
  let insertedAssignments: GroupAssignmentInput[] = [];
  if (assignmentPlan && assignmentPlan.inserts.length > 0) {
    const { error: gaErr } = await supabase.from("provider_group_assignments").insert(
      assignmentPlan.inserts.map((a) => ({
        org_id: orgId,
        provider_id: created.id,
        group_id: a.groupId,
        is_primary: a.isPrimary,
      })),
    );
    if (gaErr) throw translateDbError(gaErr);
    insertedAssignments = assignmentPlan.inserts;
  }

  await writeAudit({
    actionType: "CREATE",
    entityType: "provider",
    entityId: created.id,
    after: {
      provider: created,
      licenses: insertedLicenses,
      facilityIds: insertedFacilityIds,
      groupAssignments: insertedAssignments,
    },
    description: `Created provider ${created.firstName} ${created.lastName}`,
  });

  return { provider: created, warnings };
}

export async function updateProviderWithLicenses(
  id: string,
  input: UpdateProviderWithLicensesInput,
): Promise<Provider> {
  const orgId = requireActiveOrg();
  const before = await getProvider(id);
  const { data: licsBefore, error: licsBeforeErr } = await supabase
    .from("state_licenses")
    .select("*")
    .eq("org_id", orgId)
    .eq("provider_id", id);
  if (licsBeforeErr) throw licsBeforeErr;
  const existing = (licsBefore ?? []) as Array<{
    id: string;
    state: string | null;
    license_number: string | null;
    expiration_date: string | null;
    verified_status: string | null;
    verified_at: string | null;
    verified_by: string | null;
    verification_source_url: string | null;
  }>;

  // E1.3: plan the group-assignment sync BEFORE any write so an invalid set
  // (empty / no primary) rejects the whole save.
  let assignmentPlan: ReturnType<typeof planAssignmentSync> | null = null;
  let storedAssignments: Array<{ id: string; group_id: string; is_primary: boolean }> = [];
  if (input.groupAssignments) {
    const { data: gaRows, error: gaErr } = await supabase
      .from("provider_group_assignments")
      .select("id, group_id, is_primary")
      .eq("org_id", orgId)
      .eq("provider_id", id);
    if (gaErr) throw gaErr;
    storedAssignments = (gaRows ?? []) as typeof storedAssignments;
    assignmentPlan = planAssignmentSync(
      input.groupAssignments,
      storedAssignments.map((r) => ({ id: r.id, groupId: r.group_id, isPrimary: r.is_primary })),
    );
  }

  const payload = snakeizeRow<Record<string, unknown>>(input.patch);
  if ("homeState" in input.patch)
    payload.home_state = normalizeOptionalStateCode(input.patch.homeState);
  // Frozen legacy mirror: providers.group_id follows the primary assignment.
  if (assignmentPlan) payload.group_id = assignmentPlan.primaryGroupId;
  const { data, error } = await supabase
    .from("providers")
    .update(payload as unknown as ProviderUpdate)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (error) throw translateDbError(error);
  const after = camelizeRow<Provider>(data);

  const cleanLicenses = input.licenses.filter(
    (l) => l.state || l.licenseNumber || l.issueDate || l.expirationDate || l.licenseType,
  );

  // Match incoming rows to existing rows by id, else by (state + licenseNumber).
  const existingById = new Map(existing.map((r) => [r.id, r]));
  const naturalKey = (state: string | null, num: string | null): string =>
    `${(state ?? "").toUpperCase()}::${(num ?? "").trim()}`;
  const existingByNatural = new Map(
    existing.map((r) => [naturalKey(r.state, r.license_number), r]),
  );

  const matchedIds = new Set<string>();
  const toUpdate: Array<{ id: string; row: StateLicenseInsert }> = [];
  const toInsert: StateLicenseInsert[] = [];
  const nowIso = new Date().toISOString();
  const userId = currentUserId();

  const psvStoredOf = (r: (typeof existing)[number]): PsvStored => ({
    verifiedStatus: (r.verified_status ?? "unverified") as PsvStatus,
    verifiedAt: r.verified_at,
    verifiedBy: r.verified_by,
    verificationSourceUrl: r.verification_source_url,
    expirationDate: r.expiration_date,
  });

  for (const l of cleanLicenses) {
    let match: (typeof existing)[number] | undefined;
    if (l.id && existingById.has(l.id) && !matchedIds.has(l.id)) {
      match = existingById.get(l.id);
    } else {
      const key = naturalKey(l.state, l.licenseNumber);
      const cand = existingByNatural.get(key);
      if (cand && !matchedIds.has(cand.id)) match = cand;
    }
    // PSV columns via the pure rule module: URL required to (re)verify,
    // stamps server-side, renewal reset on expiration change (TE-5).
    const psv = resolvePsvColumns(
      {
        verifiedStatus: l.verifiedStatus ?? "unverified",
        verificationSourceUrl: l.verificationSourceUrl ?? null,
        expirationDate: l.expirationDate,
      },
      match ? psvStoredOf(match) : null,
      nowIso,
      userId,
    );
    const row: StateLicenseInsert = {
      org_id: orgId,
      provider_id: id,
      state: normalizeStateCode(l.state || ""),
      license_number: l.licenseNumber,
      license_type: l.licenseType,
      issue_date: l.issueDate,
      expiration_date: l.expirationDate,
      ...psv,
    };
    if (match) {
      matchedIds.add(match.id);
      toUpdate.push({ id: match.id, row });
    } else {
      toInsert.push(row);
    }
  }

  const toDeleteIds = existing.filter((r) => !matchedIds.has(r.id)).map((r) => r.id);

  // Delete removed rows and verify the delete actually removed them.
  if (toDeleteIds.length > 0) {
    const { data: deleted, error: delErr } = await supabase
      .from("state_licenses")
      .delete()
      .eq("org_id", orgId)
      .eq("provider_id", id)
      .in("id", toDeleteIds)
      .select("id");
    if (delErr) throw delErr;
    const removed = new Set(((deleted ?? []) as Array<{ id: string }>).map((r) => r.id));
    const missed = toDeleteIds.filter((did) => !removed.has(did));
    if (missed.length > 0) {
      throw new Error(
        `Failed to remove ${missed.length} license row(s); permissions may have changed.`,
      );
    }
  }

  // Update matched rows (incl. the resolved PSV columns — renewal reset and
  // verification stamps ride the same write).
  for (const { id: licId, row } of toUpdate) {
    const { error: updErr } = await supabase
      .from("state_licenses")
      .update({
        state: row.state,
        license_number: row.license_number,
        license_type: row.license_type,
        issue_date: row.issue_date,
        expiration_date: row.expiration_date,
        verified_status: row.verified_status,
        verified_at: row.verified_at,
        verified_by: row.verified_by,
        verification_source_url: row.verification_source_url,
      })
      .eq("id", licId)
      .eq("org_id", orgId)
      .eq("provider_id", id);
    if (updErr) throw translateDbError(updErr);
  }

  // Insert new rows.
  if (toInsert.length > 0) {
    const { error: insErr } = await supabase.from("state_licenses").insert(toInsert);
    if (insErr) throw translateDbError(insErr);
  }

  // E1.3: execute the assignment sync in index-safe order — demote surviving
  // ex-primaries, delete removed rows, promote the new primary, insert new
  // rows (the partial unique "one primary per provider" can never trip).
  if (assignmentPlan) {
    if (assignmentPlan.demoteIds.length > 0) {
      const { error: gaErr } = await supabase
        .from("provider_group_assignments")
        .update({ is_primary: false })
        .eq("org_id", orgId)
        .eq("provider_id", id)
        .in("id", assignmentPlan.demoteIds);
      if (gaErr) throw translateDbError(gaErr);
    }
    if (assignmentPlan.deleteIds.length > 0) {
      const { error: gaErr } = await supabase
        .from("provider_group_assignments")
        .delete()
        .eq("org_id", orgId)
        .eq("provider_id", id)
        .in("id", assignmentPlan.deleteIds);
      if (gaErr) throw translateDbError(gaErr);
    }
    if (assignmentPlan.promoteId) {
      const { error: gaErr } = await supabase
        .from("provider_group_assignments")
        .update({ is_primary: true })
        .eq("org_id", orgId)
        .eq("provider_id", id)
        .eq("id", assignmentPlan.promoteId);
      if (gaErr) throw translateDbError(gaErr);
    }
    if (assignmentPlan.inserts.length > 0) {
      const { error: gaErr } = await supabase.from("provider_group_assignments").insert(
        assignmentPlan.inserts.map((a) => ({
          org_id: orgId,
          provider_id: id,
          group_id: a.groupId,
          is_primary: a.isPrimary,
        })),
      );
      if (gaErr) throw translateDbError(gaErr);
    }
  }

  await writeAudit({
    actionType: "UPDATE",
    entityType: "provider",
    entityId: id,
    before: {
      provider: before,
      licenses: existing,
      groupAssignments: input.groupAssignments ? storedAssignments : undefined,
    },
    after: {
      provider: after,
      licenses: cleanLicenses,
      groupAssignments: input.groupAssignments,
      diff: {
        updated: toUpdate.length,
        inserted: toInsert.length,
        deleted: toDeleteIds.length,
      },
    },
    description: `Updated provider ${after.firstName} ${after.lastName}`,
  });

  return after;
}

// E1.3: org-scoped read of every provider↔group assignment — the roster list
// and summaries join it client-side. All NEW group reads go through this
// table; providers.group_id stays a frozen legacy mirror.
export async function listProviderGroupAssignments(): Promise<ProviderGroupAssignment[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("provider_group_assignments")
    .select("*")
    .eq("org_id", orgId);
  if (error) throw error;
  return camelizeRow<ProviderGroupAssignment[]>(data ?? []);
}

const TERMINATION_ACTIVE_LABELS = ["active", "approved, pending effective date"];

function buildTerminationSteps(): {
  id: string;
  order: number;
  label: string;
  isCompleted: boolean;
}[] {
  const mkId = (): string =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return [
    { id: mkId(), order: 1, label: "Notify payer of termination date", isCompleted: false },
    { id: mkId(), order: 2, label: "Confirm removal from payer directory", isCompleted: false },
    { id: mkId(), order: 3, label: "Log confirmation in touch log", isCompleted: false },
  ];
}

function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface TerminateProviderInput {
  providerId: string;
  terminationDate: string;
  reason: string | null;
}

export interface TerminateProviderResult {
  provider: Provider;
  tasksCreated: number;
}

export async function terminateProvider(
  input: TerminateProviderInput,
): Promise<TerminateProviderResult> {
  const orgId = requireActiveOrg();
  const before = await getProvider(input.providerId);
  if (!before) throw new Error("Provider not found");

  const { data: statusRows, error: statusErr } = await supabase
    .from("status_configs")
    .select("id, label")
    .eq("org_id", orgId)
    .eq("track", "credentialing");
  if (statusErr) throw statusErr;
  const activeStatusIds = (statusRows ?? [])
    .filter((s) => TERMINATION_ACTIVE_LABELS.includes((s.label as string).toLowerCase()))
    .map((s) => s.id as string);

  let activeCases: { id: string; payer_id: string; state: string }[] = [];
  if (activeStatusIds.length > 0) {
    const { data: caseRows, error: caseErr } = await supabase
      .from("credential_cases")
      .select("id, payer_id, state")
      .eq("org_id", orgId)
      .eq("provider_id", input.providerId)
      .in("credentialing_status_id", activeStatusIds);
    if (caseErr) throw caseErr;
    activeCases = (caseRows ?? []) as typeof activeCases;
  }

  const payerIds = Array.from(new Set(activeCases.map((c) => c.payer_id)));
  const payerNameById = new Map<string, string>();
  if (payerIds.length > 0) {
    const { data: payers, error: payersErr } = await supabase
      .from("payers")
      .select("id, name")
      .eq("org_id", orgId)
      .in("id", payerIds);
    if (payersErr) throw payersErr;
    for (const p of payers ?? []) payerNameById.set(p.id as string, p.name as string);
  }

  const dueDate = addDaysISO(input.terminationDate, 14);
  const taskRows: TaskInsert[] = activeCases.map((cs) => ({
    org_id: orgId,
    case_id: cs.id,
    provider_id: input.providerId,
    title: `Submit termination to ${payerNameById.get(cs.payer_id) ?? "payer"} — ${cs.state}`,
    description: input.reason ?? null,
    sop_content: buildTerminationSteps() as unknown as Json,
    status: "not_started",
    sort_order: 999,
    due_date: dueDate,
    is_auto_generated: true,
  }));

  if (taskRows.length > 0) {
    const { error: insErr } = await supabase.from("tasks").insert(taskRows);
    if (insErr) throw insErr;
  }

  const providerUpdate: ProviderUpdate = {
    status: "terminated",
    terminated_date: input.terminationDate,
  };
  const { data: updated, error: updErr } = await supabase
    .from("providers")
    .update(providerUpdate)
    .eq("id", input.providerId)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (updErr) throw updErr;
  const after = camelizeRow<Provider>(updated);

  await writeAudit({
    actionType: "TERMINATION",
    entityType: "provider",
    entityId: input.providerId,
    before: { status: before.status, terminatedDate: before.terminatedDate },
    after: {
      status: after.status,
      terminatedDate: after.terminatedDate,
      reason: input.reason,
      terminationTasksCreated: taskRows.length,
      affectedCaseIds: activeCases.map((c) => c.id),
    },
    description: `Terminated provider ${after.firstName} ${after.lastName} (${taskRows.length} task${taskRows.length === 1 ? "" : "s"} created)`,
  });

  return { provider: after, tasksCreated: taskRows.length };
}

/* ----------------------- E3.1 — verification fence flip ----------------------- */

/** Explicit verify action (F3.1.4, single or bulk): flips
 * pending_verification providers to verified so they re-enter E1.8 readiness
 * and E2.0 generation candidacy on the next derivation — no re-import, no
 * stored candidacy to refresh. Writer action (specialist/admin — the RLS
 * provider-update posture); already-verified ids are untouched by the state
 * filter, so a replay verifies nothing twice. One audit row per flipped
 * provider. */
export async function verifyProviders(providerIds: string[]): Promise<number> {
  if (providerIds.length === 0) return 0;
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("providers")
    .update({ verification_state: "verified" })
    .eq("org_id", orgId)
    .in("id", providerIds)
    .eq("verification_state", "pending_verification")
    .select("id, first_name, last_name");
  if (error) throw translateDbError(error);
  const rows = camelizeRow<Array<{ id: string; firstName: string; lastName: string }>>(data ?? []);
  for (const row of rows) {
    await writeAudit({
      actionType: "UPDATE",
      entityType: "provider",
      entityId: row.id,
      before: { id: row.id, verificationState: "pending_verification" },
      after: { id: row.id, verificationState: "verified" },
      description: `Provider verified: ${row.firstName} ${row.lastName}`,
    });
  }
  return rows.length;
}
