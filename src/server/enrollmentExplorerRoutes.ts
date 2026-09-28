import type { UserContext } from "./guard";
import type {
  EnrollmentEvidenceKind,
  EnrollmentExplorerAudience,
  EnrollmentReportCsvRecord,
  EnrollmentReportDiscipline,
  EnrollmentReportFilters,
  EnrollmentReportPage,
  EnrollmentScopeHistoryClientItem,
  EnrollmentScopeHistoryPage,
  EnrollmentProofField,
  EnrollmentScopeSaveInput,
} from "@/types";
import {
  EnrollmentExplorerRpcError,
  curateEnrollmentProduct,
  downloadEnrollmentProof,
  getEnrollmentCatalog,
  getEnrollmentReportSnapshot,
  getEnrollmentProofCaptureTarget,
  getEnrollmentScopeHistoryPage,
  getEnrollmentScopeDetail,
  getEnrollmentUnresolvedPage,
  publishEnrollmentProof,
  publishEnrollmentSummary,
  readStoredProviderDocument,
  revokeEnrollmentPublication,
  saveEnrollmentRevision,
  setEnrollmentProductTarget,
  sha256DocumentBlob,
  type EnrollmentExplorerContext,
  type EnrollmentReportSnapshotRpc,
} from "@/services/enrollmentExplorer";
import { serializeEnrollmentReportCsv } from "@/lib/enrollmentReportCsv";
import { providerDisciplineForTaxonomy } from "@/lib/providerDiscipline";
import {
  createEnrollmentReportCursor,
  createEnrollmentReportViewToken,
  verifyEnrollmentReportCursor,
  verifyEnrollmentReportViewToken,
  type EnrollmentReportCursorKey,
  type EnrollmentReportTokenContext,
} from "./enrollmentReportToken";
import { fail, ok } from "./envelope";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVIDENCE_KINDS = new Set<EnrollmentEvidenceKind>([
  "payer_approval_letter",
  "payer_roster_confirmation",
  "payer_acknowledgement",
  "license_psv",
]);
const PROOF_FIELDS = new Set<EnrollmentProofField>([
  "enrollment_status",
  "payer_reference",
  "approved_date",
  "effective_date",
  "termination_date",
  "facility_id",
  "product_id",
  "retro_status",
  "retro_days",
  "retro_date",
  "submitted_date",
  "payer_acknowledged_date",
  "license_current",
]);
const REPORT_DISCIPLINES = new Set<EnrollmentReportDiscipline>([
  "PT",
  "PTA",
  "OT",
  "OTA",
  "SLP",
  "Other",
  "Unknown",
]);
const REPORT_STATUSES = new Set([
  "not_started",
  "in_progress",
  "submitted",
  "in_review",
  "action_required",
  "approved",
  "denied",
  "not_pursuing",
  "terminated",
  "needs_verification",
]);
const PROVIDER_STATUSES = new Set(["onboarding", "active", "terminated"]);
const PROVIDER_VERIFICATION_STATES = new Set(["verified", "pending_verification"]);
const PUBLICATION_STATES = new Set(["published", "stale", "retracted", "superseded", "draft"]);
const CELL_STATES = new Set(["published", "needs_verification", "staff_draft"]);
const HISTORY_PUBLICATION_STATES = new Set(["published", "retracted", "superseded"]);
const HISTORY_PUBLICATION_EVENT_STATES = new Set(["published", "revoked", "superseded", "expired"]);
const ENROLLMENT_REVISION_ALIASES = {
  status: "status",
  intakeDate: "intake_date",
  completeToSubmitDate: "complete_to_submit_date",
  submittedDate: "submitted_date",
  payerAcknowledgedDate: "payer_acknowledged_date",
  approvedDate: "approved_date",
  effectiveDate: "effective_date",
  terminationDate: "termination_date",
  payerReference: "payer_reference",
  clientSafeBlocker: "client_safe_blocker",
  owner: "action_owner",
  retroStatus: "retro_status",
  retroDays: "retro_days",
  retroDate: "retro_date",
  retroBasis: "retro_basis",
  staffNote: "staff_note",
  observedAt: "observed_at",
} as const;
const FORGED_KEYS = new Set([
  "actorUserId",
  "actorId",
  "userId",
  "orgId",
  "audience",
  "contextRevision",
  "selectedOrgId",
  "actor_user_id",
  "p_actor_user_id",
  "p_org_id",
  "p_audience",
  "context_revision",
  "auth_user_id",
]);

export function isEnrollmentExplorerPath(pathname: string): boolean {
  return (
    pathname === "/api/enrollment-explorer" || pathname.startsWith("/api/enrollment-explorer/")
  );
}

function noStore(response: Response): Response {
  response.headers.set("cache-control", "no-store, max-age=0");
  response.headers.set("pragma", "no-cache");
  return response;
}

