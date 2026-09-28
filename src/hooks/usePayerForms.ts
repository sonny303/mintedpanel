// Payer PDF hooks — the template editor's form list plus the upload / replace /
// retire mutations and the signed download.
//
// The download is a MUTATION, not a query, on purpose: a signed URL expires in
// seconds and every issue writes an audit row, so it must never sit in a cache
// and must never be re-fetched on a window focus. Same posture as the documents
// download.
import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveOrgId, useAuthStore } from "@/lib/auth-store";
import { currentUserId, requireActiveOrg } from "@/lib/audit";
import { queryKeys } from "@/hooks/queryKeys";
import { planPayerFormFill } from "@/lib/payerFormFill";
import { downloadPayerFormOutput, preparePayerFormFill } from "@/lib/payerFormFillClient";
import { fetchPdfBytes } from "@/lib/pdfFieldImportClient";
import { pdfFormPortalKey } from "@/lib/pdfFieldImport";
import { FILL_EVENT_V2_LIMIT_ERROR, MAX_FILL_EVENT_V2_FIELD_OUTCOMES } from "@/types/fillEventV2";
import type { FillEventV2Metadata } from "@/types/fillEventV2";
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

interface PendingPdfFillRecord {
  id: string;
  orgId: string;
  userId: string;
  startedAt: string;
  completedAt: string;
  caseId: string;
  providerId: string | null;
  portalKey: string;
  isTest: boolean;
  event: FillEventV2Metadata;
  written: number;
  rejectedCount: number;
  needsReviewCount: number;
}

// Kept in process memory only. It holds bounded outcomes and identifiers, no
// PDF bytes, selectors, labels, or provider values. Retrying reuses its ID.
const pendingPdfFillRecords = new Map<string, PendingPdfFillRecord>();
let fillContextGeneration = 0;

function pendingPdfKey(
  orgId: string,
  userId: string,
  caseId: string,
  formId: string,
  isTest: boolean,
): string {
  return [isTest ? "test" : "case", orgId, userId, caseId, formId].join(":");
}

useAuthStore.subscribe((state, previous) => {
  if (state.activeOrgId !== previous.activeOrgId || state.user?.id !== previous.user?.id) {
    fillContextGeneration += 1;
    pendingPdfFillRecords.clear();
  }
});

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
  /** False after the owning case/form action changes or unmounts. */
  isCurrent?: () => boolean;
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
 * Recording stores bounded, value-free field outcomes, and the case is
 * untouched: a fill is not a send, so nothing here completes the task or moves
 * the case status. Generated bytes stay in memory until the local download.
 */
