// E4.5 TE-3 — the document-storage route handlers: signed upload intent,
// finalize, signed download. Same composition as extensionRoutes.ts — inject
// the authenticated server context into the service layer, never duplicate
// query logic here. Every response that carries a signed URL is
// Cache-Control: no-store, and every action writes ONE audit row (actor,
// document/family, owner, kind — never file contents or a reusable URL; a
// failed audit write fails the request, the profile-route posture).
//
// These are the FIRST /api routes the browser app itself consumes (the epic's
// §5 supersedes the older "no frontend consumer" posture for exactly this
// narrow surface): signed Storage URLs can only be minted server-side, so the
// browser documents service calls these three endpoints while every metadata
// LIST read stays on direct Supabase + RLS (TE-8). The extension consumes the
// same download contract later (TE-11) — audited links only, never bucket
// credentials, permanent URLs, or object-list access.
import {
  createDocumentUploadIntent,
  finalizeDocument,
  signDocumentDownload,
  type FinalizeDocumentInput,
  type UploadIntentInput,
} from "@/services/documentStorage";
import { isDocumentKind } from "@/lib/documents";
import { ok, fail } from "./envelope";
import { isWriter, type AuthContext } from "./guard";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isOwnerType(raw: unknown): raw is "provider" | "group" {
  return raw === "provider" || raw === "group";
}

function optionalDate(raw: unknown): string | null | undefined {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string" || !DATE_RE.test(raw)) return undefined; // invalid
  return raw;
}