function bad(message: string, status = 422): Response {
  return noStore(fail(status, message));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasForgedIdentity(value: unknown, depth = 0): boolean {
  if (depth > 8) return true;
  if (Array.isArray(value)) return value.some((item) => hasForgedIdentity(item, depth + 1));
  if (!isObject(value)) return false;
  return Object.entries(value).some(([key, nested]) => {
    const normalized = key.replace(/[_-]/g, "").toLowerCase();
    const forged = [...FORGED_KEYS].some(
      (candidate) => candidate.replace(/[_-]/g, "").toLowerCase() === normalized,
    );
    return forged || hasForgedIdentity(nested, depth + 1);
  });
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function oneQueryValue(params: URLSearchParams, key: string): string | null | undefined {
  const values = params.getAll(key);
  if (values.length > 1) return undefined;
  return values[0] ?? null;
}

function parseReportFilters(
  params: URLSearchParams,
): { filters: EnrollmentReportFilters; cursor: string | null; viewToken: string | null } | null {
  const raw: Record<string, string | null | undefined> = {};
  for (const key of [
    "groupId",
    "state",
    "facilityId",
    "productId",
    "discipline",
    "status",
    "search",
    "historical",
    "cursor",
    "viewToken",
  ]) {
    raw[key] = oneQueryValue(params, key);
    if (raw[key] === undefined) return null;
  }
  const filters: EnrollmentReportFilters = {};
  for (const key of ["groupId", "facilityId", "productId"] as const) {
    const value = raw[key];
    if (value == null || value === "") continue;
    if (!uuid(value)) return null;
    filters[key] = value.toLowerCase();
  }
  if (raw.state != null && raw.state !== "") {
    if (!/^[A-Za-z]{2}$/.test(raw.state)) return null;
    filters.state = raw.state.toUpperCase();
  }
  if (raw.discipline != null && raw.discipline !== "") {
    if (!REPORT_DISCIPLINES.has(raw.discipline as EnrollmentReportDiscipline)) return null;
    filters.discipline = raw.discipline as EnrollmentReportDiscipline;
  }
  if (raw.status != null && raw.status !== "") {
    if (!REPORT_STATUSES.has(raw.status)) return null;
    filters.status = raw.status as EnrollmentReportFilters["status"];
  }
  if (raw.search != null && raw.search !== "") {
    const search = raw.search.trim();
    if (!search || search.length > 120 || /[\u0000-\u001f\u007f]/.test(search)) return null;
    filters.search = search;
  }
  if (raw.historical != null) {
    if (raw.historical !== "true" && raw.historical !== "false") return null;
    filters.historical = raw.historical === "true";
  }
  if (raw.cursor && raw.cursor.length > 2048) return null;
  if (raw.viewToken && raw.viewToken.length > 2048) return null;
  return {
    filters,
    cursor: raw.cursor || null,
    viewToken: raw.viewToken || null,
  };
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Report response is missing ${field}`);
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value == null) return null;
  return string(value, field);
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Report response is missing ${field}`);
  }
  return value as string[];
}

function objectArray(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((item) => !isObject(item))) {
    throw new Error(`Report response is missing ${field}`);
  }
  return value as Record<string, unknown>[];
}

function projectReportSections(value: unknown): EnrollmentReportPage["sections"] {
  return objectArray(value, "sections").map((section) => ({
    key: string(section.key, "section.key"),
    groupId: string(section.groupId, "section.groupId"),
    groupLabel: string(section.groupLabel, "section.groupLabel"),
    state: string(section.state, "section.state"),
    columns: objectArray(section.columns, "section.columns").map((column) => ({
      key: string(column.key, "column.key"),
      productId: string(column.productId, "column.productId"),
      payerLabel: string(column.payerLabel, "column.payerLabel"),
      productLabel: string(column.productLabel, "column.productLabel"),
    })),
  }));
}

function projectReportFilterChoices(value: unknown): EnrollmentReportPage["filterChoices"] {
  if (!isObject(value)) throw new Error("Report response is missing filter choices");
  const groups = objectArray(value.groups, "filterChoices.groups").map((group) => ({
    id: string(group.id, "filterChoices.group.id"),
    label: string(group.label, "filterChoices.group.label"),
  }));
  const facilities = objectArray(value.facilities, "filterChoices.facilities").map((facility) => ({
    id: string(facility.id, "filterChoices.facility.id"),
    label: string(facility.label, "filterChoices.facility.label"),
    groupId: string(facility.groupId, "filterChoices.facility.groupId"),
    state: string(facility.state, "filterChoices.facility.state"),
  }));
  const products = objectArray(value.products, "filterChoices.products").map((product) => ({
    id: string(product.id, "filterChoices.product.id"),
    payerLabel: string(product.payerLabel, "filterChoices.product.payerLabel"),
    label: string(product.label, "filterChoices.product.label"),
  }));
  const disciplines = stringArray(value.disciplines, "filterChoices.disciplines").filter(
    (discipline): discipline is EnrollmentReportDiscipline =>
      REPORT_DISCIPLINES.has(discipline as EnrollmentReportDiscipline),
  );
  const statuses = stringArray(value.statuses, "filterChoices.statuses").filter((status) =>
    REPORT_STATUSES.has(status),
  ) as EnrollmentReportPage["filterChoices"]["statuses"];
  return {
    groups,
    states: stringArray(value.states, "filterChoices.states"),
    facilities,
    products,
    disciplines,
    statuses,
  };
}

