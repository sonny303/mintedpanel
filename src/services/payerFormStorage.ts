// Payer PDF — the server-owned storage boundary for payer forms (service-role
// ctx, injected by the guarded /api routes; server-only, never imported
// client-side). Same three-step shape as documentStorage.ts, because a signed
// Storage URL cannot be minted in the browser:
//
//   1. createPayerFormUploadIntent — validate the template/label/file, resolve
//      the family + next version, SERVER-generate the object key, and mint a
//      short-lived signed upload target.
//   2. finalizePayerForm — verify the object exists at the derived path with an
//      allowed size/MIME before inserting the IMMUTABLE metadata row.
//      Idempotent: a retry that finds its row already inserted returns it.
//   3. signPayerFormDownload — row lookup, then a short-lived signed URL. No
//      permanent or public URL is ever stored or returned.
//
// WHAT ISOLATION MEANS HERE, and why it looks different from documentStorage:
// payer_forms rows are GLOBAL — they carry no org_id, so there is no org to
// scope a read to and a cross-org 404 would be meaningless. The wall is a role
// wall instead: only an ADMIN may write, and the route enforces that before
// calling in. Reads are open to any authenticated member by design (a blank
// payer form is global truth carrying no tenant data), exactly like
// GET /api/shared-portals.
//
// Audit rows are written by the route handlers, in the acting org.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { camelizeRow } from "@/lib/case";
import { safeFileName } from "@/lib/documents";
import {
  PAYER_FORM_BUCKET,
  PAYER_FORM_MAX_BYTES,
  PAYER_FORM_MIME_TYPES,
  PAYER_FORM_URL_TTL_SECONDS,
  nextPayerFormVersion,
  payerFormLabelError,
  payerFormObjectPath,
} from "@/lib/payerForms";
import type { PayerForm } from "@/types";

export interface PayerFormServiceCtx {
  db: SupabaseClient<Database>;
  orgId: string;
  userId: string;
}

export interface PayerFormUploadIntentInput {
  templateId: string;
  label: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  /** Present on the replace flow — versions an existing family. */
  familyId?: string | null;
}

export interface PayerFormUploadIntent {
  familyId: string;
  version: number;
  payerId: string;
  path: string;
  uploadUrl: string;
  token: string;
}

