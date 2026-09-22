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
import { planPayerFormFill } from "@/lib/payerFormFill";
import { fillAndDownloadPayerForm } from "@/lib/payerFormFillClient";
import { fetchPdfBytes } from "@/lib/pdfFieldImportClient";
import { pdfFormPortalKey } from "@/lib/pdfFieldImport";
import { recordPayerFormFill, recordTestFillFromApp } from "@/services/fillSessions";
import type { RegistryRow } from "@/lib/fieldRegistry";
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
      qc.invalidateQueries({ queryKey: queryKeys.payerForms(orgId, form.templateId ?? "") });
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

export interface FillPayerFormVars {
  /** The BAKED form row on this case — the exact version it was generated with. */
  formId: string;
  familyId: string;
  caseId: string;
  providerId: string | null;
  /** The family's trained registry rows. */
  rows: readonly RegistryRow[];
  tokenValues: Readonly<Record<string, string>>;
  fileStem: string;
  /** A sample fill: synthetic values, logged `is_test`, no case attached. */
  isTest?: boolean;
}

/**
 * E6.11 B6/B7 — fill the case's payer PDF in the browser and download it.
 *
 * The whole fill lives in this tab: signed URL → bytes → plan → filled bytes →
 * local download. The filled file is PHI-dense and is never uploaded (the
 * payer-forms bucket holds BLANK global forms), never logged, and left editable
 * so the coordinator finishes and submits it themselves — the extension's
 * "the human submits" rule, applied to paper.
 *
 * Recording is counts-only, and the case is untouched: a fill is not a send, so
 * nothing here completes the task or moves the case status.
 */
export function useFillPayerForm() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  return useMutation({
    mutationFn: async (vars: FillPayerFormVars) => {
      const plan = planPayerFormFill(vars.rows, vars.tokenValues);
      const signed = await getPayerFormDownload(vars.formId);
      const bytes = await fetchPdfBytes(signed.url);
      const result = await fillAndDownloadPayerForm(bytes, plan, vars.fileStem);
      const portalKey = pdfFormPortalKey(vars.familyId);
      if (vars.isTest) {
        await recordTestFillFromApp({
          providerId: null,
          portalKey,
          fieldsFilled: plan.fieldsFilled,
          fieldsSkipped: plan.fieldsSkipped,
          fillMode: "pdf",
        });
      } else {
        await recordPayerFormFill({
          caseId: vars.caseId,
          providerId: vars.providerId,
          portalKey,
          fieldsFilled: plan.fieldsFilled,
          fieldsSkipped: plan.fieldsSkipped,
        });
      }
      return { plan, ...result };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.lastFills(orgId) });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
}