function projectReportProviders(value: unknown): EnrollmentReportPage["providers"] {
  return objectArray(value, "providers").map((provider) => {
    const providerStatus = string(provider.status, "provider.status");
    const verificationState = string(provider.verificationState, "provider.verificationState");
    if (
      !PROVIDER_STATUSES.has(providerStatus) ||
      !PROVIDER_VERIFICATION_STATES.has(verificationState)
    ) {
      throw new Error("Report response contains an invalid provider state");
    }
    if (typeof provider.referenceOnly !== "boolean") {
      throw new Error("Report response contains an invalid reference flag");
    }
    const cells = objectArray(provider.cells, "provider.cells").map((cell) => {
      const cellState = string(cell.state, "cell.state");
      if (!CELL_STATES.has(cellState))
        throw new Error("Report response contains an invalid cell state");
      const locations = objectArray(cell.locations, "cell.locations").map((location) => {
        const publicationState = string(location.publicationState, "location.publicationState");
        const status = string(location.status, "location.status");
        if (!PUBLICATION_STATES.has(publicationState) || !REPORT_STATUSES.has(status)) {
          throw new Error("Report response contains an invalid location state");
        }
        if (typeof location.historical !== "boolean") {
          throw new Error("Report response contains an invalid history flag");
        }
        return {
          sectionKey: string(location.sectionKey, "location.sectionKey"),
          scopeId: string(location.scopeId, "location.scopeId"),
          facilityId: string(location.facilityId, "location.facilityId"),
          facilityLabel: string(location.facilityLabel, "location.facilityLabel"),
          publicationState:
            publicationState as EnrollmentReportPage["providers"][number]["cells"][number]["locations"][number]["publicationState"],
          historical: location.historical,
          status:
            status as EnrollmentReportPage["providers"][number]["cells"][number]["locations"][number]["status"],
        };
      });
      const locationCount = cell.locationCount;
      if (!Number.isInteger(locationCount) || locationCount !== locations.length) {
        throw new Error("Report response contains an invalid location count");
      }
      return {
        key: string(cell.key, "cell.key"),
        sectionKey: string(cell.sectionKey, "cell.sectionKey"),
        productId: string(cell.productId, "cell.productId"),
        state: cellState as EnrollmentReportPage["providers"][number]["cells"][number]["state"],
        locationCount,
        locations,
      };
    });
    return {
      providerId: string(provider.providerId, "provider.providerId"),
      name: string(provider.name, "provider.name"),
      npi: nullableString(provider.npi, "provider.npi"),
      discipline: providerDisciplineForTaxonomy(
        nullableString(provider.taxonomyCode, "provider.taxonomyCode"),
      ),
      status: providerStatus as EnrollmentReportPage["providers"][number]["status"],
      referenceOnly: provider.referenceOnly,
      verificationState:
        verificationState as EnrollmentReportPage["providers"][number]["verificationState"],
      sectionKeys: stringArray(provider.sectionKeys, "provider.sectionKeys"),
      cells,
    };
  });
}

function tokenContext(
  user: UserContext,
  context: { orgId: string; audience: EnrollmentExplorerAudience; contextRevision?: string },
  filters: EnrollmentReportFilters,
): EnrollmentReportTokenContext {
  if (!context.contextRevision)
    throw new EnrollmentExplorerRpcError("Access context changed; retry the request", "40001");
  return {
    actorUserId: user.userId,
    orgId: context.orgId,
    audience: context.audience,
    contextRevision: context.contextRevision,
    filters,
  };
}

function reportSnapshotStale(): Response {
  return bad("report_snapshot_stale", 409);
}

function requestedOrgMatches(url: URL, orgId: string): true | Response {
  const org = oneQueryValue(url.searchParams, "org");
  const orgIdParam = oneQueryValue(url.searchParams, "orgId");
  if (org === undefined || orgIdParam === undefined) return bad("org must appear once");
  if ((org && org !== orgId) || (orgIdParam && orgIdParam !== orgId)) {
    return bad("Selected organization does not match the verified request", 403);
  }
  return true;
}

function reportNextCursor(snapshot: EnrollmentReportSnapshotRpc, viewToken: string): string | null {
  if (!snapshot.hasMore) return null;
  if (!isObject(snapshot.nextCursorKey))
    throw new Error("Report response is missing the next cursor key");
  const key: EnrollmentReportCursorKey = {
    lastName: string(snapshot.nextCursorKey.lastName, "nextCursorKey.lastName"),
    firstName: string(snapshot.nextCursorKey.firstName, "nextCursorKey.firstName"),
    providerId: string(snapshot.nextCursorKey.providerId, "nextCursorKey.providerId"),
  };
  return createEnrollmentReportCursor(viewToken, key);
}

