// E4.5 TE-3/TE-4 — the server-owned document storage boundary (service-role
// ctx, injected by the guarded /api document routes; server-only like
// caseContext.ts — never imported client-side).
//
// Three operations, each with explicit org + owner checks (the injected
// service-role client bypasses RLS, so isolation is enforced HERE):
//   1. createDocumentUploadIntent — validate owner/kind/file, resolve the
//      family + next version, SERVER-generate the object key (the TE-2 path
//      contract — never accepted from the browser), sweep expired orphans in
//      the family prefix (the TE-4 bounded maintenance job), and mint a
//      short-lived signed upload target.
//   2. finalizeDocument — verify the object actually exists at the derived
//      path with an allowed size/MIME before inserting the IMMUTABLE metadata
//      row (supersedes = the family head; never an update/delete). Idempotent:
//      a retry that finds its row already inserted returns it; the
//      (org, family, version) unique is the DB backstop.
//   3. signDocumentDownload — org-scoped metadata lookup (a cross-org id is
//      indistinguishable from missing), then a short-lived signed URL. No
//      permanent/public URL is ever stored or returned.
//
// Audit rows are written by the route handlers (the profile-route posture):
// actor, document, owner, kind — never file contents or reusable URLs.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { camelizeRow } from "@/lib/case";
import {
  DOCUMENT_BUCKET,
  DOCUMENT_KIND_META,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MIME_TYPES,
  DOWNLOAD_URL_TTL_SECONDS,
  documentFamilyPrefix,
  documentObjectPath,
  expirationDateError,
  currentVersions,
  isDocumentKind,
  isOrphanExpired,
  nextVersionNumber,
  orphanVersionFolders,
  safeFileName,
} from "@/lib/documents";
import type { DocumentKind, DocumentOwnerType, ProviderDocument } from "@/types";

export interface DocumentStorageServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
  userId: string;
}

export interface UploadIntentInput {
  ownerType: DocumentOwnerType;
  ownerId: string;
  kind: DocumentKind;
  fileName: string;
  fileSize: number;
  mimeType: string;
  /** Present on the replace flow — versions an existing family. */
  familyId?: string | null;
}

export interface UploadIntent {
  familyId: string;
  versionNumber: number;
  path: string;
  uploadUrl: string;
  token: string;
}

export interface FinalizeDocumentInput {
  ownerType: DocumentOwnerType;
  ownerId: string;
  kind: DocumentKind;
  familyId: string;
  versionNumber: number;
  fileName: string;
  mimeType: string;
  effectiveDate?: string | null;
  expirationDate?: string | null;
  /** Optional usage context (TE-1) — must be an org-owned case linked to the
   * owner; never the canonical owner itself. */
  caseId?: string | null;
}

export type DocumentStorageResult<T> =
  | { kind: "ok"; value: T; replay?: boolean }
  | { kind: "rejected"; status: number; message: string };

interface FamilyRowRaw {
  id: string;
  document_family_id: string;
  version_number: number;
  supersedes_document_id: string | null;
  provider_id: string | null;
  group_id: string | null;
  doc_type: string;
}

const FAMILY_COLUMNS =
  "id, document_family_id, version_number, supersedes_document_id, provider_id, group_id, doc_type";

function familyShape(rows: FamilyRowRaw[]) {
  return rows.map((r) => ({
    id: r.id,
    documentFamilyId: r.document_family_id,
    versionNumber: r.version_number,
    supersedesDocumentId: r.supersedes_document_id,
    providerId: r.provider_id,
    groupId: r.group_id,
    docType: r.doc_type,
  }));
}

/** The canonical owner must exist inside the caller's org (a cross-org owner
 * id is indistinguishable from missing — 404). */
