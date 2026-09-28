import { supabase } from "@/integrations/supabase/externalClient";
import {
  getContextRevisionSnapshot,
  observeContextRevisionForRequest,
} from "@/lib/contextRevision";
import type {
  EnrollmentCatalog,
  EnrollmentEvidenceKind,
  EnrollmentExplorerAudience,
  EnrollmentProofField,
  EnrollmentReportFilters,
  EnrollmentReportPage,
  EnrollmentReportPageRequest,
  EnrollmentScopeDetail,
  EnrollmentScopeHistoryPage,
  EnrollmentScopeSaveInput,
  EnrollmentUnresolvedPage,
} from "@/types";

interface ApiEnvelope<T> {
  data: T | null;
  error: string | null;
}

export interface EnrollmentExplorerRequestContext {
  orgId: string;
  audience: EnrollmentExplorerAudience;
  contextRevision: string;
}

export class EnrollmentExplorerApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "EnrollmentExplorerApiError";
  }
}

async function request<T>(
  context: EnrollmentExplorerRequestContext,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const before = getContextRevisionSnapshot();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new EnrollmentExplorerApiError(401, "Your session has expired. Sign in again.");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("x-org-id", context.orgId);
  headers.set("x-enrollment-audience", context.audience);
  headers.set("x-minted-context-revision", context.contextRevision);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const rejectStale = (init.method ?? "GET").toUpperCase() === "GET";
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  if (observeContextRevisionForRequest(response, before, { rejectStale })) {
    throw new EnrollmentExplorerApiError(409, "Access context changed; retry the request");
  }
  let body: ApiEnvelope<T> | null = null;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    body = null;
  }
  if (observeContextRevisionForRequest(response, before, { rejectStale })) {
    throw new EnrollmentExplorerApiError(409, "Access context changed; retry the request");
  }
  if (!response.ok || !body || body.error) {
    throw new EnrollmentExplorerApiError(
      response.status,
      body?.error ?? "Enrollment request failed",
    );
  }
  return body.data as T;
}

async function download(
  context: EnrollmentExplorerRequestContext,
  path: string,
  signal?: AbortSignal,
  failureMessage = "Enrollment proof download failed",
): Promise<Blob> {
  const before = getContextRevisionSnapshot();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new EnrollmentExplorerApiError(401, "Your session has expired. Sign in again.");
  const response = await fetch(path, {
    cache: "no-store",
    signal,
    headers: {
      authorization: `Bearer ${token}`,
      "x-org-id": context.orgId,
      "x-enrollment-audience": context.audience,
      "x-minted-context-revision": context.contextRevision,
    },
  });
  if (observeContextRevisionForRequest(response, before)) {
    throw new EnrollmentExplorerApiError(409, "Access context changed; retry the request");
  }
  if (!response.ok) {
    let error = failureMessage;
    try {
      const body = (await response.json()) as ApiEnvelope<unknown>;
      error = body.error ?? error;
    } catch {
      // Keep the generic message when a proxy returns a non-JSON error.
    }
    if (observeContextRevisionForRequest(response, before)) {
      throw new EnrollmentExplorerApiError(409, "Access context changed; retry the request");
    }
    throw new EnrollmentExplorerApiError(response.status, error);
  }
  const blob = await response.blob();
  if (observeContextRevisionForRequest(response, before)) {
    throw new EnrollmentExplorerApiError(409, "Access context changed; retry the request");
  }
  return blob;
}

function post<T>(
  context: EnrollmentExplorerRequestContext,
  path: string,
  body: unknown,
): Promise<T> {
  return request(context, path, { method: "POST", body: JSON.stringify(body) });
}

