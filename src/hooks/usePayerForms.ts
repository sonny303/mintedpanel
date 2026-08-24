// Payer PDF hooks — the template editor's form list plus the upload / replace /
// retire mutations and the signed download.
//
// The download is a MUTATION, not a query, on purpose: a signed URL expires in
// seconds and every issue writes an audit row, so it must never sit in a cache
// and must never be re-fetched on a window focus. Same posture as the documents
// download.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId } from "@/lib/auth-store";
import { queryKeys } from "@/hooks/queryKeys";
import {
  getPayerFormDownload,
  listCurrentTemplatePayerForms,
  retirePayerForm,
  uploadPayerForm,
  type SignedPayerFormDownload,
  type UploadPayerFormInput,
} from "@/services/payerForms";
import type { PayerForm } from "@/types";

const THIRTY_SECONDS = 30_000;

/** The LIVE payer forms for one template (current version per family). */
export function useTemplatePayerForms(templateId: string | undefined) {
  const orgId = useActiveOrgId() ?? "no-org";
  return useQuery({
    queryKey: queryKeys.payerForms(orgId, templateId ?? ""),
    queryFn: () => listCurrentTemplatePayerForms(templateId as string),
    enabled: orgId !== "no-org" && Boolean(templateId),
    staleTime: THIRTY_SECONDS,
  });
}

/** Upload a new payer form, or a new version of an existing one when
 * `familyId` is set (the replace flow). */
export function useUploadPayerForm() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (input: UploadPayerFormInput) => uploadPayerForm(input),
    onSuccess: (_form, input) => {
      qc.invalidateQueries({ queryKey: queryKeys.payerForms(orgId, input.templateId) });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

/** Soft-retire a payer form. The row and its file stay, so cases generated
 * earlier still download exactly what they were generated with. */
export function useRetirePayerForm() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: (form: PayerForm) => retirePayerForm(form),
    onSuccess: (form) => {
      qc.invalidateQueries({ queryKey: queryKeys.payerForms(orgId, form.templateId) });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}

/** One short-lived signed download URL. */
export function usePayerFormDownload() {
  return useMutation<SignedPayerFormDownload, Error, string>({
    mutationFn: (formId: string) => getPayerFormDownload(formId),
  });
}
