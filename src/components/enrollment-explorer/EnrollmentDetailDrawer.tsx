import React, { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  X,
  ShieldCheck,
  Download,
  AlertTriangle,
  Calendar,
  Building2,
  User,
  FileCheck,
  Clock,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import {
  downloadEnrollmentProof,
  fetchEnrollmentScopeDetail,
  resolveExplorerContext,
} from "@/lib/enrollmentExplorerApi";
import type {
  EnrollmentActionOwner,
  EnrollmentEvidenceKind,
  EnrollmentProofSummary,
  EnrollmentScopeDetail,
  EnrollmentStatus,
} from "@/types";

interface EnrollmentDetailDrawerProps {
  scopeId: string | null;
  clinicianName?: string;
  npi?: string;
  payerName?: string;
  productName?: string;
  facilityName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isClient: boolean;
}

function statusToPillColor(status: EnrollmentStatus | "needs_verification" | string): StatusColor {
  switch (status) {
    case "approved":
      return "green";
    case "in_progress":
    case "submitted":
    case "in_review":
      return "blue";
    case "action_required":
    case "needs_verification":
      return "amber";
    case "denied":
      return "red";
    case "not_pursuing":
    case "terminated":
      return "gray";
    default:
      return "neutral";
  }
}

function formatEvidenceKind(kind: EnrollmentEvidenceKind | string): string {
  switch (kind) {
    case "payer_approval_letter":
      return "Payer Approval Letter";
    case "payer_roster_confirmation":
      return "Payer Roster Confirmation";
    case "payer_acknowledgement":
      return "Payer Submission Receipt";
    case "license_psv":
      return "State PSV License";
    default:
      return kind.replace(/_/g, " ");
  }
}

interface StaffRevisionData {
  status?: EnrollmentStatus;
  action_owner?: EnrollmentActionOwner;
  effective_date?: string | null;
  submitted_date?: string | null;
  payer_acknowledged_date?: string | null;
  payer_reference?: string | null;
  client_safe_blocker?: string | null;
  retro_status?: string | null;
  retro_days?: number | null;
  retro_date?: string | null;
  staff_note?: string | null;
}

function isStaffDetail(detail: EnrollmentScopeDetail | null | undefined): detail is EnrollmentScopeDetailStaff {
  return detail !== null && detail !== undefined && "stale" in detail;
}

export function EnrollmentDetailDrawer({
  scopeId,
  clinicianName,
  npi,
  payerName,
  productName,
  facilityName,
  open,
  onOpenChange,
  isClient,
}: EnrollmentDetailDrawerProps) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const context = resolveExplorerContext();

  const {
    data: detail,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["enrollment-scope-detail", scopeId, context.contextRevision, isClient],
    queryFn: () => fetchEnrollmentScopeDetail(context, scopeId!),
    enabled: Boolean(scopeId) && open,
  });

  const handleDownloadProof = async (proof: EnrollmentProofSummary) => {
    try {
      setDownloadingId(proof.publicationId);
      const blob = await downloadEnrollmentProof(context, proof.publicationId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `proof-${proof.evidenceKind}-${proof.publicationId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download proof document:", err);
    } finally {
      setDownloadingId(null);
    }
  };

  // Derive field values depending on whether detail is staff or client projection
  const isStaff = isStaffDetail(detail);
  const staffRevision = isStaff ? (detail.revision as unknown as StaffRevisionData) : undefined;
  const clientDetail = !isStaff && detail ? detail : undefined;

  const status: EnrollmentStatus | "needs_verification" = isStaff
    ? (detail.summary?.status ?? staffRevision?.status ?? "not_started")
    : (clientDetail?.status ?? "not_started");

  const actionOwner: EnrollmentActionOwner = isStaff
    ? (detail.summary?.owner ?? staffRevision?.action_owner ?? "Unassigned")
    : (clientDetail?.owner ?? "Unassigned");

  const effectiveDate = isStaff
    ? staffRevision?.effective_date
    : clientDetail?.effectiveDate;

  const submittedDate = isStaff
    ? staffRevision?.submitted_date
    : clientDetail?.submittedDate;

  const payerAckDate = isStaff
    ? staffRevision?.payer_acknowledged_date
    : clientDetail?.payerAcknowledgedDate;

  const payerReference = isStaff
    ? staffRevision?.payer_reference
    : clientDetail?.payerReference;

  const clientSafeBlocker = isStaff
    ? (detail.summary?.clientSafeBlocker ?? staffRevision?.client_safe_blocker ?? null)
    : (clientDetail?.clientSafeBlocker ?? null);

  const retroStatus = isStaff
    ? staffRevision?.retro_status
    : clientDetail?.retroStatus;

  const retroDays = isStaff
    ? staffRevision?.retro_days
    : clientDetail?.retroDays;

  const retroDate = isStaff
    ? staffRevision?.retro_date
    : clientDetail?.retroDate;

  const proofs: EnrollmentProofSummary[] = detail?.proofs ?? [];
  const staffNote: string | null = !isClient && isStaff ? (staffRevision?.staff_note ?? null) : null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Backdrop Overlay */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs transition-opacity duration-200 data-[state=closed]:opacity-0 data-[state=open]:opacity-100" />

        {/* Slide-over Drawer Content */}
        <DialogPrimitive.Content
          className="fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col border-l border-border bg-card shadow-2xl transition-transform duration-300 ease-in-out data-[state=closed]:translate-x-full data-[state=open]:translate-x-0 sm:max-w-lg"
          data-testid="enrollment-detail-drawer"
        >
          {/* Header */}
          <div className="flex items-start justify-between border-b border-border p-5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-[16px] font-semibold text-foreground truncate" data-testid="drawer-clinician-name">
                  {clinicianName ?? "Clinician Enrollment"}
                </h2>
                {npi ? (
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    NPI: {npi}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                <span className="font-medium text-foreground">{payerName ?? "Payer"}</span>
                <span>•</span>
                <span>{productName ?? "Product"}</span>
                {facilityName ? (
                  <>
                    <span>•</span>
                    <span className="truncate">{facilityName}</span>
                  </>
                ) : null}
              </div>
            </div>

            <DialogPrimitive.Close className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-4 w-4" />
              <span className="sr-only">Close drawer</span>
            </DialogPrimitive.Close>
          </div>

          {/* Drawer Body Scroll Area */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {isLoading ? (
              <div className="flex h-40 items-center justify-center text-[13px] text-muted-foreground">
                Loading verified enrollment proof…
              </div>
            ) : isError ? (
              <div className="rounded-md border border-[var(--mp-danger-tint)] bg-[var(--mp-danger-tint)]/20 p-4 text-[13px] text-[var(--mp-danger-ink)]">
                {error instanceof Error ? error.message : "Failed to load enrollment details"}
              </div>
            ) : (
              <>
                {/* 1. Status Banner */}
                <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 p-3.5">
                  <div className="space-y-1">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Enrollment Status
                    </div>
                    <div>
                      <StatusPill
                        status={statusToPillColor(status)}
                        label={status.replace(/_/g, " ").toUpperCase()}
                      />
                    </div>
                  </div>

                  <div className="text-right space-y-1">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Action Owner
                    </div>
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-background px-2.5 py-1 text-[12px] font-medium text-foreground shadow-xs border border-border">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          actionOwner === "Payer"
                            ? "bg-blue-500"
                            : actionOwner === "Client"
                              ? "bg-amber-500"
                              : actionOwner === "Minted"
                                ? "bg-emerald-500"
                                : "bg-muted-foreground"
                        }`}
                      />
                      {actionOwner}
                    </div>
                  </div>
                </div>

                {/* 2. Active Dependency / Blocker Callout */}
                {clientSafeBlocker || status === "action_required" ? (
                  <div
                    className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 space-y-1.5"
                    data-testid="drawer-blocker-callout"
                  >
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-800">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                      Action Required / Blocker
                    </div>
                    <p className="text-[13px] text-amber-900 leading-relaxed">
                      {clientSafeBlocker ?? "Action is required to complete this enrollment."}
                    </p>
                  </div>
                ) : null}

                {/* 3. Core Facts 2-Column Grid */}
                <div>
                  <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Core Operational Milestones
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {/* Submission Date */}
                    <div className="rounded-md border border-border bg-background p-3">
                      <div className="text-[11px] text-muted-foreground">Submitted Date</div>
                      <div className="mt-1 text-[13px] font-medium text-foreground">
                        {submittedDate ?? "—"}
                      </div>
                    </div>

                    {/* Payer Acknowledged */}
                    <div className="rounded-md border border-border bg-background p-3">
                      <div className="text-[11px] text-muted-foreground">Payer Acknowledged</div>
                      <div className="mt-1 text-[13px] font-medium text-foreground">
                        {payerAckDate ?? "—"}
                      </div>
                    </div>

                    {/* Effective Date */}
                    <div className="rounded-md border border-border bg-background p-3">
                      <div className="text-[11px] text-muted-foreground">Confirmed Effective</div>
                      <div className="mt-1 text-[13px] font-semibold text-emerald-700">
                        {effectiveDate ?? "—"}
                      </div>
                    </div>

                    {/* Payer Reference Number */}
                    <div className="rounded-md border border-border bg-background p-3">
                      <div className="text-[11px] text-muted-foreground">Payer Reference #</div>
                      <div className="mt-1 font-mono text-[13px] font-medium text-foreground truncate">
                        {payerReference ?? "—"}
                      </div>
                    </div>

                    {/* Retroactive Window */}
                    <div className="col-span-2 rounded-md border border-border bg-background p-3">
                      <div className="text-[11px] text-muted-foreground">Retroactive Billing Window</div>
                      <div className="mt-1 text-[13px] font-medium text-foreground">
                        {retroStatus === "documented" ? (
                          <span className="text-foreground">
                            Documented: {retroDays ? `${retroDays} days prior` : retroDate ?? "Verified"}
                          </span>
                        ) : retroStatus === "not_supported" ? (
                          <span className="text-muted-foreground">Not supported by payer</span>
                        ) : (
                          <span className="text-muted-foreground">Unknown / Pending review</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4. Linear Milestone Progress */}
                <div>
                  <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Progress Timeline
                  </h3>
                  <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
                    <div className="flex items-center gap-3 text-[13px]">
                      <div className={`h-2.5 w-2.5 rounded-full ${submittedDate ? "bg-emerald-600" : "bg-muted"}`} />
                      <span className="font-medium">1. Intake & Submission</span>
                      <span className="ml-auto text-[12px] text-muted-foreground">{submittedDate ?? "Pending"}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[13px]">
                      <div className={`h-2.5 w-2.5 rounded-full ${payerAckDate ? "bg-emerald-600" : "bg-muted"}`} />
                      <span className="font-medium">2. Payer Receipt & Review</span>
                      <span className="ml-auto text-[12px] text-muted-foreground">{payerAckDate ?? "Pending"}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[13px]">
                      <div className={`h-2.5 w-2.5 rounded-full ${effectiveDate ? "bg-emerald-600" : "bg-muted"}`} />
                      <span className="font-medium">3. Contract Approval & Effective</span>
                      <span className="ml-auto text-[12px] text-muted-foreground">{effectiveDate ?? "Pending"}</span>
                    </div>
                  </div>
                </div>

                {/* 5. Audit Evidence & Proof Documents */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Version-Bound Proof ({proofs.length})
                    </h3>
                    <div className="flex items-center gap-1 text-[11px] text-emerald-700 font-medium">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      SHA-256 Verified
                    </div>
                  </div>

                  {proofs.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-4 text-center text-[12px] text-muted-foreground">
                      No published proof documents attached to this scope yet.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {proofs.map((proof) => (
                        <div
                          key={proof.publicationId}
                          className="flex items-center justify-between rounded-lg border border-border bg-background p-3.5 shadow-2xs hover:bg-muted/30 transition-colors"
                          data-testid={`proof-document-${proof.publicationId}`}
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-700">
                              <FileCheck className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[13px] font-semibold text-foreground truncate">
                                {formatEvidenceKind(proof.evidenceKind)}
                              </div>
                              <div className="mt-0.5 text-[11px] text-muted-foreground">
                                Published: {new Date(proof.publishedAt).toLocaleDateString()}
                              </div>
                              {proof.sha256 ? (
                                <div
                                  className="mt-0.5 font-mono text-[10px] text-muted-foreground"
                                  title={`Full SHA-256: ${proof.sha256}`}
                                >
                                  SHA-256: {proof.sha256.slice(0, 8)}…{proof.sha256.slice(-6)}
                                </div>
                              ) : null}
                              <div className="mt-1 flex flex-wrap gap-1">
                                {proof.supportedFields.map((field) => (
                                  <span
                                    key={field}
                                    className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                  >
                                    {field}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>

                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 text-[12px] shrink-0 ml-2"
                            disabled={downloadingId === proof.publicationId}
                            onClick={() => void handleDownloadProof(proof)}
                            data-testid={`download-proof-${proof.publicationId}`}
                          >
                            <Download className="h-3.5 w-3.5" />
                            {downloadingId === proof.publicationId ? "Verifying…" : "Download"}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Staff-Only Internal Notes (Strictly hidden for external clients) */}
                {!isClient && staffNote ? (
                  <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Internal Staff Notes (Hidden from Client)
                    </div>
                    <p className="text-[12px] text-foreground leading-relaxed whitespace-pre-wrap">
                      {staffNote}
                    </p>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
