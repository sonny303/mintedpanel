// E4.5 TE-8 — the browser documents service. Two data paths by design:
//   * Metadata LIST reads ride the standard externalClient path under RLS
//     (org-scoped, like every other browser read).
//   * The SIGNED actions — upload intent, finalize, download — call the narrow
//     server endpoints (/api/documents/*): signed Storage URLs can only be
//     minted server-side, and the server owns the object-key contract, the
//     object verification, and the audit rows (TE-3). These three endpoints
//     are the ONE sanctioned frontend /api surface (the epic's §5 supersedes
//     the older no-frontend-consumer posture for exactly this); everything
//     else in the app stays on direct Supabase + RLS.
// The upload bytes go straight from the browser to the signed Storage URL —
// file contents never pass through the nitro server.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg } from "@/lib/audit";
import type { DocumentKind, DocumentOwnerType, ProviderDocument } from "@/types";

const DOCUMENT_COLUMNS =
  "id, org_id, provider_id, group_id, case_id, doc_type, file_name, file_path, " +
  "effective_date, expiration_date, uploaded_by, created_at, document_family_id, " +
  "version_number, supersedes_document_id";

/** All document versions for one provider (history included — "current" is
 * derived in the pure lib, never here). */
export async function listProviderDocuments(providerId: string): Promise<ProviderDocument[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("provider_documents")
    .select(DOCUMENT_COLUMNS)
    .eq("org_id", orgId)
    .eq("provider_id", providerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return camelizeRow<ProviderDocument[]>(data ?? []);
}

/** All document versions for one provider group. */
export async function listGroupDocuments(groupId: string): Promise<ProviderDocument[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("provider_documents")
    .select(DOCUMENT_COLUMNS)
    .eq("org_id", orgId)
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return camelizeRow<ProviderDocument[]>(data ?? []);
}

/** Org-wide document versions (the expiring-credentials report input). RLS
 * scopes the read; the org filter is defensive like every service here. */
export async function listOrgDocuments(): Promise<ProviderDocument[]> {
  const orgId = requireActiveOrg();
  const { data, error } = await supabase
    .from("provider_documents")
    .select(DOCUMENT_COLUMNS)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return camelizeRow<ProviderDocument[]>(data ?? []);
}

/** Uploader display names for a set of user ids (uploaded_by has no FK — the
 * touchlog author-resolution idiom). */
export async function listUploaderNames(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", unique);
  if (error) throw error;
  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{
    id: string;
    full_name: string | null;
    email: string | null;
  }>) {
    map.set(row.id, row.full_name ?? row.email ?? "—");
  }
  return map;
}

// ---------------------------------------------------------------------------
// The signed actions — /api through the same-origin nitro server, with the
// caller's JWT + active org (the extension's auth contract, from the browser).
// ---------------------------------------------------------------------------

interface ApiEnvelope<T> {
  data: T | null;
  error: string | null;
}

async function authedApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const orgId = requireActiveOrg();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`,
      "x-org-id": orgId,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || envelope.data === null) {
    throw new Error(envelope.error ?? `Request failed (${response.status})`);
  }
  return envelope.data;
}

export interface DocumentUploadIntent {
  familyId: string;
  versionNumber: number;
  path: string;
  uploadUrl: string;
  token: string;
}

export interface UploadDocumentInput {
  ownerType: DocumentOwnerType;
  ownerId: string;
  kind: DocumentKind;
  file: File;
  effectiveDate?: string | null;
  expirationDate?: string | null;
  /** Replace flow: version an existing family. */
  familyId?: string | null;
  /** Optional usage context (TE-1). */
  caseId?: string | null;
}

/** The full upload pipeline: intent → signed PUT (browser → Storage direct) →
 * finalize. Returns the immutable metadata row. A finalize retry is
 * idempotent server-side; a failed PUT leaves an orphan the server's bounded
 * sweep cleans on the next intent (TE-4). */
export async function uploadDocument(input: UploadDocumentInput): Promise<ProviderDocument> {
  const intent = await authedApiFetch<DocumentUploadIntent>("/api/documents/upload-intent", {
    method: "POST",
    body: JSON.stringify({
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      kind: input.kind,
      fileName: input.file.name,
      fileSize: input.file.size,
      mimeType: input.file.type,
      familyId: input.familyId ?? null,
      // TS-163: REQUIRED for caseArtifact kinds (filled_form) — the server
      // now authorizes the case dimension at intent time too, not just
      // finalize.
      caseId: input.caseId ?? null,
    }),
  });

  const put = await fetch(intent.uploadUrl, {
    method: "PUT",
    headers: { "content-type": input.file.type },
    body: input.file,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);

  return authedApiFetch<ProviderDocument>("/api/documents/finalize", {
    method: "POST",
    body: JSON.stringify({
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      kind: input.kind,
      familyId: intent.familyId,
      versionNumber: intent.versionNumber,
      fileName: input.file.name,
      mimeType: input.file.type,
      effectiveDate: input.effectiveDate ?? null,
      expirationDate: input.expirationDate ?? null,
      caseId: input.caseId ?? null,
    }),
  });
}

export interface SignedDownload {
  url: string;
  fileName: string;
  expiresIn: number;
}

/** One short-lived, audited signed URL for one document version (TE-3/TE-11).
 * Called from a MUTATION-style action, never a query — the URL must not sit
 * in a cache (it expires in seconds and every issue is audited). */
export async function getDocumentDownload(documentId: string): Promise<SignedDownload> {
  return authedApiFetch<SignedDownload>(`/api/documents/${documentId}/download`, {
    method: "GET",
  });
}
