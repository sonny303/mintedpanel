// E6.6 F6.6.3 — the denials rollup report (TS-136): every case carrying a
// denial, provider-first by default and pivotable payer-first, with reason
// (the fixed word-list), date, and cycle state (standing / reapplied). The
// DERIVATION is the same source the provider record's Cases panel reads
// (case statuses + case_status_history denial entries + the reason-code
// list), so the two agree by construction; zero stored rollup state. CSV
// export via the shared csv machinery.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useCases, useCaseDenialEntries, useDenialReasonCodes } from "@/hooks/useCases";
import { usePayers } from "@/hooks/useAdmin";
import { useProviders } from "@/hooks/useProviders";
import {
  buildDenialRows,
  groupDenialsByPayer,
  groupDenialsByProvider,
  type DenialInfo,
} from "@/lib/caseRollups";
import {
  buildDenialsCsv,
  cycleStateLabel,
  decorateDenialRows,
  type DenialReportRow,
} from "@/lib/denialsReport";
import { downloadCsvText } from "@/lib/csv";

type Pivot = "provider" | "payer";

function DenialTable({ rows }: { rows: DenialReportRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-[#E8E5E0]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Provider</TableHead>
            <TableHead>Payer</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Denied on</TableHead>
            <TableHead>Cycle</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.caseId}>
              <TableCell className="text-[13px] font-medium">{row.providerName}</TableCell>
              <TableCell className="text-[13px]">{row.payerName}</TableCell>
              <TableCell className="text-[13px]">{row.state}</TableCell>
              <TableCell className="text-[13px]">{row.reasonLabel ?? "Denied"}</TableCell>
              <TableCell className="text-[13px] whitespace-nowrap">
                {row.deniedAt ? fmtDate(row.deniedAt) : "—"}
              </TableCell>
              <TableCell className="text-[13px] whitespace-nowrap">
                <Link
                  to="/cases/$id"
                  params={{ id: row.caseId }}
                  className="text-[#1B4D3E] underline-offset-2 hover:underline"
                >
                  {cycleStateLabel(row)}
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function DenialsReport() {
  const orgId = useActiveOrgId();
  const casesQ = useCases();
  const denialsQ = useCaseDenialEntries();
  const reasonsQ = useDenialReasonCodes();
  const providersQ = useProviders();
  const payersQ = usePayers();
  const [pivot, setPivot] = useState<Pivot>("provider");

  const rows = useMemo(() => {
    // The record-panel parity join: latest denial entry per case (the read is
    // latest-first), label via the active reason list, "Denied" fallback.
    const reasonLabel = new Map((reasonsQ.data ?? []).map((r) => [r.id, r.label]));
    const infoByCase = new Map<string, DenialInfo>();
    for (const d of denialsQ.data ?? []) {
      if (infoByCase.has(d.caseId)) continue;
      infoByCase.set(d.caseId, {
        reasonLabel: d.reasonCodeId ? (reasonLabel.get(d.reasonCodeId) ?? "Denied") : "Denied",
        deniedAt: d.changedAt,
      });
    }
    const denialRows = buildDenialRows(
      (casesQ.data ?? []).map((c) => ({
        id: c.id,
        providerId: c.providerId,
        payerId: c.payerId,
        state: c.state,
        status: c.caseStatus,
      })),
      infoByCase,
    );
    return decorateDenialRows(
      denialRows,
      new Map(
        (providersQ.data ?? []).map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]),
      ),
      new Map((payersQ.data ?? []).map((p) => [p.id, p.name])),
    );
  }, [casesQ.data, denialsQ.data, reasonsQ.data, providersQ.data, payersQ.data]);

  if (!orgId) {
    return <EmptyState message="Select an organization to see its denials." />;
  }
  const loading =
    casesQ.isLoading ||
    denialsQ.isLoading ||
    reasonsQ.isLoading ||
    providersQ.isLoading ||
    payersQ.isLoading;
  if (loading) return <Skeleton className="h-40 w-full" />;
  if (rows.length === 0) {
    return <EmptyState message="No denials recorded. Denied cases appear here immediately." />;
  }

  const grouped =
    pivot === "provider"
      ? Array.from(groupDenialsByProvider(rows), ([, list]) => ({
          heading: list[0].providerName,
          rows: list,
        }))
      : Array.from(groupDenialsByPayer(rows), ([, list]) => ({
          heading: list[0].payerName,
          rows: list,
        }));
  grouped.sort((a, b) => a.heading.localeCompare(b.heading));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={pivot} onValueChange={(v) => setPivot(v as Pivot)}>
          <TabsList>
            <TabsTrigger value="provider">By provider</TabsTrigger>
            <TabsTrigger value="payer">By payer</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          type="button"
          variant="outline"
          className="h-8"
          onClick={() => downloadCsvText("denials.csv", buildDenialsCsv(rows))}
        >
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>
      <div className="space-y-5">
        {grouped.map((g) => (
          <section key={g.heading} aria-label={g.heading}>
            <h2 className="mb-2 text-[14px] font-semibold text-foreground">
              {g.heading}
              <span className="ml-2 text-[12px] font-normal text-muted-foreground">
                {g.rows.length} denial{g.rows.length === 1 ? "" : "s"}
              </span>
            </h2>
            <DenialTable rows={g.rows} />
          </section>
        ))}
      </div>
    </div>
  );
}