function projectHistoryRevision(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new Error("History response contains an invalid revision");
  return Object.fromEntries(
    Object.entries(ENROLLMENT_REVISION_ALIASES)
      .filter(([camel, snake]) => camel in value || snake in value)
      .map(([camel, snake]) => [camel, value[camel] ?? value[snake]]),
  );
}

const CLIENT_HISTORY_FIELDS = [
  "scopeId",
  "orgId",
  "providerId",
  "groupId",
  "payerProductId",
  "facilityId",
  "state",
  "status",
  "historicalStatus",
  "clientSafeBlocker",
  "owner",
  "reviewedAt",
  "cycleNo",
  "revisionNo",
  "intakeDate",
  "completeToSubmitDate",
  "submittedDate",
  "payerAcknowledgedDate",
  "approvedDate",
  "effectiveDate",
  "terminationDate",
  "payerReference",
  "retroStatus",
  "retroDays",
  "retroDate",
  "retroBasis",
] as const;

function projectClientHistoryItem(value: unknown): EnrollmentScopeHistoryClientItem {
  if (!isObject(value) || !Array.isArray(value.proofs)) {
    throw new Error("History response contains an invalid client item");
  }
  const item = Object.fromEntries(
    CLIENT_HISTORY_FIELDS.filter((key) => key in value).map((key) => [key, value[key]]),
  );
  item.proofs = objectArray(value.proofs, "history.proofs").map((proof) => {
    const evidenceKind = string(proof.evidenceKind, "history.proof.evidenceKind");
    const supportedFields = stringArray(proof.supportedFields, "history.proof.supportedFields");
    if (
      !EVIDENCE_KINDS.has(evidenceKind as EnrollmentEvidenceKind) ||
      supportedFields.some((field) => !PROOF_FIELDS.has(field as EnrollmentProofField))
    ) {
      throw new Error("History response contains an invalid proof projection");
    }
    return {
      publicationId: string(proof.publicationId, "history.proof.publicationId"),
      evidenceKind,
      supportedFields,
      publishedAt: string(proof.publishedAt, "history.proof.publishedAt"),
    };
  });
  const publicationState = string(value.publicationState, "history.publicationState");
  const status = string(value.status, "history.status");
  if (
    !HISTORY_PUBLICATION_STATES.has(publicationState) ||
    value.historical !== true ||
    !REPORT_STATUSES.has(status)
  ) {
    throw new Error("History response contains an invalid client history state");
  }
  return {
    ...(item as unknown as EnrollmentScopeHistoryClientItem),
    historical: true,
    publicationState: publicationState as EnrollmentScopeHistoryClientItem["publicationState"],
    publishedAt: string(value.publishedAt, "history.publishedAt"),
  };
}

function projectStaffHistoryItem(value: unknown): Record<string, unknown> {
  if (!isObject(value) || !Array.isArray(value.sources) || !Array.isArray(value.publications)) {
    throw new Error("History response contains an invalid staff item");
  }
  return {
    revisionId: string(value.revisionId, "history.revisionId"),
    cycleNo: value.cycleNo,
    revisionNo: value.revisionNo,
    createdAt: string(value.createdAt, "history.createdAt"),
    status: string(value.status, "history.status"),
    revision: projectHistoryRevision(value.revision),
    sources: objectArray(value.sources, "history.sources").map((source) => ({
      sourceKind: string(source.sourceKind, "history.source.sourceKind"),
      sourceId: string(source.sourceId, "history.source.sourceId"),
      sourceFingerprint: string(source.sourceFingerprint, "history.source.sourceFingerprint"),
      sourceSnapshot: isObject(source.sourceSnapshot) ? source.sourceSnapshot : {},
    })),
    publications: objectArray(value.publications, "history.publications").map((publication) => {
      const state = string(publication.state, "history.publication.state");
      if (!HISTORY_PUBLICATION_EVENT_STATES.has(state)) {
        throw new Error("History response contains an invalid publication state");
      }
      return {
        publicationId: string(publication.publicationId, "history.publication.id"),
        kind: string(publication.kind, "history.publication.kind"),
        state,
        publishedAt: string(publication.publishedAt, "history.publication.publishedAt"),
        ...(typeof publication.evidenceKind === "string"
          ? { evidenceKind: publication.evidenceKind }
          : {}),
        ...(Array.isArray(publication.supportedFields)
          ? {
              supportedFields: stringArray(
                publication.supportedFields,
                "history.publication.supportedFields",
              ),
            }
          : {}),
      };
    }),
  };
}

