// Payer PDF — the payer-form storage route handlers: signed upload intent,
// finalize, signed download. Same composition as documentRoutes.ts: inject the
// authenticated server context into the service layer, never duplicate query
// logic here, no-store every signed URL, one audit row per action.
//
// GUARD CHOICE — these run on the full org-scoped `authenticate()` guard, not
// the user-scoped one the other global-tier routes use. The shared training
// tier is user-scoped because its caller is the EXTENSION in training mode,
// which deliberately sends no x-org-id. The caller here is the WEBAPP, which
// always has an active org — so there is an org to audit into and an org role
// to check, and using the ordinary guard keeps this surface inside the normal
// isolation gate rather than beside it.
//
// ROLE WALL — payer_forms rows are GLOBAL: one org's admin uploading a form
// changes what every org sees. That is the intended product behavior (a blank
// payer form is the same document for everyone), so the wall is role, not
// tenancy: writes are ADMIN-only, a step tighter than the isWriter() rule used
// for org-owned documents. Reads are open to any member, like the rest of the
// global tier.
import {
  createPayerFormUploadIntent,
  finalizePayerForm,
  signPayerFormDownload,
  type FinalizePayerFormInput,
  type PayerFormUploadIntentInput,
} from "@/services/payerFormStorage";
import { ok, fail } from "./envelope";
import type { AuthContext } from "./guard";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Global rows are changed by ANY org's admin, so the check is the role alone.
 * A specialist may use payer forms; only an admin may change them. */
function isGlobalAuthor(ctx: AuthContext): boolean {
  return ctx.role === "admin";
}

// POST /api/payer-forms/upload-intent — mint a short-lived signed upload target
// for a server-generated object key (the browser never names a path).
export async function handleCreatePayerFormUploadIntent(
  body: unknown,
  ctx: AuthContext,
): Promise<Response> {
  if (!isGlobalAuthor(ctx)) return fail(403, "Only an admin can add payer forms");
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail(422, "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;
  if (typeof b.templateId !== "string" || !UUID_RE.test(b.templateId)) {
    return fail(404, "Template not found");
  }
  if (typeof b.label !== "string") return fail(422, "label is required");
  if (typeof b.fileName !== "string" || !b.fileName.trim()) {
    return fail(422, "fileName is required");
  }
  if (typeof b.fileSize !== "number" || typeof b.mimeType !== "string") {
    return fail(422, "fileSize and mimeType are required");
  }
  if (b.familyId != null && (typeof b.familyId !== "string" || !UUID_RE.test(b.familyId))) {
    return fail(404, "Payer form not found");
  }

  const input: PayerFormUploadIntentInput = {
    templateId: b.templateId,
    label: b.label,
    fileName: b.fileName,
    fileSize: b.fileSize,
    mimeType: b.mimeType,
    familyId: (b.familyId as string | undefined) ?? null,
  };
  const result = await createPayerFormUploadIntent(
    { db: ctx.db, orgId: ctx.orgId, userId: ctx.userId },
    input,
  );
  if (result.kind === "rejected") return fail(result.status, result.message);

  await ctx.writeAudit({
    actionType: "CREATE",
    entityType: "payer_form_upload_intent",
    entityId: result.value.familyId,
    after: {
      templateId: input.templateId,
      payerId: result.value.payerId,
      version: result.value.version,
    },
    description: "Signed payer form upload target issued",
  });

  const response = ok(result.value);
  response.headers.set("cache-control", "no-store");
  return response;
}

// POST /api/payer-forms/finalize — after the browser PUT to the signed target,
// verify the object and insert the immutable row. Idempotent: a retry returns
// the stored row (200) instead of inserting (201).
export async function handleFinalizePayerForm(body: unknown, ctx: AuthContext): Promise<Response> {
  if (!isGlobalAuthor(ctx)) return fail(403, "Only an admin can add payer forms");
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail(422, "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;
  if (typeof b.templateId !== "string" || !UUID_RE.test(b.templateId)) {
    return fail(404, "Template not found");
  }
  if (typeof b.familyId !== "string" || !UUID_RE.test(b.familyId)) {
    return fail(422, "familyId is required");
  }
  if (typeof b.version !== "number") return fail(422, "version is required");
  if (typeof b.label !== "string") return fail(422, "label is required");
  if (typeof b.fileName !== "string" || !b.fileName.trim()) {
    return fail(422, "fileName is required");
  }
  if (typeof b.mimeType !== "string") return fail(422, "mimeType is required");
  if (typeof b.fileSize !== "number") return fail(422, "fileSize is required");

  const input: FinalizePayerFormInput = {
    templateId: b.templateId,
    familyId: b.familyId,
    version: b.version,
    label: b.label,
    fileName: b.fileName,
    mimeType: b.mimeType,
    fileSize: b.fileSize,
  };
  const result = await finalizePayerForm(
    { db: ctx.db, orgId: ctx.orgId, userId: ctx.userId },
    input,
  );
  if (result.kind === "rejected") return fail(result.status, result.message);

  // One CREATE audit per NEW version; a replay re-runs no side effects.
  if (!result.replay) {
    await ctx.writeAudit({
      actionType: "CREATE",
      entityType: "payer_form",
      entityId: result.value.id,
      after: {
        templateId: result.value.templateId,
        payerId: result.value.payerId,
        familyId: result.value.familyId,
        version: result.value.version,
        label: result.value.label,
      },
      description: `Payer form ${result.value.version > 1 ? "replaced" : "added"}: ${result.value.label}`,
    });
  }

  const response = ok(result.value, null, result.replay ? 200 : 201);
  response.headers.set("cache-control", "no-store");
  return response;
}

// GET /api/payer-forms/:id/download — any org member gets a short-lived signed
// URL for one payer form. There is no cross-org 404 here BY DESIGN: the rows
// are global, so every member of every org may read the same blank payer form.
// A nonexistent id is still a 404 and nothing is signed or audited.
export async function handlePayerFormDownload(id: string, ctx: AuthContext): Promise<Response> {
  if (!UUID_RE.test(id)) return fail(404, "Payer form not found");
  const result = await signPayerFormDownload(
    { db: ctx.db, orgId: ctx.orgId, userId: ctx.userId },
    id,
  );
  if (!result) return fail(404, "Payer form not found");

  // One READ audit row per successful signing — never the URL. A failed audit
  // write throws → 500: no un-audited signed link leaves this handler.
  await ctx.writeAudit({
    actionType: "READ",
    entityType: "payer_form",
    entityId: result.form.id,
    after: {
      route: "/api/payer-forms/:id/download",
      payerId: result.form.payerId,
      templateId: result.form.templateId,
      version: result.form.version,
    },
    description: "Signed payer form download issued",
  });

  const response = ok({
    url: result.url,
    fileName: result.fileName,
    expiresIn: result.expiresIn,
  });
  response.headers.set("cache-control", "no-store");
  return response;
}
