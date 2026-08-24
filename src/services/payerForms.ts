// Payer PDF — the browser payer-forms service. Same two data paths as the
// documents service, for the same reason:
//   * Metadata reads and the RETIRE write ride the standard externalClient
//     path under RLS. `payer_forms` rows are GLOBAL (no org_id), so the read
//     policy is `true` and the retire policy gates on `user_is_admin_anywhere()`
//     — there is no org filter to apply here and adding one would be a lie.
//   * The SIGNED actions — upload intent, finalize, download — call the narrow
//     /api/payer-forms/* endpoints, because a signed Storage URL cannot be
//     minted in the browser and the server owns the object-key contract.
// Upload bytes go straight from the browser to the signed Storage URL; file
// contents never pass through the nitro server.
import { supabase } from "@/integrations/supabase/externalClient";
import { camelizeRow } from "@/lib/case";
import { requireActiveOrg, writeAudit } from "@/lib/audit";
import { currentPayerForms } from "@/lib/payerForms";
import type { PayerForm } from "@/types";

const PAYER_FORM_COLUMNS =
  "id, template_id, payer_id, family_id, version, label, file_name, storage_path, " +
  "mime_type, byte_size, supersedes_id, retired_at, retired_by, created_at, created_by";

/** Every version for one template, newest first. "Current" is derived by the
 * pure lib (`currentPayerForms`), never filtered here — the editor needs the
 * history to know what a replace supersedes. */
export async function listTemplatePayerForms(templateId: string): Promise<PayerForm[]> {
  const { data, error } = await supabase
    .from("payer_forms")
    .select(PAYER_FORM_COLUMNS)
    .eq("template_id", templateId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return camelizeRow<PayerForm[]>(data ?? []);
}

/** The live forms for one template — what the Template Editor lists and what
 * generation attaches. */
export async function listCurrentTemplatePayerForms(templateId: string): Promise<PayerForm[]> {
  return currentPayerForms(await listTemplatePayerForms(templateId));
}

/** Live forms for MANY templates in one read — the generation path resolves a
 * whole run's templates at once rather than N round trips. */
export async function listPayerFormsForTemplates(
  templateIds: readonly string[],
): Promise<Map<string, PayerForm[]>> {
  const unique = [...new Set(templateIds)].filter(Boolean);
  const byTemplate = new Map<string, PayerForm[]>();
  if (unique.length === 0) return byTemplate;
  const { data, error } = await supabase
    .from("payer_forms")
    .select(PAYER_FORM_COLUMNS)
    .in("template_id", unique)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = camelizeRow<PayerForm[]>(data ?? []);
  for (const templateId of unique) {
    byTemplate.set(templateId, currentPayerForms(rows.filter((r) => r.templateId === templateId)));
  }
  return byTemplate;
}

/** Soft-delete: retire the family's current version. The row and its object
 * stay, so a case generated earlier still downloads the exact file it was
 * generated with. Admin-only — enforced by the payer_forms_retire policy, and
 * the immutability trigger rejects any other column change. */
export async function retirePayerForm(form: PayerForm): Promise<PayerForm> {
  // Audit lands in the ACTING org even though the row is global: "who retired
  // this, from where" is exactly what an org's audit trail should record.
  // requireActiveOrg() is the guard that there IS an acting org to audit into,
  // not a filter — the row itself has no org.
  requireActiveOrg();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id ?? null;
  const { data, error } = await supabase
    .from("payer_forms")
    .update({ retired_at: new Date().toISOString(), retired_by: userId })
    .eq("id", form.id)
    .select(PAYER_FORM_COLUMNS)
    .single();
  if (error) throw error;
  const retired = camelizeRow<PayerForm>(data);
  await writeAudit({
    actionType: "DELETE",
    entityType: "payer_form",
    entityId: retired.id,
    before: { label: form.label, retiredAt: form.retiredAt },
    after: { label: retired.label, retiredAt: retired.retiredAt },
    description: `Payer form retired: ${retired.label}`,
  });
  return retired;
}

// ---------------------------------------------------------------------------
// The signed actions — /api through the same-origin nitro server, with the
// caller's JWT + active org.
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

export interface PayerFormUploadIntent {
  familyId: string;
  version: number;
  payerId: string;
  path: string;
  uploadUrl: string;
  token: string;
}

export interface UploadPayerFormInput {
  templateId: string;
  label: string;
  file: File;
  /** Replace flow: version an existing family. */
  familyId?: string | null;
}

/** intent → signed PUT (browser → Storage direct) → finalize. A finalize retry
 * is idempotent server-side. */
export async function uploadPayerForm(input: UploadPayerFormInput): Promise<PayerForm> {
  const intent = await authedApiFetch<PayerFormUploadIntent>("/api/payer-forms/upload-intent", {
    method: "POST",
    body: JSON.stringify({
      templateId: input.templateId,
      label: input.label,
      fileName: input.file.name,
      fileSize: input.file.size,
      mimeType: input.file.type,
      familyId: input.familyId ?? null,
    }),
  });

  const put = await fetch(intent.uploadUrl, {
    method: "PUT",
    headers: { "content-type": input.file.type },
    body: input.file,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);

  return authedApiFetch<PayerForm>("/api/payer-forms/finalize", {
    method: "POST",
    body: JSON.stringify({
      templateId: input.templateId,
      familyId: intent.familyId,
      version: intent.version,
      label: input.label,
      fileName: input.file.name,
      mimeType: input.file.type,
      fileSize: input.file.size,
    }),
  });
}

export interface SignedPayerFormDownload {
  url: string;
  fileName: string;
  expiresIn: number;
}

/** One short-lived, audited signed URL for one payer form. Called from a
 * MUTATION-style action, never a query — the URL expires in seconds and every
 * issue is audited, so it must not sit in a cache. */
export async function getPayerFormDownload(formId: string): Promise<SignedPayerFormDownload> {
  return authedApiFetch<SignedPayerFormDownload>(`/api/payer-forms/${formId}/download`, {
    method: "GET",
  });
}