async function verifyOwner(
  ctx: DocumentStorageServiceCtx,
  ownerType: DocumentOwnerType,
  ownerId: string,
): Promise<boolean> {
  const table = ownerType === "provider" ? "providers" : "provider_groups";
  const { data, error } = await ctx.db
    .from(table)
    .select("id")
    .eq("id", ownerId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/** Shared input validation for intent + finalize. Returns a rejection or null. */
async function validateOwnerKindFile(
  ctx: DocumentStorageServiceCtx,
  input: {
    ownerType: DocumentOwnerType;
    ownerId: string;
    kind: DocumentKind;
    mimeType: string;
    fileSize?: number;
  },
): Promise<{ status: number; message: string } | null> {
  if (!isDocumentKind(input.kind)) return { status: 422, message: "Unknown document kind" };
  const meta = DOCUMENT_KIND_META[input.kind];
  if (!meta.uploadable || !meta.owners.includes(input.ownerType)) {
    return {
      status: 422,
      message: `${meta.label} is not an uploadable ${input.ownerType} document`,
    };
  }
  if (!(DOCUMENT_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    return { status: 422, message: "Only PDF, PNG, or JPEG files are supported" };
  }
  if (
    input.fileSize !== undefined &&
    (input.fileSize <= 0 || input.fileSize > DOCUMENT_MAX_BYTES)
  ) {
    return {
      status: 422,
      message: `Files are limited to ${Math.floor(DOCUMENT_MAX_BYTES / (1024 * 1024))} MB`,
    };
  }
  const ownerOk = await verifyOwner(ctx, input.ownerType, input.ownerId);
  if (!ownerOk) {
    return {
      status: 404,
      message: input.ownerType === "provider" ? "Provider not found" : "Provider group not found",
    };
  }
  return null;
}

/** Load a family's rows (org-scoped) and check it belongs to this owner with
 * this kind — a family never changes owner or kind (TE-1). */
async function loadFamily(
  ctx: DocumentStorageServiceCtx,
  familyId: string,
): Promise<ReturnType<typeof familyShape>> {
  const { data, error } = await ctx.db
    .from("provider_documents")
    .select(FAMILY_COLUMNS)
    .eq("org_id", ctx.orgId)
    .eq("document_family_id", familyId);
  if (error) throw error;
  return familyShape((data ?? []) as FamilyRowRaw[]);
}

function familyOwnerMismatch(
  family: ReturnType<typeof familyShape>,
  input: { ownerType: DocumentOwnerType; ownerId: string; kind: DocumentKind },
): boolean {
  return family.some(
    (r) =>
      r.docType !== input.kind ||
      (input.ownerType === "provider"
        ? r.providerId !== input.ownerId
        : r.groupId !== input.ownerId),
  );
}

/** TE-4 — the bounded orphan sweep: inside ONE family prefix, remove objects
 * in version folders that have no metadata row and whose upload token has
 * long expired. Best-effort — a sweep failure never blocks the new intent. */
async function sweepFamilyOrphans(
  ctx: DocumentStorageServiceCtx,
  prefix: string,
  metadataVersions: number[],
): Promise<void> {
  try {
    const storage = ctx.db.storage.from(DOCUMENT_BUCKET);
    const { data: folders, error } = await storage.list(prefix);
    if (error || !folders) return;
    const orphans = orphanVersionFolders(
      folders.map((f) => f.name),
      metadataVersions,
    );
    const nowMs = Date.now();
    for (const folder of orphans) {
      const { data: objects, error: listErr } = await storage.list(`${prefix}/${folder}`);
      if (listErr || !objects) continue;
      const stale = objects
        .filter((o) => o.created_at && isOrphanExpired(o.created_at, nowMs))
        .map((o) => `${prefix}/${folder}/${o.name}`);
      if (stale.length > 0) await storage.remove(stale);
    }
  } catch {
    // Best-effort by design: the sweep is maintenance, never a gate.
  }
}

export async function createDocumentUploadIntent(
  ctx: DocumentStorageServiceCtx,
  input: UploadIntentInput,
): Promise<DocumentStorageResult<UploadIntent>> {
  const invalid = await validateOwnerKindFile(ctx, input);
  if (invalid) return { kind: "rejected", ...invalid };

  let familyId = input.familyId ?? null;
  let versionNumber = 1;
  if (familyId) {
    const family = await loadFamily(ctx, familyId);
    if (family.length === 0) {
      return { kind: "rejected", status: 404, message: "Document family not found" };
    }
    if (familyOwnerMismatch(family, input)) {
      return {
        kind: "rejected",
        status: 422,
        message: "A replacement must keep the document's owner and kind",
      };
    }
    versionNumber = nextVersionNumber(family);
    // The natural retry path for the exact scenario that orphans objects:
    // upload succeeded, finalize failed, the user re-issues an intent.
    await sweepFamilyOrphans(
      ctx,
      documentFamilyPrefix({
        orgId: ctx.orgId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        familyId,
      }),
      family.map((r) => r.versionNumber),
    );
  } else {
    familyId = crypto.randomUUID();
  }

  const path = documentObjectPath({
    orgId: ctx.orgId,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    familyId,
    version: versionNumber,
    fileName: input.fileName,
  });
  const { data, error } = await ctx.db.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    throw new Error(`Failed to create a signed upload target: ${error?.message ?? "no data"}`);
  }
  return {
    kind: "ok",
    value: {
      familyId,
      versionNumber,
      path,
      uploadUrl: data.signedUrl,
      token: data.token,
    },
  };
}

export async function finalizeDocument(
  ctx: DocumentStorageServiceCtx,
  input: FinalizeDocumentInput,
): Promise<DocumentStorageResult<ProviderDocument>> {
  const invalid = await validateOwnerKindFile(ctx, input);
  if (invalid) return { kind: "rejected", ...invalid };

  const expirationError = expirationDateError(input.kind, input.expirationDate ?? null);
  if (expirationError) return { kind: "rejected", status: 422, message: expirationError };

  if (!Number.isInteger(input.versionNumber) || input.versionNumber < 1) {
    return { kind: "rejected", status: 422, message: "versionNumber must be a positive integer" };
  }

  // Optional usage context: the case must be org-owned AND linked to the
  // canonical owner — never a channel to attach cross-org or unrelated rows.
  if (input.caseId) {
    const { data: caseRow, error: caseErr } = await ctx.db
      .from("credential_cases")
      .select("id, provider_id, group_id")
      .eq("id", input.caseId)
      .eq("org_id", ctx.orgId)
      .maybeSingle();
    if (caseErr) throw caseErr;
    const linked =
      caseRow &&
      (input.ownerType === "provider"
        ? (caseRow as { provider_id: string | null }).provider_id === input.ownerId
        : (caseRow as { group_id: string | null }).group_id === input.ownerId);
    if (!linked) return { kind: "rejected", status: 404, message: "Case not found for this owner" };
  }

  const family = await loadFamily(ctx, input.familyId);
  if (family.length > 0 && familyOwnerMismatch(family, input)) {
    return {
      kind: "rejected",
      status: 422,
      message: "A replacement must keep the document's owner and kind",
    };
  }

  // Idempotent replay: the metadata row already exists at this
  // (org, family, version) — return it, re-running no side effects (TE-4).
  const existing = family.find((r) => r.versionNumber === input.versionNumber);
  if (existing) {
    const { data: existingRow, error: exErr } = await ctx.db
      .from("provider_documents")
      .select("*")
      .eq("id", existing.id)
      .maybeSingle();
    if (exErr) throw exErr;
    if (existingRow) {
      return { kind: "ok", value: camelizeRow<ProviderDocument>(existingRow), replay: true };
    }
  }

  // The object must exist at the SERVER-derived path (the client never names a
  // path) with an allowed size and the declared MIME type — metadata is never
  // written for a missing or misdescribed object (TE-4).
  const path = documentObjectPath({
    orgId: ctx.orgId,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    familyId: input.familyId,
    version: input.versionNumber,
    fileName: input.fileName,
  });
  const storedName = safeFileName(input.fileName);
  const parent = path.slice(0, path.length - storedName.length - 1);
  const { data: objects, error: listErr } = await ctx.db.storage
    .from(DOCUMENT_BUCKET)
    .list(parent, { search: storedName });
  if (listErr) throw listErr;
  const object = (objects ?? []).find((o) => o.name === storedName);
  if (!object) {
    return { kind: "rejected", status: 422, message: "The uploaded file was not found in storage" };
  }
  const objectMeta = (object.metadata ?? {}) as { size?: number; mimetype?: string };
  const size = typeof objectMeta.size === "number" ? objectMeta.size : null;
  const mimetype = typeof objectMeta.mimetype === "string" ? objectMeta.mimetype : null;
  if (size !== null && (size <= 0 || size > DOCUMENT_MAX_BYTES)) {
    return { kind: "rejected", status: 422, message: "The uploaded file exceeds the size limit" };
  }
  if (mimetype !== null && mimetype !== input.mimeType) {
    return {
      kind: "rejected",
      status: 422,
      message: "The uploaded file does not match its declared type",
    };
  }

  const head = currentVersions(family)[0] ?? null;
  const insert: Database["public"]["Tables"]["provider_documents"]["Insert"] = {
    org_id: ctx.orgId,
    provider_id: input.ownerType === "provider" ? input.ownerId : null,
    group_id: input.ownerType === "group" ? input.ownerId : null,
    case_id: input.caseId ?? null,
    doc_type: input.kind,
    file_path: path,
    file_name: storedName,
    effective_date: input.effectiveDate ?? null,
    expiration_date: input.expirationDate ?? null,
    uploaded_by: ctx.userId,
    document_family_id: input.familyId,
    version_number: input.versionNumber,
    supersedes_document_id: head?.id ?? null,
  };
  const { data: inserted, error: insertErr } = await ctx.db
    .from("provider_documents")
    .insert(insert)
    .select("*")
    .single();
  if (insertErr) {
    // 23505 on (org, family, version): a concurrent retry won the race —
    // return the stored row instead of failing (idempotent finalize, TE-4).
    if ((insertErr as { code?: string }).code === "23505") {
      const { data: raced, error: racedErr } = await ctx.db
        .from("provider_documents")
        .select("*")
        .eq("org_id", ctx.orgId)
        .eq("document_family_id", input.familyId)
        .eq("version_number", input.versionNumber)
        .maybeSingle();
      if (racedErr) throw racedErr;
      if (raced) return { kind: "ok", value: camelizeRow<ProviderDocument>(raced), replay: true };
    }
    throw insertErr;
  }
  return { kind: "ok", value: camelizeRow<ProviderDocument>(inserted) };
}

export interface SignedDocumentDownload {
  url: string;
  fileName: string;
  expiresIn: number;
  document: ProviderDocument;
}

export async function signDocumentDownload(
  ctx: DocumentStorageServiceCtx,
  documentId: string,
): Promise<SignedDocumentDownload | null> {
  // Org-scoped metadata lookup — a cross-org or nonexistent id is the route's
  // 404 (the gate's assertion-17 wall) and nothing is signed.
  const { data: row, error } = await ctx.db
    .from("provider_documents")
    .select("*")
    .eq("id", documentId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const document = camelizeRow<ProviderDocument>(row);
  const { data: signed, error: signErr } = await ctx.db.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(document.filePath, DOWNLOAD_URL_TTL_SECONDS, {
      download: document.fileName,
    });
  if (signErr || !signed) {
    throw new Error(`Failed to sign the document download: ${signErr?.message ?? "no data"}`);
  }
  return {
    url: signed.signedUrl,
    fileName: document.fileName,
    expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    document,
  };
}