export interface FinalizePayerFormInput {
  templateId: string;
  familyId: string;
  version: number;
  label: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export type PayerFormResult<T> =
  | { kind: "ok"; value: T; replay?: boolean }
  | { kind: "rejected"; status: number; message: string };

const PAYER_FORM_COLUMNS =
  "id, template_id, payer_id, family_id, version, label, file_name, storage_path, mime_type, byte_size, supersedes_id, retired_at, retired_by, created_at, created_by";

interface FamilyRowRaw {
  id: string;
  family_id: string;
  version: number;
  template_id: string;
  payer_id: string;
  retired_at: string | null;
}

const FAMILY_COLUMNS = "id, family_id, version, template_id, payer_id, retired_at";

/** The template must exist and must name a payer — a template with no payer
 * has no payer forms to hold. Returns the payer id the Storage path uses. */
async function resolveTemplatePayer(
  ctx: PayerFormServiceCtx,
  templateId: string,
): Promise<{ payerId: string } | { status: number; message: string }> {
  const { data, error } = await ctx.db
    .from("sop_templates")
    .select("id, payer_id, archived")
    .eq("id", templateId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { status: 404, message: "Template not found" };
  const row = data as { payer_id: string | null; archived: boolean };
  if (row.archived) return { status: 422, message: "That template is archived" };
  if (!row.payer_id) {
    return {
      status: 422,
      message: "Payer forms need a template that targets a specific payer",
    };
  }
  return { payerId: row.payer_id };
}

function validateLabelAndFile(input: {
  label: string;
  mimeType: string;
  fileSize: number;
}): { status: number; message: string } | null {
  const labelError = payerFormLabelError(input.label);
  if (labelError) return { status: 422, message: labelError };
  if (!(PAYER_FORM_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    return { status: 422, message: "Payer forms must be PDF files" };
  }
  if (input.fileSize <= 0 || input.fileSize > PAYER_FORM_MAX_BYTES) {
    return {
      status: 422,
      message: `Files are limited to ${Math.floor(PAYER_FORM_MAX_BYTES / (1024 * 1024))} MB`,
    };
  }
  return null;
}

/** Every row in a family. A family never changes template or payer. */
async function loadFamily(ctx: PayerFormServiceCtx, familyId: string): Promise<FamilyRowRaw[]> {
  const { data, error } = await ctx.db
    .from("payer_forms")
    .select(FAMILY_COLUMNS)
    .eq("family_id", familyId);
  if (error) throw error;
  return (data ?? []) as FamilyRowRaw[];
}

export async function createPayerFormUploadIntent(
  ctx: PayerFormServiceCtx,
  input: PayerFormUploadIntentInput,
): Promise<PayerFormResult<PayerFormUploadIntent>> {
  const invalid = validateLabelAndFile(input);
  if (invalid) return { kind: "rejected", ...invalid };

  const resolved = await resolveTemplatePayer(ctx, input.templateId);
  if ("status" in resolved) return { kind: "rejected", ...resolved };

  let familyId = input.familyId ?? null;
  let version = 1;
  if (familyId) {
    const family = await loadFamily(ctx, familyId);
    if (family.length === 0) {
      return { kind: "rejected", status: 404, message: "Payer form not found" };
    }
    // A replacement stays inside its own template — otherwise a family could be
    // walked from one payer's template onto another's.
    if (family.some((r) => r.template_id !== input.templateId)) {
      return {
        kind: "rejected",
        status: 422,
        message: "A replacement must stay on the same template",
      };
    }
    version = nextPayerFormVersion(
      family.map((r) => ({ id: r.id, familyId: r.family_id, version: r.version })),
    );
  } else {
    familyId = crypto.randomUUID();
  }

  const path = payerFormObjectPath({
    payerId: resolved.payerId,
    familyId,
    version,
    fileName: input.fileName,
  });
  const { data, error } = await ctx.db.storage.from(PAYER_FORM_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    throw new Error(`Failed to create a signed upload target: ${error?.message ?? "no data"}`);
  }
  return {
    kind: "ok",
    value: {
      familyId,
      version,
      payerId: resolved.payerId,
      path,
      uploadUrl: data.signedUrl,
      token: data.token,
    },
  };
}

export async function finalizePayerForm(
  ctx: PayerFormServiceCtx,
  input: FinalizePayerFormInput,
): Promise<PayerFormResult<PayerForm>> {
  const invalid = validateLabelAndFile(input);
  if (invalid) return { kind: "rejected", ...invalid };
  if (!Number.isInteger(input.version) || input.version < 1) {
    return { kind: "rejected", status: 422, message: "version must be a positive integer" };
  }

  const resolved = await resolveTemplatePayer(ctx, input.templateId);
  if ("status" in resolved) return { kind: "rejected", ...resolved };

  const family = await loadFamily(ctx, input.familyId);
  if (family.length > 0 && family.some((r) => r.template_id !== input.templateId)) {
    return {
      kind: "rejected",
      status: 422,
      message: "A replacement must stay on the same template",
    };
  }

  // Idempotent replay: the row already exists at this (family, version).
  const existing = family.find((r) => r.version === input.version);
  if (existing) {
    const { data: existingRow, error: exErr } = await ctx.db
      .from("payer_forms")
      .select(PAYER_FORM_COLUMNS)
      .eq("id", existing.id)
      .maybeSingle();
    if (exErr) throw exErr;
    if (existingRow) {
      return { kind: "ok", value: camelizeRow<PayerForm>(existingRow), replay: true };
    }
  }

  // The object must exist at the SERVER-derived path with an allowed size and
  // the declared MIME type — metadata is never written for a missing or
  // misdescribed object.
  const path = payerFormObjectPath({
    payerId: resolved.payerId,
    familyId: input.familyId,
    version: input.version,
    fileName: input.fileName,
  });
  const storedName = safeFileName(input.fileName);
  const parent = path.slice(0, path.length - storedName.length - 1);
  const { data: objects, error: listErr } = await ctx.db.storage
    .from(PAYER_FORM_BUCKET)
    .list(parent, { search: storedName });
  if (listErr) throw listErr;
  const object = (objects ?? []).find((o) => o.name === storedName);
  if (!object) {
    return { kind: "rejected", status: 422, message: "The uploaded file was not found in storage" };
  }
  const objectMeta = (object.metadata ?? {}) as { size?: number; mimetype?: string };
  const size = typeof objectMeta.size === "number" ? objectMeta.size : null;
  const mimetype = typeof objectMeta.mimetype === "string" ? objectMeta.mimetype : null;
  if (size !== null && (size <= 0 || size > PAYER_FORM_MAX_BYTES)) {
    return { kind: "rejected", status: 422, message: "The uploaded file exceeds the size limit" };
  }
  if (mimetype !== null && mimetype !== input.mimeType) {
    return {
      kind: "rejected",
      status: 422,
      message: "The uploaded file does not match its declared type",
    };
  }

  // The row this version supersedes: the family's highest EXISTING version.
  const head = [...family].sort((a, b) => b.version - a.version)[0] ?? null;
  const insert: Database["public"]["Tables"]["payer_forms"]["Insert"] = {
    template_id: input.templateId,
    payer_id: resolved.payerId,
    family_id: input.familyId,
    version: input.version,
    label: input.label.trim(),
    file_name: storedName,
    storage_path: path,
    mime_type: input.mimeType,
    byte_size: size ?? input.fileSize,
    supersedes_id: head?.id ?? null,
    created_by: ctx.userId,
  };
  const { data: inserted, error: insertErr } = await ctx.db
    .from("payer_forms")
    .insert(insert)
    .select(PAYER_FORM_COLUMNS)
    .single();
  if (insertErr) {
    // 23505 on (family, version): a concurrent retry won the race — return the
    // stored row instead of failing.
    if ((insertErr as { code?: string }).code === "23505") {
      const { data: raced, error: racedErr } = await ctx.db
        .from("payer_forms")
        .select(PAYER_FORM_COLUMNS)
        .eq("family_id", input.familyId)
        .eq("version", input.version)
        .maybeSingle();
      if (racedErr) throw racedErr;
      if (raced) return { kind: "ok", value: camelizeRow<PayerForm>(raced), replay: true };
    }
    throw insertErr;
  }
  return { kind: "ok", value: camelizeRow<PayerForm>(inserted) };
}

export interface SignedPayerFormDownload {
  url: string;
  fileName: string;
  expiresIn: number;
  form: PayerForm;
}

export async function signPayerFormDownload(
  ctx: PayerFormServiceCtx,
  formId: string,
): Promise<SignedPayerFormDownload | null> {
  // Global rows: no org filter, by design. A retired form still downloads —
  // a case generated before the retirement still points at it, and the whole
  // point of soft-retire is that the file stays reachable.
  const { data: row, error } = await ctx.db
    .from("payer_forms")
    .select(PAYER_FORM_COLUMNS)
    .eq("id", formId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const form = camelizeRow<PayerForm>(row);
  const { data: signed, error: signErr } = await ctx.db.storage
    .from(PAYER_FORM_BUCKET)
    .createSignedUrl(form.storagePath, PAYER_FORM_URL_TTL_SECONDS, {
      download: form.fileName,
    });
  if (signErr || !signed) {
    throw new Error(`Failed to sign the payer form download: ${signErr?.message ?? "no data"}`);
  }
  return {
    url: signed.signedUrl,
    fileName: form.fileName,
    expiresIn: PAYER_FORM_URL_TTL_SECONDS,
    form,
  };
}
