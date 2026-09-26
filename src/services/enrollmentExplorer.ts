import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type {
  EnrollmentCatalog,
  EnrollmentEvidenceKind,
  EnrollmentExplorerAudience,
  EnrollmentMatrixQueryResult,
  EnrollmentProofField,
  EnrollmentScopeDetail,
  EnrollmentScopeSaveInput,
  EnrollmentUnresolvedPage,
} from "@/types";
import { DOCUMENT_BUCKET } from "@/lib/documents";

export interface EnrollmentExplorerContext {
  db: SupabaseClient<Database>;
  actorUserId: string;
  orgId: string;
  audience: EnrollmentExplorerAudience;
}

export class EnrollmentExplorerRpcError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "EnrollmentExplorerRpcError";
  }
}

interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
}

function rpcClient(db: SupabaseClient<Database>): RpcClient {
  return db as unknown as RpcClient;
}

function asObject(value: unknown, source: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${source} returned an invalid response`);
  }
  return value as Record<string, unknown>;
}

async function call<T>(
  ctx: EnrollmentExplorerContext,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await rpcClient(ctx.db).rpc(name, {
    p_actor_user_id: ctx.actorUserId,
    p_org_id: ctx.orgId,
    p_audience: ctx.audience,
    ...args,
  });
  if (error) throw new EnrollmentExplorerRpcError(error.message, error.code ?? null);
  return data as T;
}

export function getEnrollmentCatalog(
  ctx: EnrollmentExplorerContext,
  groupId: string | null,
): Promise<EnrollmentCatalog> {
  return call(ctx, "get_enrollment_catalog", { p_group_id: groupId });
}

export interface QueryEnrollmentScopesInput {
  groupId?: string | null;
  facilityId?: string | null;
  discipline?: string | null;
  statusBucket?: string | null;
  search?: string | null;
  page?: number;
  limit?: number;
}

export function queryEnrollmentScopes(
  ctx: EnrollmentExplorerContext,
  input: QueryEnrollmentScopesInput = {},
): Promise<EnrollmentMatrixQueryResult> {
  return call(ctx, "get_enrollment_explorer_page", {
    p_group_id: input.groupId ?? null,
    p_facility_id: input.facilityId ?? null,
    p_discipline: input.discipline ?? null,
    p_status_bucket: input.statusBucket ?? null,
    p_search: input.search ?? null,
    p_page: input.page ?? 1,
    p_limit: input.limit ?? 50,
  });
}

export function curateEnrollmentProduct(
  ctx: EnrollmentExplorerContext,
  input: { payerId: string; productKey: string; displayName: string; isActive: boolean },
): Promise<Record<string, unknown>> {
  return call(ctx, "curate_enrollment_payer_product", {
    p_payer_id: input.payerId,
    p_product_key: input.productKey,
    p_display_name: input.displayName,
    p_is_active: input.isActive,
  });
}

export function setEnrollmentProductTarget(
  ctx: EnrollmentExplorerContext,
  input: {
    groupId: string;
    payerProductId: string;
    state: string;
    isActive: boolean;
  },
): Promise<Record<string, unknown>> {
  return call(ctx, "set_enrollment_group_product_target", {
    p_group_id: input.groupId,
    p_payer_product_id: input.payerProductId,
    p_state: input.state,
    p_is_active: input.isActive,
  });
}

export function saveEnrollmentRevision(
  ctx: EnrollmentExplorerContext,
  input: EnrollmentScopeSaveInput,
): Promise<Record<string, unknown>> {
  return call(ctx, "save_enrollment_revision", {
    p_scope_id: input.scopeId ?? null,
    p_expected_revision_id: input.expectedRevisionId ?? null,
    p_provider_id: input.providerId,
    p_group_id: input.groupId,
    p_payer_product_id: input.payerProductId,
    p_facility_id: input.facilityId,
    p_state: input.state,
    p_revision: input.revision as unknown as Json,
    p_sources: input.sources as unknown as Json,
  });
}

export function getEnrollmentScopeDetail(
  ctx: EnrollmentExplorerContext,
  scopeId: string,
): Promise<EnrollmentScopeDetail> {
  return call(ctx, "get_enrollment_scope_detail", { p_scope_id: scopeId });
}

export function getEnrollmentUnresolvedPage(
  ctx: EnrollmentExplorerContext,
  input: { groupId: string | null; cursor: unknown | null; limit: number },
): Promise<EnrollmentUnresolvedPage> {
  return call(ctx, "get_enrollment_unresolved_page", {
    p_group_id: input.groupId,
    p_cursor: input.cursor as Json,
    p_limit: input.limit,
  });
}

export function publishEnrollmentSummary(
  ctx: EnrollmentExplorerContext,
  input: { scopeId: string; revisionId: string },
): Promise<Record<string, unknown>> {
  return call(ctx, "publish_enrollment_summary", {
    p_scope_id: input.scopeId,
    p_revision_id: input.revisionId,
  });
}

export interface EnrollmentProofCaptureTarget {
  documentVersionId: string;
  storagePath: string;
  fileName: string;
}

export async function getEnrollmentProofCaptureTarget(
  ctx: EnrollmentExplorerContext,
  input: { scopeId: string; revisionId: string; documentVersionId: string },
): Promise<EnrollmentProofCaptureTarget> {
  const target = asObject(
    await call(ctx, "get_enrollment_proof_capture_target", {
      p_scope_id: input.scopeId,
      p_revision_id: input.revisionId,
      p_document_version_id: input.documentVersionId,
    }),
    "get_enrollment_proof_capture_target",
  );
  if (
    typeof target.documentVersionId !== "string" ||
    typeof target.storagePath !== "string" ||
    typeof target.fileName !== "string"
  ) {
    throw new Error("Proof capture target was incomplete");
  }
  return {
    documentVersionId: target.documentVersionId,
    storagePath: target.storagePath,
    fileName: target.fileName,
  };
}

export async function readStoredProviderDocument(
  ctx: EnrollmentExplorerContext,
  storagePath: string,
): Promise<Blob> {
  const { data, error } = await ctx.db.storage.from(DOCUMENT_BUCKET).download(storagePath);
  if (error || !data) throw new Error("Stored proof document could not be read");
  return data;
}

export async function sha256DocumentBlob(blob: Blob): Promise<string> {
  const hash = createHash("sha256");
  const reader = blob.stream().getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) hash.update(value);
  }
  return hash.digest("hex");
}

export function publishEnrollmentProof(
  ctx: EnrollmentExplorerContext,
  input: {
    scopeId: string;
    revisionId: string;
    documentVersionId: string;
    evidenceKind: EnrollmentEvidenceKind;
    supportedFields: EnrollmentProofField[];
    sha256: string;
    reason: string;
  },
): Promise<Record<string, unknown>> {
  return call(ctx, "publish_enrollment_proof", {
    p_scope_id: input.scopeId,
    p_revision_id: input.revisionId,
    p_document_version_id: input.documentVersionId,
    p_evidence_kind: input.evidenceKind,
    p_supported_fields: input.supportedFields,
    p_sha256: input.sha256,
    p_reason: input.reason,
  });
}

export function revokeEnrollmentPublication(
  ctx: EnrollmentExplorerContext,
  input: { publicationId: string; reason: string },
): Promise<Record<string, unknown>> {
  return call(ctx, "revoke_enrollment_publication", {
    p_publication_id: input.publicationId,
    p_reason: input.reason,
  });
}

export async function downloadEnrollmentProof(
  ctx: EnrollmentExplorerContext,
  publicationId: string,
): Promise<{ blob: Blob; fileName: string; sha256: string }> {
  const authorized = asObject(
    await call(ctx, "authorize_enrollment_proof_download", {
      p_publication_id: publicationId,
    }),
    "authorize_enrollment_proof_download",
  );
  if (
    typeof authorized.documentVersionId !== "string" ||
    typeof authorized.storagePath !== "string" ||
    typeof authorized.fileName !== "string" ||
    typeof authorized.sha256 !== "string"
  ) {
    throw new Error("Proof download authorization was incomplete");
  }
  const blob = await readStoredProviderDocument(ctx, authorized.storagePath);
  const actualSha256 = await sha256DocumentBlob(blob);
  if (actualSha256 !== authorized.sha256) {
    throw new EnrollmentExplorerRpcError("enrollment_source_stale", "40001");
  }
  // This second, database-authorized call rechecks audience, grants, summary,
  // source revision, proof revocation, version identity and digest immediately
  // before the server returns the bytes. It also writes the IDs-only audit.
  await call(ctx, "record_enrollment_proof_download", {
    p_publication_id: publicationId,
    p_document_version_id: authorized.documentVersionId,
    p_sha256: actualSha256,
  });
  return { blob, fileName: authorized.fileName, sha256: actualSha256 };
}