export function useFillPayerForm() {
  const qc = useQueryClient();
  const orgId = useActiveOrgId() ?? "no-org";
  const userId = useAuthStore((state) => state.user?.id ?? "no-user");
  const mutation = useMutation({
    mutationFn: async (vars: FillPayerFormVars) => {
      const originalOrgId = requireActiveOrg();
      const originalUserId = currentUserId();
      if (originalOrgId !== orgId || !originalUserId || originalUserId !== userId) {
        throw new Error(
          "The active organization or user changed. Start a new fill in the current context.",
        );
      }
      const contextGenerationAtStart = fillContextGeneration;
      const assertCurrent = (): boolean => {
        if (
          fillContextGeneration !== contextGenerationAtStart ||
          vars.isCurrent?.() === false ||
          requireActiveOrg() !== originalOrgId ||
          currentUserId() !== originalUserId
        ) {
          throw new Error(
            "The active fill context changed. Start a new fill in the current context.",
          );
        }
        return true;
      };
      const key = pendingPdfKey(
        originalOrgId,
        originalUserId,
        vars.caseId,
        vars.formId,
        Boolean(vars.isTest),
      );
      const pending = pendingPdfFillRecords.get(key);
      if (pending) {
        assertCurrent();
        if (pending.isTest) {
          await recordTestFillFromApp({
            id: pending.id,
            expectedOrgId: pending.orgId,
            expectedUserId: pending.userId,
            providerId: null,
            portalKey: pending.portalKey,
            fieldsFilled: 0,
            fieldsSkipped: [],
            fillMode: "pdf",
            startedAt: pending.startedAt,
            completedAt: pending.completedAt,
            event: pending.event,
            isCurrent: assertCurrent,
          });
        } else {
          await recordPayerFormFill({
            id: pending.id,
            orgId: pending.orgId,
            userId: pending.userId,
            startedAt: pending.startedAt,
            completedAt: pending.completedAt,
            caseId: pending.caseId,
            providerId: pending.providerId,
            portalKey: pending.portalKey,
            event: pending.event,
            isCurrent: assertCurrent,
          });
        }
        assertCurrent();
        pendingPdfFillRecords.delete(key);
        return {
          written: pending.written,
          rejectedCount: pending.rejectedCount,
          needsReviewCount: pending.needsReviewCount,
          recordingRetried: true as const,
        };
      }

      const plan = planPayerFormFill(vars.rows, vars.tokenValues);
      if (
        plan.entries.filter((entry) => entry.outcome !== "stale").length >
        MAX_FILL_EVENT_V2_FIELD_OUTCOMES
      ) {
        throw new Error(FILL_EVENT_V2_LIMIT_ERROR);
      }

      const id = globalThis.crypto.randomUUID();
      const startedAt = new Date().toISOString();
      const signed = await getPayerFormDownload(vars.formId);
      assertCurrent();
      const bytes = await fetchPdfBytes(signed.url);
      assertCurrent();
      const result = await preparePayerFormFill(bytes, plan);
      assertCurrent();
      // No await or event-loop turn separates this context check from the
      // browser download, so a stale run cannot hand a generated file to a
      // different case, organization, or user.
      downloadPayerFormOutput(result.output, vars.fileStem);
      const portalKey = pdfFormPortalKey(vars.familyId);
      const completedAt = new Date().toISOString();
      const record: PendingPdfFillRecord = {
        id,
        orgId: originalOrgId,
        userId: originalUserId,
        startedAt,
        completedAt,
        caseId: vars.caseId,
        providerId: vars.providerId,
        portalKey,
        isTest: Boolean(vars.isTest),
        event: result.event,
        written: result.written,
        rejectedCount: result.rejected.length,
        needsReviewCount:
          plan.manualLabels.length + plan.fieldsSkipped.length + result.rejected.length,
      };
      assertCurrent();
      pendingPdfFillRecords.set(key, record);
      if (vars.isTest) {
        await recordTestFillFromApp({
          id,
          expectedOrgId: originalOrgId,
          expectedUserId: originalUserId,
          providerId: null,
          portalKey,
          fieldsFilled: 0,
          fieldsSkipped: [],
          fillMode: "pdf",
          startedAt,
          completedAt,
          event: result.event,
          isCurrent: assertCurrent,
        });
      } else {
        await recordPayerFormFill({
          id,
          orgId: originalOrgId,
          userId: originalUserId,
          startedAt,
          completedAt,
          caseId: vars.caseId,
          providerId: vars.providerId,
          portalKey,
          event: result.event,
          isCurrent: assertCurrent,
        });
      }
      assertCurrent();
      pendingPdfFillRecords.delete(key);
      return {
        plan,
        ...result,
        rejectedCount: result.rejected.length,
        needsReviewCount:
          plan.manualLabels.length + plan.fieldsSkipped.length + result.rejected.length,
        recordingRetried: false,
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.lastFills(orgId) });
      qc.invalidateQueries({ queryKey: ["audit-log", orgId] });
    },
  });
  const hasPendingRecording = useCallback(
    (caseId: string, formId: string, isTest = false) =>
      pendingPdfFillRecords.has(pendingPdfKey(orgId, userId, caseId, formId, isTest)),
    [orgId, userId],
  );
  const clearPendingRecording = useCallback(
    (caseId: string, formId: string, isTest = false) =>
      pendingPdfFillRecords.delete(pendingPdfKey(orgId, userId, caseId, formId, isTest)),
    [orgId, userId],
  );
  const getPendingRecordingSummary = useCallback(
    (caseId: string, formId: string, isTest = false) => {
      const pending = pendingPdfFillRecords.get(
        pendingPdfKey(orgId, userId, caseId, formId, isTest),
      );
      return pending
        ? {
            written: pending.written,
            rejectedCount: pending.rejectedCount,
            needsReviewCount: pending.needsReviewCount,
          }
        : null;
    },
    [orgId, userId],
  );
  return {
    ...mutation,
    hasPendingRecording,
    clearPendingRecording,
    getPendingRecordingSummary,
  };
}