function encodeCursor(cursor: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fetchEnrollmentCatalog(
  context: EnrollmentExplorerRequestContext,
  groupId: string | null,
  options?: { signal?: AbortSignal },
): Promise<EnrollmentCatalog> {
  const query = new URLSearchParams();
  if (groupId) query.set("groupId", groupId);
  const suffix = query.toString();
  return request(context, `/api/enrollment-explorer/catalog${suffix ? `?${suffix}` : ""}`, {
    signal: options?.signal,
  });
}

export function fetchUnresolvedEnrollmentPage(
  context: EnrollmentExplorerRequestContext,
  input: { groupId?: string | null; cursor?: unknown | null; limit?: number },
  options?: { signal?: AbortSignal },
): Promise<EnrollmentUnresolvedPage> {
  const query = new URLSearchParams();
  if (input.groupId) query.set("groupId", input.groupId);
  if (input.cursor != null) query.set("cursor", encodeCursor(input.cursor));
  if (input.limit != null) query.set("limit", String(input.limit));
  const suffix = query.toString();
  return request(context, `/api/enrollment-explorer/unresolved${suffix ? `?${suffix}` : ""}`, {
    signal: options?.signal,
  });
}

export function fetchEnrollmentScopeDetail(
  context: EnrollmentExplorerRequestContext,
  scopeId: string,
  options?: { signal?: AbortSignal },
): Promise<EnrollmentScopeDetail> {
  return request(context, `/api/enrollment-explorer/scopes/${encodeURIComponent(scopeId)}`, {
    signal: options?.signal,
  });
}

function addReportFilters(query: URLSearchParams, filters: EnrollmentReportFilters): void {
  if (filters.groupId) query.set("groupId", filters.groupId);
  if (filters.state) query.set("state", filters.state);
  if (filters.facilityId) query.set("facilityId", filters.facilityId);
  if (filters.productId) query.set("productId", filters.productId);
  if (filters.discipline) query.set("discipline", filters.discipline);
  if (filters.status) query.set("status", filters.status);
  if (filters.search) query.set("search", filters.search);
  if (filters.historical) query.set("historical", "true");
}

export function fetchEnrollmentReportPage(
  context: EnrollmentExplorerRequestContext,
  input: EnrollmentReportPageRequest,
  options?: { signal?: AbortSignal },
): Promise<EnrollmentReportPage> {
  const query = new URLSearchParams();
  addReportFilters(query, input);
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.viewToken) query.set("viewToken", input.viewToken);
  const suffix = query.toString();
  return request(
    context,
    `/api/enrollment-explorer/report/page${suffix ? `?${suffix}` : ""}`,
    { signal: options?.signal },
  );
}

export function fetchEnrollmentScopeHistory(
  context: EnrollmentExplorerRequestContext,
  scopeId: string,
  input: { cursor?: string | null; limit?: number },
  options?: { signal?: AbortSignal },
): Promise<EnrollmentScopeHistoryPage> {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.limit != null) query.set("limit", String(input.limit));
  const suffix = query.toString();
  const path = `/api/enrollment-explorer/scopes/${encodeURIComponent(scopeId)}/history`;
  return request(context, `${path}${suffix ? `?${suffix}` : ""}`, {
    signal: options?.signal,
  });
}

export function downloadEnrollmentReportCsv(
  context: EnrollmentExplorerRequestContext,
  filters: EnrollmentReportFilters,
  viewToken: string,
  options?: { signal?: AbortSignal },
): Promise<Blob> {
  const query = new URLSearchParams();
  addReportFilters(query, filters);
  query.set("viewToken", viewToken);
  return download(
    context,
    `/api/enrollment-explorer/report.csv?${query.toString()}`,
    options?.signal,
    "Enrollment report download failed",
  );
}

export function saveEnrollmentScope(
  context: EnrollmentExplorerRequestContext,
  input: EnrollmentScopeSaveInput,
): Promise<Record<string, unknown>> {
  return post(context, "/api/enrollment-explorer/scopes", input);
}

export function curateEnrollmentProduct(
  context: EnrollmentExplorerRequestContext,
  input: { payerId: string; productKey: string; displayName: string; isActive?: boolean },
): Promise<Record<string, unknown>> {
  return post(context, "/api/enrollment-explorer/products", input);
}

export function setEnrollmentProductTarget(
  context: EnrollmentExplorerRequestContext,
  input: { groupId: string; payerProductId: string; state: string; isActive?: boolean },
): Promise<Record<string, unknown>> {
  return post(context, "/api/enrollment-explorer/targets", input);
}

export function publishEnrollmentSummary(
  context: EnrollmentExplorerRequestContext,
  input: { scopeId: string; revisionId: string },
): Promise<Record<string, unknown>> {
  return post(
    context,
    `/api/enrollment-explorer/scopes/${encodeURIComponent(input.scopeId)}/summary`,
    { revisionId: input.revisionId },
  );
}

export function publishEnrollmentProof(
  context: EnrollmentExplorerRequestContext,
  input: {
    scopeId: string;
    revisionId: string;
    documentVersionId: string;
    evidenceKind: EnrollmentEvidenceKind;
    supportedFields: EnrollmentProofField[];
    reason: string;
  },
): Promise<Record<string, unknown>> {
  return post(context, "/api/enrollment-explorer/proofs", input);
}

export function revokeEnrollmentPublication(
  context: EnrollmentExplorerRequestContext,
  input: { publicationId: string; reason: string },
): Promise<Record<string, unknown>> {
  return post(
    context,
    `/api/enrollment-explorer/publications/${encodeURIComponent(input.publicationId)}/revoke`,
    { reason: input.reason },
  );
}

export function downloadEnrollmentProof(
  context: EnrollmentExplorerRequestContext,
  publicationId: string,
  options?: { signal?: AbortSignal },
): Promise<Blob> {
  return download(
    context,
    `/api/enrollment-explorer/proofs/${encodeURIComponent(publicationId)}/download`,
    options?.signal,
  );
}
