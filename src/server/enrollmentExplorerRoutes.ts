import type { UserContext } from "./guard";
import type {
  EnrollmentEvidenceKind,
  EnrollmentExplorerAudience,
  EnrollmentProofField,
  EnrollmentScopeSaveInput,
} from "@/types";
import {
  EnrollmentExplorerRpcError,
  curateEnrollmentProduct,
  downloadEnrollmentProof,
  getEnrollmentCatalog,
  getEnrollmentProofCaptureTarget,
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
} from "@/services/enrollmentExplorer";
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
  orgId: string,
  audience: EnrollmentExplorerAudience,
): EnrollmentExplorerContext {
  return { db: user.db, actorUserId: user.userId, orgId, audience };
}

export async function handleEnrollmentExplorerRequest(
  request: Request,
  user: UserContext,
  context: { orgId: string; audience: EnrollmentExplorerAudience },
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  const method = request.method.toUpperCase();
  const ctx = buildContext(user, context.orgId, context.audience);
  try {
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