// POST /api/documents/upload-intent — writer roles mint a short-lived signed
// upload target for a server-generated object key (TE-2: the browser never
// names a path). The audit row records the target family/owner/kind — never
// the signed URL or token.
export async function handleCreateUploadIntent(body: unknown, ctx: AuthContext): Promise<Response> {
  if (!isWriter(ctx)) return fail(403, "Your role cannot upload documents");
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail(422, "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;
  if (!isOwnerType(b.ownerType)) return fail(422, "ownerType must be 'provider' or 'group'");
  if (typeof b.ownerId !== "string" || !UUID_RE.test(b.ownerId)) {
    return fail(
      404,
      b.ownerType === "provider" ? "Provider not found" : "Provider group not found",
    );
  }
  if (typeof b.kind !== "string" || !isDocumentKind(b.kind)) {
    return fail(422, "Unknown document kind");
  }
  if (typeof b.fileName !== "string" || !b.fileName.trim()) {
    return fail(422, "fileName is required");
  }
  if (typeof b.fileSize !== "number" || typeof b.mimeType !== "string") {
    return fail(422, "fileSize and mimeType are required");
  }
  if (b.familyId != null && (typeof b.familyId !== "string" || !UUID_RE.test(b.familyId))) {
    return fail(404, "Document family not found");
  }

  const input: UploadIntentInput = {
    ownerType: b.ownerType,
    ownerId: b.ownerId,
    kind: b.kind,
    fileName: b.fileName,
    fileSize: b.fileSize,
    mimeType: b.mimeType,
    familyId: (b.familyId as string | undefined) ?? null,
  };
  const result = await createDocumentUploadIntent(
    { db: ctx.db, orgId: ctx.orgId, userId: ctx.userId },
    input,
  );
  if (result.kind === "rejected") return fail(result.status, result.message);

  await ctx.writeAudit({
    actionType: "CREATE",
    entityType: "document_upload_intent",
    entityId: result.value.familyId,
    after: {
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      kind: input.kind,
      versionNumber: result.value.versionNumber,
    },
    description: "Signed document upload target issued",
  });

  const response = ok(result.value);
  response.headers.set("cache-control", "no-store");
  return response;
}

// POST /api/documents/finalize — after the browser PUT to the signed target,
// verify the object and insert the immutable metadata row. Idempotent: a
// retry returns the stored row (200) instead of inserting (201).
export async function handleFinalizeDocument(body: unknown, ctx: AuthContext): Promise<Response> {
  if (!isWriter(ctx)) return fail(403, "Your role cannot upload documents");
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail(422, "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;
  if (!isOwnerType(b.ownerType)) return fail(422, "ownerType must be 'provider' or 'group'");
  if (typeof b.ownerId !== "string" || !UUID_RE.test(b.ownerId)) {
    return fail(
      404,
      b.ownerType === "provider" ? "Provider not found" : "Provider group not found",
    );
  }
  if (typeof b.kind !== "string" || !isDocumentKind(b.kind)) {
    return fail(422, "Unknown document kind");
  }
  if (typeof b.familyId !== "string" || !UUID_RE.test(b.familyId)) {
    return fail(422, "familyId is required");
  }
  if (typeof b.versionNumber !== "number") return fail(422, "versionNumber is required");
  if (typeof b.fileName !== "string" || !b.fileName.trim()) {
    return fail(422, "fileName is required");
  }
  if (typeof b.mimeType !== "string") return fail(422, "mimeType is required");
  const effectiveDate = optionalDate(b.effectiveDate);
  if (effectiveDate === undefined) return fail(422, "effectiveDate must be YYYY-MM-DD");
  const expirationDate = optionalDate(b.expirationDate);
  if (expirationDate === undefined) return fail(422, "expirationDate must be YYYY-MM-DD");
  if (b.caseId != null && (typeof b.caseId !== "string" || !UUID_RE.test(b.caseId))) {
    return fail(404, "Case not found for this owner");
  }

  const input: FinalizeDocumentInput = {
    ownerType: b.ownerType,
    ownerId: b.ownerId,
    kind: b.kind,
    familyId: b.familyId,
    versionNumber: b.versionNumber,
    fileName: b.fileName,
    mimeType: b.mimeType,
    effectiveDate,
    expirationDate,
    caseId: (b.caseId as string | undefined) ?? null,
  };
  const result = await finalizeDocument(
    { db: ctx.db, orgId: ctx.orgId, userId: ctx.userId },
    input,
  );
  if (result.kind === "rejected") return fail(result.status, result.message);

  // One CREATE audit per NEW version; a replay re-runs no side effects.
  if (!result.replay) {
    await ctx.writeAudit({
      actionType: "CREATE",
      entityType: "provider_document",
      entityId: result.value.id,
      after: {
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        kind: input.kind,
        familyId: input.familyId,
        versionNumber: input.versionNumber,
      },
      description: "Document version finalized",
    });
  }

  const response = ok(result.value, null, result.replay ? 200 : 201);
  response.headers.set("cache-control", "no-store");
  return response;
}

// GET /api/documents/:id/download — any org member (billing reads too, the
// TE-2 read rule) gets a short-lived signed URL for one org-owned document
// version. A cross-org or nonexistent id is a 404 (the gate's assertion 17)
// and nothing is signed or audited. This endpoint IS the D3 future-auto-attach
// contract: per-document addressability with scoped, audited, time-limited
// access (TE-11) — the extension consumes it later.
export async function handleDocumentDownload(id: string, ctx: AuthContext): Promise<Response> {
  if (!UUID_RE.test(id)) return fail(404, "Document not found");
  const result = await signDocumentDownload(
    { db: ctx.db, orgId: ctx.orgId, userId: ctx.userId },
    id,
  );
  if (!result) return fail(404, "Document not found");

  // One READ audit row per successful signing — actor, document, owner, kind.
  // Never the URL. A failed audit write throws -> 500: no un-audited signed
  // link ever leaves this handler; 404s are not reads.
  await ctx.writeAudit({
    actionType: "READ",
    entityType: "provider_document",
    entityId: result.document.id,
    after: {
      route: "/api/documents/:id/download",
      ownerType: result.document.providerId ? "provider" : "group",
      ownerId: result.document.providerId ?? result.document.groupId,
      kind: result.document.docType,
      versionNumber: result.document.versionNumber,
    },
    description: "Signed document download issued",
  });

  const response = ok({
    url: result.url,
    fileName: result.fileName,
    expiresIn: result.expiresIn,
  });
  response.headers.set("cache-control", "no-store");
  return response;
}