function decodeHistoryCursor(value: string | null): unknown | null {
  if (!value) return null;
  if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new EnrollmentExplorerRpcError("Enrollment request is invalid", "22023");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new EnrollmentExplorerRpcError("Enrollment request is invalid", "22023");
  }
  if (!isObject(decoded))
    throw new EnrollmentExplorerRpcError("Enrollment request is invalid", "22023");
  return decoded;
}

function projectCsvRecord(value: unknown): EnrollmentReportCsvRecord {
  if (!isObject(value)) throw new Error("Report export returned an invalid record");
  const status = string(value.status, "record.status");
  const publicationState = string(value.publicationState, "record.publicationState");
  if (!REPORT_STATUSES.has(status) || !PUBLICATION_STATES.has(publicationState)) {
    throw new Error("Report export returned an invalid record state");
  }
  const retroType = value.retroType == null ? null : string(value.retroType, "record.retroType");
  if (retroType != null && !["unknown", "not_supported", "documented"].includes(retroType)) {
    throw new Error("Report export returned an invalid retro status");
  }
  const owner = value.owner == null ? null : string(value.owner, "record.owner");
  if (owner != null && !["Minted", "Client", "Payer", "Complete", "Unassigned"].includes(owner)) {
    throw new Error("Report export returned an invalid owner");
  }
  if (value.cycleNo != null && !Number.isInteger(value.cycleNo)) {
    throw new Error("Report export returned an invalid cycle number");
  }
  if (value.authenticatedReportUrl !== "/reporting/enrollment-explorer") {
    throw new Error("Report export returned an invalid report URL");
  }
  return {
    providerName: string(value.providerName, "record.providerName"),
    npi: nullableString(value.npi, "record.npi"),
    discipline: providerDisciplineForTaxonomy(
      nullableString(value.taxonomyCode, "record.taxonomyCode"),
    ),
    groupLabel: string(value.groupLabel, "record.groupLabel"),
    payerLabel: string(value.payerLabel, "record.payerLabel"),
    productLabel: string(value.productLabel, "record.productLabel"),
    state: string(value.state, "record.state"),
    facilityLabel: string(value.facilityLabel, "record.facilityLabel"),
    status: status as EnrollmentReportCsvRecord["status"],
    publicationState: publicationState as EnrollmentReportCsvRecord["publicationState"],
    intakeDate: nullableString(value.intakeDate, "record.intakeDate"),
    completeToSubmitDate: nullableString(value.completeToSubmitDate, "record.completeToSubmitDate"),
    submittedDate: nullableString(value.submittedDate, "record.submittedDate"),
    payerAcknowledgedDate: nullableString(
      value.payerAcknowledgedDate,
      "record.payerAcknowledgedDate",
    ),
    approvedDate: nullableString(value.approvedDate, "record.approvedDate"),
    effectiveDate: nullableString(value.effectiveDate, "record.effectiveDate"),
    terminationDate: nullableString(value.terminationDate, "record.terminationDate"),
    cycleNo: (value.cycleNo as number | null | undefined) ?? null,
    payerReference: nullableString(value.payerReference, "record.payerReference"),
    retroType: retroType as EnrollmentReportCsvRecord["retroType"],
    retroValue: nullableString(value.retroValue, "record.retroValue"),
    retroBasis: nullableString(value.retroBasis, "record.retroBasis"),
    clientSafeBlocker: nullableString(value.clientSafeBlocker, "record.clientSafeBlocker"),
    owner: owner as EnrollmentReportCsvRecord["owner"],
    reviewedAsOf: nullableString(value.reviewedAsOf, "record.reviewedAsOf"),
    proofLabel: nullableString(value.proofLabel, "record.proofLabel"),
    proofType: nullableString(
      value.proofType,
      "record.proofType",
    ) as EnrollmentReportCsvRecord["proofType"],
    authenticatedReportUrl: "/reporting/enrollment-explorer",
  };
}

function rpcErrorResponse(error: unknown): Response {
  if (error instanceof EnrollmentExplorerRpcError) {
    switch (error.code) {
      case "42501":
        return bad("You are not authorized for this enrollment data", 403);
      case "P0001":
        return bad(
          error.message === "Verified actor is unavailable"
            ? "Your session is no longer active; sign in again"
            : "Selected enrollment access is no longer available",
          error.message === "Verified actor is unavailable" ? 401 : 403,
        );
      case "40001":
        return bad("Enrollment data changed; reload and retry", 409);
      case "22023":
        return bad("Enrollment request is invalid", 422);
      case "P0002":
        return bad("Enrollment record not found", 404);
      case "23502":
      case "23514":
      case "22P02":
      case "22007":
      case "22008":
        return bad("Enrollment request is invalid", 422);
      default:
        break;
    }
  }
  if (error instanceof EnrollmentExplorerRpcError) {
    const code = error.code ?? "";
    if (code.startsWith("22") || ["23502", "23503", "23505", "23514"].includes(code)) {
      return bad("Enrollment request is invalid", 422);
    }
  }
  const safeCode =
    error instanceof EnrollmentExplorerRpcError && /^[A-Z0-9]{5}$/.test(error.code ?? "")
      ? error.code
      : "unexpected";
  console.error("[enrollment-explorer] internal error", safeCode);
  return bad("Internal server error", 500);
}

