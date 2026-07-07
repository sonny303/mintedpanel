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
import { requireActiveOrg, writeAudit, type AuditInput } from "@/lib/audit";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { Provider, ProviderStatus } from "@/types";

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
}

// The list projection is PHI-safe by construction: no ssn_last4, date_of_birth,
// or home-address columns (home_street/home_city/home_zip) are ever selected
// here. home_state is deliberately included — it drives MSO routing and display,
// not an address. specialty and email ride along for MSO routing resolution and
// SOP tokens in the launch case-kickoff flow, which works off this list projection.
const PROVIDER_LIST_COLUMNS =
  "id, first_name, last_name, credentials, npi, home_state, caqh_id, caqh_last_attested_date, taxonomy_code, status, group_id, specialty, email, reference_only, updated_at";

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
  const payload = { ...snakeizeRow<Record<string, unknown>>(clean), org_id: ctx.orgId };
  const { data, error } = await ctx.db
    .from("providers")
    .insert(payload as unknown as ProviderInsert)
    .select("*")
    .single();
  if (error) throw error;
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
  const { data, error } = await ctx.db
    .from("providers")
    .update(payload as unknown as ProviderUpdate)
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .select("*")
    .single();
  if (error) throw error;
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
}

export interface UpdateProviderWithLicensesInput {
  patch: Partial<ProviderInput>;
  licenses: LicenseInput[];
}

export interface CreateProviderWithDetailsInput {
  provider: ProviderInput;
  licenses: LicenseInput[];
  facilityIds: string[];
}

export interface CreateProviderWithDetailsResult {
  provider: Provider;
  warnings: string[];
}

export async function createProviderWithDetails(
  input: CreateProviderWithDetailsInput,
): Promise<CreateProviderWithDetailsResult> {
  const orgId = requireActiveOrg();
  const payload = { ...snakeizeRow<Record<string, unknown>>(input.provider), org_id: orgId };
  const { data, error } = await supabase
    .from("providers")
    .insert(payload as unknown as ProviderInsert)
    .select("*")
    .single();
  if (error) throw error;
  const created = camelizeRow<Provider>(data);

  const warnings: string[] = [];

  const licenseRows: StateLicenseInsert[] = input.licenses
    .filter((l) => l.state && l.state.trim().length > 0)
    .map((l) => ({
      org_id: orgId,
      provider_id: created.id,
      state: l.state,
      license_number: l.licenseNumber,
      license_type: l.licenseType,
      issue_date: l.issueDate,
      expiration_date: l.expirationDate,
      status: "active",
    }));

  let insertedLicenses: StateLicenseInsert[] = [];
  if (licenseRows.length > 0) {
    const { error: licErr } = await supabase.from("state_licenses").insert(licenseRows);
    if (licErr) {
      warnings.push(`Licenses not saved: ${licErr.message}`);
    } else {
      insertedLicenses = licenseRows;
    }
  }

  const facilityRows = input.facilityIds
    .filter((id) => id)
    .map((facilityId) => ({
      org_id: orgId,
      provider_id: created.id,
      facility_id: facilityId,
    }));

  let insertedFacilityIds: string[] = [];
  if (facilityRows.length > 0) {
    const { error: facErr } = await supabase
      .from("provider_facility_assignments")
      .insert(facilityRows);
    if (facErr) {
      warnings.push(`Facility assignments not saved: ${facErr.message}`);
    } else {
      insertedFacilityIds = facilityRows.map((f) => f.facility_id);
    }
  }

  await writeAudit({
    actionType: "CREATE",
    entityType: "provider",
    entityId: created.id,
    after: {
      provider: created,
      licenses: insertedLicenses,
      facilityIds: insertedFacilityIds,
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
  }>;

  const payload = snakeizeRow<Record<string, unknown>>(input.patch);
  const { data, error } = await supabase
    .from("providers")
    .update(payload as unknown as ProviderUpdate)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("*")
    .single();
  if (error) throw error;
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

  for (const l of cleanLicenses) {
    const row: StateLicenseInsert = {
      org_id: orgId,
      provider_id: id,
      state: l.state || "",
      license_number: l.licenseNumber,
      license_type: l.licenseType,
      issue_date: l.issueDate,
      expiration_date: l.expirationDate,
    };
    let match: { id: string } | undefined;
    if (l.id && existingById.has(l.id) && !matchedIds.has(l.id)) {
      match = existingById.get(l.id);
    } else {
      const key = naturalKey(l.state, l.licenseNumber);
      const cand = existingByNatural.get(key);
      if (cand && !matchedIds.has(cand.id)) match = cand;
    }
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

  // Update matched rows.
  for (const { id: licId, row } of toUpdate) {
    const { error: updErr } = await supabase
      .from("state_licenses")
      .update({
        state: row.state,
        license_number: row.license_number,
        license_type: row.license_type,
        issue_date: row.issue_date,
        expiration_date: row.expiration_date,
      })
      .eq("id", licId)
      .eq("org_id", orgId)
      .eq("provider_id", id);
    if (updErr) throw updErr;
  }

  // Insert new rows.
  if (toInsert.length > 0) {
    const { error: insErr } = await supabase.from("state_licenses").insert(toInsert);
    if (insErr) throw insErr;
  }

  await writeAudit({
    actionType: "UPDATE",
    entityType: "provider",
    entityId: id,
    before: { provider: before, licenses: existing },
    after: {
      provider: after,
      licenses: cleanLicenses,
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
