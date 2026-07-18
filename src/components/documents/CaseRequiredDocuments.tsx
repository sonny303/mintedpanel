// E4.5 F4.5.3/TE-7 — the Assigned-phase document verification panel on case
// detail: the documents the case's SOP tasks require (stable machine kinds
// parsed from step requiredArtifacts — free-form artifact names never join),
// each derived LIVE against the provider's and group's CURRENT document
// versions: present / missing / expired, with one-click audited download of
// each present document for the manual portal attach (the documented D3
// interim path). Advisory only — nothing is copied onto the case or task and
// nothing here disables anything.
import { useMemo } from "react";
import { Check, TriangleAlert, X } from "lucide-react";
import { StatusPill } from "@/components/StatusPill";
import { requiredDocumentKinds, caseDocumentStatus } from "@/lib/documents";
import { localTodayIso } from "@/hooks/useEnrollmentReadiness";
import { useGroupDocuments, useProviderDocuments } from "@/hooks/useDocuments";
import { fmtDate } from "@/lib/format";
import type { Task } from "@/types";
import { DocumentDownloadButton } from "./DocumentDownloadButton";

interface CaseRequiredDocumentsProps {
  providerId: string;
  groupId: string | null;
  tasks: Task[];
}

export function CaseRequiredDocuments({ providerId, groupId, tasks }: CaseRequiredDocumentsProps) {
  const requiredKinds = useMemo(() => requiredDocumentKinds(tasks), [tasks]);
  const providerDocsQ = useProviderDocuments(requiredKinds.length > 0 ? providerId : "");
  const groupDocsQ = useGroupDocuments(requiredKinds.length > 0 && groupId ? groupId : "");
  const today = localTodayIso();

  const checks = useMemo(
    () =>
      caseDocumentStatus(
        requiredKinds,
        providerDocsQ.data ?? [],
        groupId ? (groupDocsQ.data ?? []) : [],
        today,
      ),
    [requiredKinds, providerDocsQ.data, groupDocsQ.data, groupId, today],
  );

  // No SOP-required document kinds on this case — no panel (the
  // portal-launcher visibility idiom).
  if (requiredKinds.length === 0) return null;

  return (
    <section className="rounded-md border border-border bg-card">
      <header className="flex h-10 items-center justify-between border-b border-border px-4">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Required documents
        </h2>
        <span className="text-[11px] text-muted-foreground">
          {checks.filter((c) => c.state === "present").length} of {checks.length} ready
        </span>
      </header>
      <ul className="divide-y divide-border">
        {checks.map((c) => (
          <li key={c.kind} className="flex h-10 items-center gap-2 px-4 text-[13px]">
            {c.state === "present" ? (
              <Check className="h-3.5 w-3.5 flex-none text-[var(--mp-ok-ink)]" />
            ) : c.state === "expired" ? (
              <TriangleAlert className="h-3.5 w-3.5 flex-none text-[var(--mp-danger-ink)]" />
            ) : (
              <X className="h-3.5 w-3.5 flex-none text-[var(--mp-danger-ink)]" />
            )}
            <span className="font-medium text-foreground">{c.label}</span>
            {c.state === "present" ? (
              c.expiringSoon ? (
                <StatusPill status="amber" label="Expiring soon" />
              ) : (
                <StatusPill status="green" label="Present" />
              )
            ) : c.state === "expired" ? (
              <StatusPill status="red" label="Expired" />
            ) : (
              <StatusPill status="red" label="Missing" />
            )}
            {c.document?.expirationDate ? (
              <span className="text-[12px] text-muted-foreground">
                {c.state === "expired" ? "expired" : "expires"} {fmtDate(c.document.expirationDate)}
              </span>
            ) : null}
            <span className="ml-auto">
              {c.document && c.state !== "missing" ? (
                <DocumentDownloadButton documentId={c.document.id} fileName={c.document.fileName} />
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