function okNoStore(data: unknown, status = 200): Response {
  return noStore(ok(data, null, status));
}

function parseScopeSaveInput(body: unknown): EnrollmentScopeSaveInput | null {
  if (!isObject(body) || hasForgedIdentity(body)) return null;
  if (
    !uuid(body.providerId) ||
    !uuid(body.groupId) ||
    !uuid(body.payerProductId) ||
    !uuid(body.facilityId) ||
    typeof body.state !== "string" ||
    !/^[A-Za-z]{2}$/.test(body.state) ||
    !isObject(body.revision) ||
    typeof body.revision.status !== "string" ||
    !["Minted", "Client", "Payer", "Complete", "Unassigned"].includes(
      String(body.revision.owner ?? ""),
    ) ||
    !["unknown", "not_supported", "documented"].includes(String(body.revision.retroStatus ?? "")) ||
    !Array.isArray(body.sources) ||
    body.sources.length > 100
  ) {
    return null;
  }
  if (body.scopeId != null && !uuid(body.scopeId)) return null;
  if (body.expectedRevisionId != null && !uuid(body.expectedRevisionId)) return null;
  const sources = body.sources;
  if (
    !sources.every(
      (source) =>
        isObject(source) &&
        (source.sourceKind === "case" || source.sourceKind === "fact") &&
        uuid(source.sourceId) &&
        typeof source.sourceFingerprint === "string" &&
        /^[0-9a-f]{64}$/.test(source.sourceFingerprint),
    )
  ) {
    return null;
  }
  return body as unknown as EnrollmentScopeSaveInput;
}

function buildContext(
  user: UserContext,
  context: { orgId: string; audience: EnrollmentExplorerAudience; contextRevision?: string },
): EnrollmentExplorerContext {
  return {
    db: user.db,
    actorUserId: user.userId,
    orgId: context.orgId,
    audience: context.audience,
    contextRevision: context.contextRevision,
  };
}

