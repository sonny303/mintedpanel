import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  downloadEnrollmentProof,
  fetchUnresolvedEnrollmentPage,
  publishEnrollmentProof,
  publishEnrollmentSummary,
  revokeEnrollmentPublication,
  saveEnrollmentScope,
} from "@/lib/enrollmentExplorerApi";
import {
  useEnrollmentReportContext,
  useEnrollmentScopeDetail,
  useEnrollmentScopeHistory,
} from "@/hooks/useEnrollmentReport";
import { useProviderDocuments, useGroupDocuments } from "@/hooks/useDocuments";
import { useDocumentDownload } from "@/hooks/useDocuments";
import { useAuthStore } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  EnrollmentEvidenceKind,
  EnrollmentActionOwner,
  EnrollmentProofField,
  EnrollmentRevisionDraft,
  EnrollmentScopeDetail,
  EnrollmentScopeHistoryStaffItem,
  EnrollmentSourceLink,
  EnrollmentUnresolvedCursor,
} from "@/types";

const EVIDENCE_KINDS: Array<{ value: EnrollmentEvidenceKind; label: string }> = [
  { value: "payer_approval_letter", label: "Payer approval letter" },
  { value: "payer_roster_confirmation", label: "Payer roster confirmation" },
  { value: "payer_acknowledgement", label: "Payer acknowledgement" },
  { value: "license_psv", label: "License PSV" },
];

const PROOF_FIELDS: Array<{ value: EnrollmentProofField; label: string }> = [
  { value: "enrollment_status", label: "Enrollment status" },
  { value: "payer_reference", label: "Payer reference" },
  { value: "submitted_date", label: "Submitted date" },
  { value: "payer_acknowledged_date", label: "Payer acknowledged date" },
  { value: "approved_date", label: "Approved date" },
  { value: "effective_date", label: "Effective date" },
  { value: "termination_date", label: "Termination date" },
  { value: "product_id", label: "Payer product" },
  { value: "facility_id", label: "Facility" },
  { value: "retro_status", label: "Retroactive status" },
  { value: "retro_days", label: "Retroactive days" },
  { value: "retro_date", label: "Retroactive date" },
  { value: "license_current", label: "Current license" },
];

const EVIDENCE_FIELDS: Record<EnrollmentEvidenceKind, EnrollmentProofField[]> = {
  payer_approval_letter: PROOF_FIELDS.filter((field) => field.value !== "license_current").map(
    (field) => field.value,
  ),
  payer_roster_confirmation: PROOF_FIELDS.filter((field) => field.value !== "license_current").map(
    (field) => field.value,
  ),
  payer_acknowledgement: ["submitted_date", "payer_acknowledged_date", "payer_reference"],
  license_psv: ["license_current"],
};

const DEFAULT_EVIDENCE_FIELDS: Record<EnrollmentEvidenceKind, EnrollmentProofField[]> = {
  payer_approval_letter: ["enrollment_status", "product_id", "facility_id"],
  payer_roster_confirmation: ["enrollment_status", "product_id", "facility_id"],
  payer_acknowledgement: ["submitted_date", "payer_acknowledged_date", "payer_reference"],
  license_psv: ["license_current"],
};

function isStaffDetail(
  detail: EnrollmentScopeDetail,
): detail is Extract<EnrollmentScopeDetail, { scope: unknown }> {
  return "scope" in detail;
}

function scopeIdentity(detail: EnrollmentScopeDetail) {
  return isStaffDetail(detail)
    ? detail.scope
    : {
        id: detail.scopeId,
        providerId: detail.providerId,
        groupId: detail.groupId,
        payerProductId: detail.payerProductId,
        facilityId: detail.facilityId,
        state: detail.state,
      };
}

