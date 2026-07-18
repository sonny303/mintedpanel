// E4.5 F4.5.2 — the org-level expiring-credentials table: every CURRENT
// document version that tracks an expiration date, sorted by soonest
// expiration, with derived expired / expiring-soon / current states (never a
// stored flag). Org-scoped: renders a select-an-organization state when none
// is active (the Reporting Center itself is cross-org).
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { useActiveOrgId } from "@/lib/auth-store";
import { fmtDate } from "@/lib/format";
import { documentKindLabel, expiringCredentialRows } from "@/lib/documents";
import { localTodayIso } from "@/hooks/useEnrollmentReadiness";
import { useOrgDocuments } from "@/hooks/useDocuments";
import { useProviders } from "@/hooks/useProviders";
import { useProviderGroups } from "@/hooks/useLookups";
import { DocumentDownloadButton } from "./DocumentDownloadButton";
import { DocumentExpirationPill } from "./DocumentExpirationPill";

export function ExpiringCredentialsTable() {
  const orgId = useActiveOrgId();
  const docsQ = useOrgDocuments();
  const providersQ = useProviders();
  const groupsQ = useProviderGroups();
  const today = localTodayIso();

  const providerName = useMemo(() => {
    const m = new Map<string, string>();
    (providersQ.data ?? []).forEach((p) => m.set(p.id, `${p.firstName} ${p.lastName}`.trim()));
    return m;
  }, [providersQ.data]);
  const groupName = useMemo(() => {
    const m = new Map<string, string>();
    (groupsQ.data ?? []).forEach((g) => m.set(g.id, g.name));
    return m;
  }, [groupsQ.data]);

  const rows = useMemo(() => expiringCredentialRows(docsQ.data ?? [], today), [docsQ.data, today]);

  if (!orgId) {
    return <EmptyState message="Select an organization to see its expiring credentials." />;
  }
  if (docsQ.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-2/3" />
      </div>
    );
  }
  if (docsQ.isError) {
    return (
      <div className="text-[13px] text-[#B91C1C]">
        Failed to load documents: {(docsQ.error as Error).message}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState message="No expiration-tracked documents on file yet — upload State Licenses, DEAs, and COIs from provider and group records." />
    );
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="h-9">Document</TableHead>
            <TableHead className="h-9">Owner</TableHead>
            <TableHead className="h-9">Expires</TableHead>
            <TableHead className="h-9">Status</TableHead>
            <TableHead className="h-9">Version</TableHead>
            <TableHead className="h-9 text-right">Download</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ document, status }) => (
            <TableRow key={document.id} className="h-10">
              <TableCell>
                <div className="text-[13px] font-medium text-foreground">
                  {documentKindLabel(document.docType)}
                </div>
                <div className="max-w-[220px] truncate text-[11px] text-muted-foreground">
                  {document.fileName}
                </div>
              </TableCell>
              <TableCell>
                {document.providerId ? (
                  <Link
                    to="/providers/$id"
                    params={{ id: document.providerId }}
                    className="text-[13px] text-foreground underline decoration-dotted underline-offset-2 hover:text-[#1B4D3E]"
                  >
                    {providerName.get(document.providerId) ?? "Provider"}
                  </Link>
                ) : document.groupId ? (
                  <span className="text-[13px] text-foreground">
                    {groupName.get(document.groupId) ?? "Group"}
                  </span>
                ) : (
                  <span className="text-[13px] text-muted-foreground">—</span>
                )}
                <div className="text-[11px] text-muted-foreground">
                  {document.providerId ? "Provider" : document.groupId ? "Group" : "Case"}
                </div>
              </TableCell>
              <TableCell className="tabular-nums">{fmtDate(document.expirationDate)}</TableCell>
              <TableCell>
                <DocumentExpirationPill status={status} />
              </TableCell>
              <TableCell className="tabular-nums">v{document.versionNumber}</TableCell>
              <TableCell className="text-right">
                <DocumentDownloadButton documentId={document.id} fileName={document.fileName} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