export async function handleEnrollmentExplorerRequest(
  request: Request,
  user: UserContext,
  context: { orgId: string; audience: EnrollmentExplorerAudience; contextRevision?: string },
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  const method = request.method.toUpperCase();
  const ctx = buildContext(user, context);
  try {
    if (path === "/api/enrollment-explorer/report/page") {
      if (method !== "GET") return bad("Method not allowed", 405);
      const orgCheck = requestedOrgMatches(url, context.orgId);
      if (orgCheck !== true) return orgCheck;
      const input = parseReportFilters(url.searchParams);
      if (!input) return bad("Invalid enrollment report filters");
      if (input.cursor && !input.viewToken) return bad("A report cursor requires its view token");
      const cursorKey = input.cursor
        ? verifyEnrollmentReportCursor(input.cursor, input.viewToken ?? "")
        : null;
      if (input.cursor && !cursorKey) return bad("Invalid enrollment report cursor");
      const snapshot = await getEnrollmentReportSnapshot(ctx, {
        filters: input.filters,
        cursor: cursorKey ? { ...cursorKey } : null,
        mode: "page",
      });
      const binding = tokenContext(user, context, input.filters);
      const viewToken = input.viewToken
        ? input.viewToken
        : createEnrollmentReportViewToken(binding, snapshot.snapshotDigest);
      if (
        input.viewToken &&
        !verifyEnrollmentReportViewToken(input.viewToken, binding, snapshot.snapshotDigest)
      ) {
        return reportSnapshotStale();
      }
      const data: EnrollmentReportPage = {
        contextRevision: context.contextRevision ?? "",
        viewToken,
        accessState: snapshot.accessState,
        filters: input.filters,
        filterChoices: projectReportFilterChoices(snapshot.filterChoices),
        sections: projectReportSections(snapshot.sections),
        providers: projectReportProviders(snapshot.providers),
        nextCursor: reportNextCursor(snapshot, viewToken),
      };
      return okNoStore(data);
    }

    if (path === "/api/enrollment-explorer/report.csv") {
      if (method !== "GET") return bad("Method not allowed", 405);
      const orgCheck = requestedOrgMatches(url, context.orgId);
      if (orgCheck !== true) return orgCheck;
      const input = parseReportFilters(url.searchParams);
      if (!input) return bad("Invalid enrollment report filters");
      if (!input.viewToken || input.cursor)
        return bad("A report export requires a first-page view token");
      const binding = tokenContext(user, context, input.filters);
      const snapshot = await getEnrollmentReportSnapshot(ctx, {
        filters: input.filters,
        cursor: null,
        mode: "export",
      });
      if (!verifyEnrollmentReportViewToken(input.viewToken, binding, snapshot.snapshotDigest)) {
        return reportSnapshotStale();
      }
      if (snapshot.tooLarge || snapshot.rowCount > 100_000) {
        return bad("report_csv_limit_exceeded", 413);
      }
      if (snapshot.rowCount !== snapshot.records.length) {
        throw new Error("Report export row count did not match its complete snapshot");
      }
      const records = snapshot.records.map(projectCsvRecord);
      const serialized = serializeEnrollmentReportCsv(records);
      if (!serialized.ok) return bad("report_csv_limit_exceeded", 413);
      const bytes = new TextEncoder().encode(serialized.csv);

      // This second, fresh RPC re-resolves the actor, audience and grants and
      // recomputes the complete digest after serialization, immediately before
      // the native Response stream is constructed.
      const fresh = await getEnrollmentReportSnapshot(ctx, {
        filters: input.filters,
        cursor: null,
        mode: "page",
      });
      if (
        fresh.snapshotDigest !== snapshot.snapshotDigest ||
        !verifyEnrollmentReportViewToken(input.viewToken, binding, fresh.snapshotDigest)
      ) {
        return reportSnapshotStale();
      }
      let offset = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          const end = Math.min(offset + 64 * 1024, bytes.byteLength);
          controller.enqueue(bytes.subarray(offset, end));
          offset = end;
          if (offset >= bytes.byteLength) controller.close();
        },
      });
      return noStore(
        new Response(body, {
          status: 200,
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": 'attachment; filename="enrollment-report.csv"',
            "x-content-type-options": "nosniff",
          },
        }),
      );
    }

    const history = /^\/api\/enrollment-explorer\/scopes\/([^/]+)\/history$/.exec(path);
    if (history) {
      if (method !== "GET") return bad("Method not allowed", 405);
      if (!uuid(history[1])) return bad("scopeId must be a UUID");
      const rawCursor = oneQueryValue(url.searchParams, "cursor");
      const rawLimit = oneQueryValue(url.searchParams, "limit");
      if (rawCursor === undefined || rawLimit === undefined)
        return bad("History parameters must appear once");
      const limit = rawLimit == null ? 20 : Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
        return bad("limit must be between 1 and 20");
      }
      const page = await getEnrollmentScopeHistoryPage(ctx, {
        scopeId: history[1].toLowerCase(),
        cursor: decodeHistoryCursor(rawCursor),
        limit,
      });
      const items =
        context.audience === "client"
          ? page.items.map(projectClientHistoryItem)
          : page.items.map(projectStaffHistoryItem);
      const data: EnrollmentScopeHistoryPage = {
        audience: context.audience,
        scopeId: history[1].toLowerCase(),
        items: items as EnrollmentScopeHistoryPage["items"],
        nextCursor: page.nextCursor,
      };
      return okNoStore(data);
    }

    if (path === "/api/enrollment-explorer/catalog") {
      if (method !== "GET") return bad("Method not allowed", 405);
      const groupId = url.searchParams.get("groupId");
      if (groupId && !uuid(groupId)) return bad("groupId must be a UUID");
      return okNoStore(await getEnrollmentCatalog(ctx, groupId));
    }

    if (path === "/api/enrollment-explorer/unresolved") {
      if (method !== "GET") return bad("Method not allowed", 405);
      const groupId = url.searchParams.get("groupId");
      if (groupId && !uuid(groupId)) return bad("groupId must be a UUID");
      const rawLimit = url.searchParams.get("limit");
      const limit = rawLimit == null ? 50 : Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return bad("limit must be between 1 and 100");
      }
      let cursor: unknown | null = null;
      const encodedCursor = url.searchParams.get("cursor");
      if (encodedCursor) {
        try {
          cursor = JSON.parse(Buffer.from(encodedCursor, "base64url").toString("utf8"));
        } catch {
          return bad("cursor must be a base64url-encoded JSON value");
        }
      }
      return okNoStore(await getEnrollmentUnresolvedPage(ctx, { groupId, cursor, limit }));
    }

    const detail = /^\/api\/enrollment-explorer\/scopes\/([^/]+)$/.exec(path);
    if (detail && !path.endsWith("/summary")) {
      if (method !== "GET") return bad("Method not allowed", 405);
      if (!uuid(detail[1])) return bad("scopeId must be a UUID");
      return okNoStore(await getEnrollmentScopeDetail(ctx, detail[1]));
    }

    if (path === "/api/enrollment-explorer/products") {
      if (method !== "POST") return bad("Method not allowed", 405);
      const body = await readBody(request);
      if (!isObject(body) || hasForgedIdentity(body)) return bad("Invalid product request");
      if (
        !uuid(body.payerId) ||
        typeof body.productKey !== "string" ||
        typeof body.displayName !== "string" ||
        (body.isActive != null && typeof body.isActive !== "boolean")
      ) {
        return bad("payerId, productKey and displayName are required");
      }
      const result = await curateEnrollmentProduct(ctx, {
        payerId: body.payerId,
        productKey: body.productKey,
        displayName: body.displayName,
        isActive: body.isActive !== false,
      });
      return okNoStore(result, 201);
    }

    if (path === "/api/enrollment-explorer/targets") {
      if (method !== "POST") return bad("Method not allowed", 405);
      const body = await readBody(request);
      if (!isObject(body) || hasForgedIdentity(body)) return bad("Invalid target request");
      if (
        !uuid(body.groupId) ||
        !uuid(body.payerProductId) ||
        typeof body.state !== "string" ||
        (body.isActive != null && typeof body.isActive !== "boolean")
      ) {
        return bad("groupId, payerProductId and state are required");
      }
      return okNoStore(
        await setEnrollmentProductTarget(ctx, {
          groupId: body.groupId,
          payerProductId: body.payerProductId,
          state: body.state,
          isActive: body.isActive !== false,
        }),
        201,
      );
    }

    if (path === "/api/enrollment-explorer/scopes") {
      if (method !== "POST") return bad("Method not allowed", 405);
      const input = parseScopeSaveInput(await readBody(request));
      if (!input) return bad("Invalid enrollment scope revision request");
      return okNoStore(await saveEnrollmentRevision(ctx, input), 201);
    }

    const summary = /^\/api\/enrollment-explorer\/scopes\/([^/]+)\/summary$/.exec(path);
    if (summary) {
      if (method !== "POST") return bad("Method not allowed", 405);
      if (!uuid(summary[1])) return bad("scopeId must be a UUID");
      const body = await readBody(request);
      if (!isObject(body) || hasForgedIdentity(body) || !uuid(body.revisionId)) {
        return bad("revisionId is required");
      }
      return okNoStore(
        await publishEnrollmentSummary(ctx, { scopeId: summary[1], revisionId: body.revisionId }),
        201,
      );
    }

    if (path === "/api/enrollment-explorer/proofs") {
      if (method !== "POST") return bad("Method not allowed", 405);
      const body = await readBody(request);
      if (
        !isObject(body) ||
        hasForgedIdentity(body) ||
        !uuid(body.scopeId) ||
        !uuid(body.revisionId) ||
        !uuid(body.documentVersionId) ||
        typeof body.evidenceKind !== "string" ||
        !EVIDENCE_KINDS.has(body.evidenceKind as EnrollmentEvidenceKind) ||
        !Array.isArray(body.supportedFields) ||
        !body.supportedFields.every(
          (field): field is EnrollmentProofField =>
            typeof field === "string" && PROOF_FIELDS.has(field as EnrollmentProofField),
        ) ||
        typeof body.reason !== "string"
      ) {
        return bad("Invalid proof publication request");
      }
      const proof = {
        scopeId: body.scopeId,
        revisionId: body.revisionId,
        documentVersionId: body.documentVersionId,
      };
      const target = await getEnrollmentProofCaptureTarget(ctx, proof);
      const blob = await readStoredProviderDocument(ctx, target.storagePath);
      const sha256 = await sha256DocumentBlob(blob);
      const result = await publishEnrollmentProof(ctx, {
        ...proof,
        evidenceKind: body.evidenceKind as EnrollmentEvidenceKind,
        supportedFields: body.supportedFields as EnrollmentProofField[],
        reason: body.reason,
        sha256,
      });
      return okNoStore(result, 201);
    }

    const revoke = /^\/api\/enrollment-explorer\/publications\/([^/]+)\/revoke$/.exec(path);
    if (revoke) {
      if (method !== "POST") return bad("Method not allowed", 405);
      if (!uuid(revoke[1])) return bad("publicationId must be a UUID");
      const body = await readBody(request);
      if (!isObject(body) || hasForgedIdentity(body) || typeof body.reason !== "string") {
        return bad("reason is required");
      }
      return okNoStore(
        await revokeEnrollmentPublication(ctx, { publicationId: revoke[1], reason: body.reason }),
      );
    }

    const proofDownload = /^\/api\/enrollment-explorer\/proofs\/([^/]+)\/download$/.exec(path);
    if (proofDownload) {
      if (method !== "GET") return bad("Method not allowed", 405);
      if (!uuid(proofDownload[1])) return bad("publicationId must be a UUID");
      const result = await downloadEnrollmentProof(ctx, proofDownload[1]);
      const safeName = encodeURIComponent(result.fileName.replace(/[\r\n"\\]/g, "_"));
      return noStore(
        new Response(result.blob.stream() as unknown as BodyInit, {
          status: 200,
          headers: {
            "content-type": "application/octet-stream",
            "content-disposition": `attachment; filename*=UTF-8''${safeName}`,
            "x-content-type-options": "nosniff",
          },
        }),
      );
    }

    return bad("Not found", 404);
  } catch (error) {
    return rpcErrorResponse(error);
  }
}