function revisionValue(
  detail: Extract<EnrollmentScopeDetail, { scope: unknown }>,
  key: string,
): string {
  const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  const value = detail.revision[key] ?? detail.revision[snakeKey];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

function StaffRevisionEditor({
  detail,
  onSaved,
}: {
  detail: Extract<EnrollmentScopeDetail, { scope: unknown }>;
  onSaved: () => void;
}) {
  const context = useEnrollmentReportContext();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [nextStatus, setNextStatus] = useState(revisionValue(detail, "status"));
  const sourceQuery = useInfiniteQuery({
    queryKey: [
      "enrollment-revision-sources",
      context?.orgId,
      context?.contextRevision,
      detail.scope.groupId,
    ],
    enabled: Boolean(context?.audience === "staff"),
    initialPageParam: null as EnrollmentUnresolvedCursor | null,
    queryFn: ({ pageParam, signal }) => {
      if (!context) throw new Error("Staff context is unavailable");
      return fetchUnresolvedEnrollmentPage(
        context,
        { groupId: detail.scope.groupId, cursor: pageParam, limit: 30 },
        { signal },
      );
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const sourceItems = sourceQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const choices = useMemo(() => {
    const byKey = new Map<
      string,
      { link: EnrollmentSourceLink; snapshot: Record<string, unknown>; current: boolean }
    >();
    for (const source of detail.sources) {
      const key = `${source.sourceKind}:${source.sourceId}:${source.sourceFingerprint}`;
      byKey.set(key, { link: source, snapshot: source.sourceSnapshot, current: true });
    }
    for (const source of sourceItems) {
      const key = `${source.sourceKind}:${source.sourceId}:${source.sourceFingerprint}`;
      byKey.set(key, {
        link: {
          sourceKind: source.sourceKind,
          sourceId: source.sourceId,
          sourceFingerprint: source.sourceFingerprint,
        },
        snapshot: source.sourceSnapshot,
        current: true,
      });
    }
    return [...byKey.entries()].map(([key, value]) => ({ key, ...value }));
  }, [detail.sources, sourceItems]);
  const [selectedLinks, setSelectedLinks] = useState<string[]>(() =>
    detail.sources.map(
      (source) => `${source.sourceKind}:${source.sourceId}:${source.sourceFingerprint}`,
    ),
  );
  const currentFingerprints = new Map(
    sourceItems.map((item) => [`${item.sourceKind}:${item.sourceId}`, item.sourceFingerprint]),
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!context) return;
    const form = new FormData(event.currentTarget);
    const revision: EnrollmentRevisionDraft = {
      status: String(form.get("status")) as EnrollmentRevisionDraft["status"],
      owner: String(form.get("owner")) as EnrollmentActionOwner,
      retroStatus: String(form.get("retroStatus")) as EnrollmentRevisionDraft["retroStatus"],
      intakeDate: String(form.get("intakeDate") || "") || null,
      completeToSubmitDate: String(form.get("completeToSubmitDate") || "") || null,
      submittedDate: String(form.get("submittedDate") || "") || null,
      payerAcknowledgedDate: String(form.get("payerAcknowledgedDate") || "") || null,
      approvedDate: String(form.get("approvedDate") || "") || null,
      effectiveDate: String(form.get("effectiveDate") || "") || null,
      terminationDate: String(form.get("terminationDate") || "") || null,
      payerReference: String(form.get("payerReference") || "") || null,
      clientSafeBlocker: String(form.get("clientSafeBlocker") || "") || null,
      retroDays: String(form.get("retroDays") || "") ? Number(form.get("retroDays")) : null,
      retroDate: String(form.get("retroDate") || "") || null,
      retroBasis: String(form.get("retroBasis") || "") || null,
      staffNote: String(form.get("staffNote") || "") || null,
    };
    const sources = choices
      .filter((choice) => selectedLinks.includes(choice.key))
      .map((choice) => choice.link);
    setSaving(true);
    setMessage("");
    try {
      const result = await saveEnrollmentScope(context, {
        scopeId: detail.scope.id,
        expectedRevisionId: detail.scope.currentRevisionId,
        providerId: detail.scope.providerId,
        groupId: detail.scope.groupId,
        payerProductId: detail.scope.payerProductId,
        facilityId: detail.scope.facilityId,
        state: detail.scope.state,
        revision,
        sources,
      });
      setMessage(`Revision ${String(result.revisionNo ?? "")} saved.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["enrollment-scope-detail"] }),
        queryClient.invalidateQueries({ queryKey: ["enrollment-scope-history"] }),
        queryClient.invalidateQueries({ queryKey: ["enrollment-report-page"] }),
        queryClient.invalidateQueries({ queryKey: ["enrollment-unresolved"] }),
      ]);
      onSaved();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Revision could not be saved. Reload the scope and review source fingerprints.",
      );
    } finally {
      setSaving(false);
    }
  };

  const previousStatus = revisionValue(detail, "status");
  const startsNewCycle =
    ["denied", "not_pursuing", "terminated"].includes(previousStatus) &&
    ["not_started", "in_progress"].includes(nextStatus);

  return (
    <details className="mt-4 rounded-md border p-3">
      <summary className="cursor-pointer text-[12px] font-semibold">
        Append a corrected or restarted revision
      </summary>
      {detail.stale ? (
        <p className="mt-2 rounded bg-amber-50 p-2 text-[11px] text-amber-900">
          This source set is stale. Existing links remain selected. Replace changed fingerprints or
          explicitly remove invalid links before saving.
        </p>
      ) : null}
      <form
        onSubmit={(event) => void submit(event)}
        className="mt-3 space-y-3"
        data-testid="enrollment-revision-form"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
            Status
            <select
              name="status"
              value={nextStatus}
              onChange={(event) => setNextStatus(event.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-[12px] text-foreground"
            >
              {[
                "not_started",
                "in_progress",
                "submitted",
                "in_review",
                "action_required",
                "approved",
                "denied",
                "not_pursuing",
                "terminated",
              ].map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
            Action owner
            <select
              name="owner"
              defaultValue={revisionValue(detail, "actionOwner")}
              className="h-9 rounded-md border bg-background px-2 text-[12px] text-foreground"
            >
              {["Minted", "Client", "Payer", "Complete", "Unassigned"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
            Retroactive status
            <select
              name="retroStatus"
              defaultValue={revisionValue(detail, "retroStatus") || "unknown"}
              className="h-9 rounded-md border bg-background px-2 text-[12px] text-foreground"
            >
              {["unknown", "not_supported", "documented"].map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              "intakeDate",
              "completeToSubmitDate",
              "submittedDate",
              "payerAcknowledgedDate",
              "approvedDate",
              "effectiveDate",
              "terminationDate",
            ] as const
          ).map((key) => (
            <label
              key={key}
              className="grid gap-1 text-[10px] font-medium capitalize text-muted-foreground"
            >
              {key.replace(/([A-Z])/g, " $1")}
              <Input
                name={key}
                type="date"
                defaultValue={revisionValue(detail, key)}
                className="h-9 text-[12px]"
              />
            </label>
          ))}
          <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
            Payer reference
            <Input
              name="payerReference"
              defaultValue={revisionValue(detail, "payerReference")}
              className="h-9 text-[12px]"
            />
          </label>
          <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
            Retroactive days
            <Input
              name="retroDays"
              type="number"
              min="0"
              defaultValue={revisionValue(detail, "retroDays")}
              className="h-9 text-[12px]"
            />
          </label>
          <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
            Retroactive date
            <Input
              name="retroDate"
              type="date"
              defaultValue={revisionValue(detail, "retroDate")}
              className="h-9 text-[12px]"
            />
          </label>
          <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
            Retroactive basis
            <Input
              name="retroBasis"
              defaultValue={revisionValue(detail, "retroBasis")}
              className="h-9 text-[12px]"
            />
          </label>
          <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
            Client-safe next step
            <Input
              name="clientSafeBlocker"
              defaultValue={revisionValue(detail, "clientSafeBlocker")}
              className="h-9 text-[12px]"
            />
          </label>
        </div>
        <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
          Staff note
          <textarea
            name="staffNote"
            defaultValue={revisionValue(detail, "staffNote")}
            rows={2}
            className="rounded-md border bg-background p-2 text-[12px]"
          />
        </label>
        <fieldset className="rounded-md border p-2">
          <legend className="px-1 text-[10px] font-medium">
            Source fingerprints for this revision
          </legend>
          <p className="mb-2 text-[10px] text-muted-foreground">
            Selection captures the fingerprint currently shown. If a source changes after selection,
            save returns a conflict and you must review again.
          </p>
          <div className="max-h-48 space-y-2 overflow-auto">
            {choices.map((choice) => {
              const identity = `${choice.link.sourceKind}:${choice.link.sourceId}`;
              const isCurrent =
                currentFingerprints.get(identity) === choice.link.sourceFingerprint ||
                !currentFingerprints.has(identity);
              return (
                <label key={choice.key} className="flex gap-2 rounded border p-2 text-[10px]">
                  <input
                    type="checkbox"
                    disabled={!isCurrent && !selectedLinks.includes(choice.key)}
                    checked={selectedLinks.includes(choice.key)}
                    onChange={(event) =>
                      setSelectedLinks((current) =>
                        event.target.checked
                          ? [...current, choice.key]
                          : current.filter((item) => item !== choice.key),
                      )
                    }
                  />
                  <span className="min-w-0">
                    <strong>
                      {choice.link.sourceKind} · {choice.link.sourceId}
                    </strong>
                    {!isCurrent ? (
                      <span className="ml-2 text-amber-800">
                        Fingerprint changed; review the current source entry.
                      </span>
                    ) : null}
                    <span className="block break-all text-muted-foreground">
                      {choice.link.sourceFingerprint}
                    </span>
                    <span className="block break-all text-muted-foreground">
                      {JSON.stringify(choice.snapshot)}
                    </span>
                  </span>
                </label>
              );
            })}
            {!choices.length ? (
              <p className="text-[10px] text-muted-foreground">
                No source links. Saving without them leaves the revision unverified.
              </p>
            ) : null}
          </div>
          {sourceQuery.hasNextPage ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={sourceQuery.isFetchingNextPage}
              onClick={() => void sourceQuery.fetchNextPage()}
            >
              {sourceQuery.isFetchingNextPage ? "Loading…" : "Load more sources"}
            </Button>
          ) : null}
        </fieldset>
        {startsNewCycle ? (
          <p className="text-[11px] text-amber-900">
            This transition starts a new enrollment cycle and keeps the earlier cycle in history.
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save new revision"}
          </Button>
          <span role="status" className="text-[11px] text-muted-foreground">
            {message}
          </span>
        </div>
      </form>
    </details>
  );
}

function fieldValue(
  detail: EnrollmentScopeDetail,
  clientKey: keyof Extract<EnrollmentScopeDetail, { scopeId: string }>,
  staffKey: string,
): string {
  if (isStaffDetail(detail)) return revisionValue(detail, staffKey);
  const value = detail[clientKey];
  return value === null || value === undefined || value === "" ? "" : String(value);
}

function StaffEnrollmentActions({
  detail,
  onChanged,
}: {
  detail: Extract<EnrollmentScopeDetail, { scope: unknown }>;
  onChanged: () => void;
}) {
  const context = useEnrollmentReportContext();
  const selectedAccess = useAuthStore((state) => state.accessContext);
  const canPublish = Boolean(
    context?.audience === "staff" &&
    selectedAccess?.staffOrgs.some((org) => org.orgId === context.orgId && org.role === "admin"),
  );
  const queryClient = useQueryClient();
  const providerDocuments = useProviderDocuments(detail.scope.providerId);
  const groupDocuments = useGroupDocuments(detail.scope.groupId);
  const documentDownload = useDocumentDownload();
  const [documentVersionId, setDocumentVersionId] = useState("");
  const [evidenceKind, setEvidenceKind] = useState<EnrollmentEvidenceKind>("payer_approval_letter");
  const [supportedFields, setSupportedFields] = useState<EnrollmentProofField[]>([
    "enrollment_status",
    "product_id",
    "facility_id",
  ]);
  const [reason, setReason] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  const documents = useMemo(() => {
    const combined = [...(providerDocuments.data ?? []), ...(groupDocuments.data ?? [])];
    const superseded = new Set(combined.map((doc) => doc.supersedesDocumentId).filter(Boolean));
    return combined.map((doc) => ({ doc, isSuperseded: superseded.has(doc.id) }));
  }, [groupDocuments.data, providerDocuments.data]);
  const selectedDocument = documents.find((item) => item.doc.id === documentVersionId)?.doc;
  const revisionId = detail.scope.currentRevisionId;
  const providerLabel = selectedDocument?.providerId ? "provider" : "group";
  const expirationIsPast = (date: string | null) =>
    Boolean(date && date < new Date().toISOString().slice(0, 10));

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["enrollment-scope-detail"] });
    await queryClient.invalidateQueries({ queryKey: ["enrollment-scope-history"] });
    await queryClient.invalidateQueries({ queryKey: ["enrollment-report-page"] });
    onChanged();
  };

  const run = async (operation: () => Promise<unknown>, success: string) => {
    if (!context) return;
    setWorking(true);
    setMessage("");
    try {
      await operation();
      setMessage(success);
      await invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The action could not be completed.");
    } finally {
      setWorking(false);
    }
  };

  const publishSummary = () =>
    run(
      () => publishEnrollmentSummary(context!, { scopeId: detail.scope.id, revisionId }),
      "Client-safe summary published.",
    );

  const publishProof = () => {
    if (!context || !documentVersionId || !reason.trim() || !selectedDocument) {
      setMessage("Choose an immutable document version and enter the review reason.");
      return;
    }
    if (expirationIsPast(selectedDocument.expirationDate)) {
      setMessage(
        "This immutable document version has expired and cannot support a new publication.",
      );
      return;
    }
    if (supportedFields.length === 0) {
      setMessage("Select the assertions supported by this evidence version.");
      return;
    }
    const allowedFields = EVIDENCE_FIELDS[evidenceKind];
    const selectedFields = supportedFields.filter((field) => allowedFields.includes(field));
    if (selectedFields.length !== supportedFields.length) {
      setMessage("Remove assertions that are not supported by this evidence type.");
      return;
    }
    void run(
      () =>
        publishEnrollmentProof(context, {
          scopeId: detail.scope.id,
          revisionId,
          documentVersionId,
          evidenceKind,
          supportedFields: selectedFields,
          reason: reason.trim(),
        }),
      "Proof published against the selected immutable document version.",
    );
  };

  const revoke = (publicationId: string) => {
    if (!context || !revokeReason.trim()) {
      setMessage("Enter a reason before revoking a publication.");
      return;
    }
    void run(
      () => revokeEnrollmentPublication(context, { publicationId, reason: revokeReason.trim() }),
      "Publication revoked.",
    );
  };

  return (
    <section aria-label="Staff review and publication" className="mt-5 space-y-4 border-t pt-4">
      <h3 className="text-[13px] font-semibold">Staff review and publication</h3>
      <p className="text-[11px] text-muted-foreground">
        Summary and proof publication are separate. Proof is bound to the selected {providerLabel}{" "}
        document version.
      </p>
      {!canPublish ? (
        <p className="rounded-md bg-muted p-2 text-[11px]">
          Only an organization admin can publish or revoke client-facing enrollment.
        </p>
      ) : null}
      {detail.stale ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
          Source changed or expired. Save a fresh revision before publishing.
        </p>
      ) : null}
      {canPublish ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={working || detail.stale} onClick={publishSummary}>
            Publish client summary
          </Button>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
          Immutable provider or group document version
          <select
            aria-label="Immutable document version"
            className="h-9 rounded-md border bg-background px-2 text-[12px] text-foreground"
            value={documentVersionId}
            onChange={(event) => setDocumentVersionId(event.target.value)}
          >
            <option value="">Select a document version</option>
            {documents.map(({ doc, isSuperseded }) => (
              <option key={doc.id} value={doc.id} disabled={expirationIsPast(doc.expirationDate)}>
                {doc.fileName} · {doc.docType.replaceAll("_", " ")} · v{doc.versionNumber} ·{" "}
                {isSuperseded ? "superseded" : "current"}
                {doc.expirationDate ? ` · expires ${doc.expirationDate}` : ""}
                {expirationIsPast(doc.expirationDate) ? " · expired" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
          Evidence type
          <select
            aria-label="Evidence type"
            className="h-9 rounded-md border bg-background px-2 text-[12px] text-foreground"
            value={evidenceKind}
            onChange={(event) => {
              const kind = event.target.value as EnrollmentEvidenceKind;
              setEvidenceKind(kind);
              setSupportedFields(DEFAULT_EVIDENCE_FIELDS[kind]);
            }}
          >
            {EVIDENCE_KINDS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="rounded-md border p-3">
        <legend className="px-1 text-[11px] font-medium">
          Assertions supported by this evidence
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {PROOF_FIELDS.filter((field) => EVIDENCE_FIELDS[evidenceKind].includes(field.value)).map(
            (field) => (
              <label key={field.value} className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={supportedFields.includes(field.value)}
                  onChange={(event) =>
                    setSupportedFields((current) =>
                      event.target.checked
                        ? [...current, field.value]
                        : current.filter((item) => item !== field.value),
                    )
                  }
                />
                {field.label}
              </label>
            ),
          )}
        </div>
      </fieldset>
      <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
        Review reason
        <Input
          aria-label="Review reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="h-9 text-[12px]"
        />
      </label>
      {selectedDocument ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            {selectedDocument.docType.replaceAll("_", " ")} ·{" "}
            {selectedDocument.providerId ? "provider-owned" : "group-owned"} · version{" "}
            {selectedDocument.versionNumber}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={documentDownload.isPending}
            onClick={() => {
              const preview = window.open("about:blank", "_blank");
              if (preview) preview.opener = null;
              void documentDownload
                .mutateAsync(selectedDocument.id)
                .then((result) => {
                  if (preview) preview.location.href = result.url;
                })
                .catch(() => {
                  preview?.close();
                  setMessage("Document preview could not be opened.");
                });
            }}
          >
            {documentDownload.isPending ? "Preparing preview…" : "Preview selected document"}
          </Button>
        </div>
      ) : null}
      {canPublish ? (
        <Button
          size="sm"
          variant="outline"
          disabled={working || detail.stale || !documentVersionId}
          onClick={publishProof}
        >
          Publish proof
        </Button>
      ) : null}
      <div className="space-y-2 rounded-md bg-muted/40 p-3">
        <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
          Revocation reason
          <Input
            aria-label="Revocation reason"
            value={revokeReason}
            onChange={(event) => setRevokeReason(event.target.value)}
            className="h-9 text-[12px]"
          />
        </label>
        {canPublish && detail.summary ? (
          <Button
            size="sm"
            variant="outline"
            disabled={working}
            onClick={() => revoke(detail.summary!.publicationId)}
          >
            Revoke summary
          </Button>
        ) : null}
        {canPublish
          ? detail.proofs.map((proof) => (
              <Button
                key={proof.publicationId}
                size="sm"
                variant="outline"
                disabled={working}
                onClick={() => revoke(proof.publicationId)}
              >
                Revoke {proof.evidenceKind.replaceAll("_", " ")} proof
              </Button>
            ))
          : null}
      </div>
      <p role="status" aria-live="polite" className="min-h-4 text-[11px] text-muted-foreground">
        {message}
      </p>
    </section>
  );
}

function HistoryPanel({
  scopeId,
  enabled,
  audience,
}: {
  scopeId: string;
  enabled: boolean;
  audience: "staff" | "client";
}) {
  const history = useEnrollmentScopeHistory(scopeId, enabled);
  if (!enabled) return null;
  if (history.isLoading)
    return <p className="text-[12px] text-muted-foreground">Loading history…</p>;
  if (history.error)
    return (
      <p role="alert" className="text-[12px] text-destructive">
        History could not be loaded.
      </p>
    );
  if (!history.data) return null;
  const items = history.data.pages.flatMap((page) => page.items);
  return (
    <div>
      <ol className="space-y-3" aria-label="Enrollment history">
        {items.map((item, index) => {
          if (audience === "client") {
            if (!("historical" in item)) return null;
            return (
              <li
                key={`${item.scopeId}:${item.publishedAt}:${index}`}
                className="rounded-md border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-[12px] capitalize">
                    {item.historicalStatus ?? item.status}
                  </strong>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(item.publishedAt).toLocaleDateString()} · historical
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {item.providerName} · {item.groupLabel} · {item.payerLabel} · {item.productLabel}
                  {" · "}
                  {item.state} · {item.facilityLabel}
                </p>
              </li>
            );
          }
          if (!("revision" in item)) return null;
          const staffItem = item as EnrollmentScopeHistoryStaffItem;
          return (
            <li key={staffItem.revisionId} className="rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-[12px] capitalize">
                  Cycle {staffItem.cycleNo} · Revision {staffItem.revisionNo} ·{" "}
                  {staffItem.status.replaceAll("_", " ")}
                </strong>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(staffItem.createdAt).toLocaleDateString()}
                </span>
              </div>
              <details className="mt-2 text-[11px]">
                <summary className="cursor-pointer text-muted-foreground">
                  Revision values, source timeline, and publication events
                </summary>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  {Object.entries(staffItem.revision).map(([key, value]) =>
                    value !== null && value !== "" ? (
                      <div key={key}>
                        <dt className="text-muted-foreground">{key.replaceAll("_", " ")}</dt>
                        <dd>{String(value)}</dd>
                      </div>
                    ) : null,
                  )}
                </dl>
                <ul className="mt-2 space-y-2">
                  {staffItem.sources.map((source) => (
                    <li
                      key={`${source.sourceKind}:${source.sourceId}`}
                      className="rounded bg-muted/50 p-2"
                    >
                      <strong>
                        {source.sourceKind} · {source.sourceId}
                      </strong>
                      <p className="break-all text-muted-foreground">
                        Fingerprint: {source.sourceFingerprint}
                      </p>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[10px]">
                        {JSON.stringify(source.sourceSnapshot, null, 2)}
                      </pre>
                    </li>
                  ))}
                </ul>
                <ul className="mt-2 space-y-1">
                  {staffItem.publications.map((publication, publicationIndex) => (
                    <li key={`${publication.publicationId}:${publicationIndex}`}>
                      {publication.kind} · {publication.state} ·{" "}
                      {new Date(publication.publishedAt).toLocaleString()}
                      {publication.evidenceKind ? ` · ${publication.evidenceKind}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ol>
      {history.hasNextPage ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {history.isFetchingNextPage ? "Loading…" : "Load more history"}
        </Button>
      ) : null}
    </div>
  );
}

export function EnrollmentScopeDrawer({
  scopeId,
  facilityLabel,
  providerName,
  historical = false,
  historicalStatus,
  open,
  onOpenChange,
  onRestoreFocus,
}: {
  scopeId: string | null;
  facilityLabel?: string;
  providerName?: string;
  historical?: boolean;
  historicalStatus?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestoreFocus?: () => void;
}) {
  const [tab, setTab] = useState<"detail" | "history">("detail");
  const context = useEnrollmentReportContext();
  useEffect(() => {
    if (open) setTab(historical ? "history" : "detail");
  }, [historical, open, scopeId]);
  const detailQuery = useEnrollmentScopeDetail(scopeId, open && !historical);
  const detail = detailQuery.data;
  const clientDetail: Extract<EnrollmentScopeDetail, { scopeId: string }> | null =
    detail && "scopeId" in detail
      ? (detail as Extract<EnrollmentScopeDetail, { scopeId: string }>)
      : null;
  const clientPending = Boolean(clientDetail?.status === "needs_verification");
  const identity = detail ? scopeIdentity(detail) : null;
  const currentStatus = detail
    ? isStaffDetail(detail)
      ? String(detail.revision.status ?? "")
      : clientPending
        ? "needs_verification"
        : detail.status
    : "";
  const fieldDetail = clientDetail;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setTab("detail");
      }}
    >
      <DialogContent
        className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto p-4"
        data-testid="enrollment-scope-drawer"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          window.requestAnimationFrame(() => onRestoreFocus?.());
        }}
      >
        <DialogHeader className="pr-7">
          <DialogTitle>{providerName || "Enrollment details"}</DialogTitle>
          <DialogDescription>
            {facilityLabel
              ? `Enrollment at ${facilityLabel}`
              : "Current authorized enrollment scope"}
          </DialogDescription>
        </DialogHeader>
        <div
          className="flex gap-2 border-b pb-2"
          role="tablist"
          aria-label="Enrollment scope panels"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "detail"}
            disabled={historical}
            onClick={() => setTab("detail")}
            className="rounded px-3 py-1.5 text-[12px] aria-selected:bg-primary aria-selected:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            Details
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "history"}
            onClick={() => setTab("history")}
            className="rounded px-3 py-1.5 text-[12px] aria-selected:bg-primary aria-selected:text-primary-foreground"
          >
            History
          </button>
        </div>
        {tab === "history" && scopeId ? (
          <div className="space-y-3">
            {historical ? (
              <p className="rounded-md border bg-muted/40 p-3 text-[12px] text-muted-foreground">
                Selected historical row:{" "}
                <span className="font-medium capitalize text-foreground">
                  {historicalStatus?.replaceAll("_", " ") ?? "historical publication"}
                </span>
                . Current enrollment detail is not shown for a historical selection.
              </p>
            ) : null}
            <HistoryPanel
              scopeId={scopeId}
              enabled={open}
              audience={context?.audience ?? "client"}
            />
          </div>
        ) : detailQuery.isLoading ? (
          <p className="py-8 text-center text-[12px] text-muted-foreground">Loading enrollment…</p>
        ) : detailQuery.error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-[12px] text-destructive"
          >
            This enrollment is no longer available in the selected access context.
          </div>
        ) : detail && identity ? (
          <div>
            {clientPending ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-950">
                <strong>Needs verification</strong>
                <p className="mt-1">
                  Current enrollment assertions are withheld until staff rechecks the source.
                </p>
                {fieldDetail?.historicalStatus ? (
                  <p className="mt-2">
                    Last published status:{" "}
                    <span className="font-medium capitalize">
                      {fieldDetail.historicalStatus.replaceAll("_", " ")}
                    </span>
                  </p>
                ) : null}
              </div>
            ) : (
              <>
                {isStaffDetail(detail) && detail.stale ? (
                  <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-950">
                    Source evidence changed or expired. Verify source values before publishing.
                  </p>
                ) : null}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[12px]">
                  <div>
                    <dt className="text-muted-foreground">Status</dt>
                    <dd className="mt-0.5 font-medium capitalize">
                      {currentStatus.replaceAll("_", " ") || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Payer reference</dt>
                    <dd className="mt-0.5">
                      {fieldValue(detail, "payerReference", "payerReference") || "Not recorded"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Intake date</dt>
                    <dd className="mt-0.5">
                      {fieldValue(detail, "intakeDate", "intakeDate") || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Complete to submit</dt>
                    <dd className="mt-0.5">
                      {fieldValue(detail, "completeToSubmitDate", "completeToSubmitDate") || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Submitted</dt>
                    <dd className="mt-0.5">
                      {fieldValue(detail, "submittedDate", "submittedDate") || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Payer acknowledged</dt>
                    <dd className="mt-0.5">
                      {fieldValue(detail, "payerAcknowledgedDate", "payerAcknowledgedDate") || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Approved</dt>
                    <dd className="mt-0.5">
                      {fieldValue(detail, "approvedDate", "approvedDate") || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Effective</dt>
                    <dd className="mt-0.5">
                      {fieldValue(detail, "effectiveDate", "effectiveDate") || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Termination</dt>
                    <dd className="mt-0.5">
                      {fieldValue(detail, "terminationDate", "terminationDate") || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Retroactive status</dt>
                    <dd className="mt-0.5 capitalize">
                      {fieldValue(detail, "retroStatus", "retroStatus").replaceAll("_", " ") ||
                        "Unknown"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Retroactive days</dt>
                    <dd className="mt-0.5">
                      {fieldValue(detail, "retroDays", "retroDays") || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Retroactive date</dt>
                    <dd className="mt-0.5">
                      {fieldValue(detail, "retroDate", "retroDate") || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Retro basis</dt>
                    <dd className="mt-0.5">
                      {fieldValue(detail, "retroBasis", "retroBasis") || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Action owner</dt>
                    <dd className="mt-0.5">{fieldValue(detail, "owner", "action_owner") || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Reviewed as of</dt>
                    <dd className="mt-0.5">
                      {fieldValue(detail, "reviewedAt", "observedAt") || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Cycle / revision</dt>
                    <dd className="mt-0.5">
                      {fieldValue(detail, "cycleNo", "cycleNo") || "—"} /{" "}
                      {fieldValue(detail, "revisionNo", "revisionNo") || "—"}
                    </dd>
                  </div>
                  {fieldDetail?.clientSafeBlocker ? (
                    <div className="col-span-2">
                      <dt className="text-muted-foreground">Next step</dt>
                      <dd className="mt-0.5">{fieldDetail.clientSafeBlocker}</dd>
                    </div>
                  ) : null}
                </dl>
              </>
            )}
            {!clientPending && !isStaffDetail(detail) ? (
              <div className="mt-4 space-y-2">
                <h3 className="text-[12px] font-semibold">Published proof</h3>
                {detail.proofs.length ? (
                  detail.proofs.map((proof) => (
                    <ProofDownload
                      key={proof.publicationId}
                      publicationId={proof.publicationId}
                      label={proof.evidenceKind.replaceAll("_", " ")}
                    />
                  ))
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    No proof is available for this published summary.
                  </p>
                )}
              </div>
            ) : null}
            {isStaffDetail(detail) ? (
              <div className="mt-4 space-y-3">
                <div>
                  <h3 className="text-[12px] font-semibold">Source links</h3>
                  <ul className="mt-1 space-y-1 text-[11px] text-muted-foreground">
                    {detail.sources.map((source) => (
                      <li
                        key={`${source.sourceKind}:${source.sourceId}`}
                        className="rounded border p-2"
                      >
                        <strong>
                          {source.sourceKind} · {source.sourceId}
                        </strong>
                        <p className="break-all">Fingerprint: {source.sourceFingerprint}</p>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[10px]">
                          {JSON.stringify(source.sourceSnapshot, null, 2)}
                        </pre>
                      </li>
                    ))}
                  </ul>
                </div>
                {detail.summary ? (
                  <p className="text-[11px] text-muted-foreground">
                    Summary published {new Date(detail.summary.publishedAt).toLocaleDateString()} ·{" "}
                    {detail.summary.owner}
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">Summary is not published.</p>
                )}
                {detail.proofs.map((proof) => (
                  <p key={proof.publicationId} className="text-[11px] text-muted-foreground">
                    {proof.evidenceKind.replaceAll("_", " ")} · SHA-256 {proof.sha256}
                  </p>
                ))}
                <StaffRevisionEditor
                  key={detail.scope.currentRevisionId}
                  detail={detail}
                  onSaved={() => undefined}
                />
                <StaffEnrollmentActions detail={detail} onChanged={() => undefined} />
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ProofDownload({ publicationId, label }: { publicationId: string; label: string }) {
  const context = useEnrollmentReportContext();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    [context?.contextRevision],
  );
  const download = async () => {
    if (!context) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setMessage("");
    try {
      const blob = await downloadEnrollmentProof(context, publicationId, {
        signal: current.signal,
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "enrollment-proof.pdf";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      if (!current.signal.aborted)
        setMessage("Proof is no longer available in this access context.");
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <div className="flex items-center justify-between gap-3 rounded border px-3 py-2">
      <span className="text-[11px] capitalize">{label}</span>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void download()}>
        {busy ? "Checking…" : "Download proof"}
      </Button>
      {message ? (
        <span role="status" className="sr-only">
          {message}
        </span>
      ) : null}
    </div>
  );
}
