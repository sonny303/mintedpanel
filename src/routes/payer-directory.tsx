// E1.6 F1.6.1 — the cross-org Payer Directory: the browsable global catalog
// (org_id IS NULL rows only — org-scoped legacy payers never appear here).
// Search by name/alias; filter by state and kind (commercial by default —
// government kinds are dormant until R10). Read-only for org users; the
// F1.6.3 review queue renders above the table when diffs await. No nav entry
// yet — Sidebar edits aren't §5-authorized for this epic (logged in
// TECH-DEBT.md); the route is URL-reachable like other pre-nav surfaces.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import { PayerCatalogChangesPanel } from "@/components/payers/PayerCatalogChangesPanel";
import { useGlobalPayers } from "@/hooks/usePayerCatalog";
import {
  DEFAULT_DIRECTORY_KIND,
  filterDirectoryRows,
  formatStates,
  PAYER_KIND_LABELS,
  type DirectoryKindFilter,
} from "@/lib/payerDirectory";
import { US_STATES } from "@/lib/usStates";
import type { Payer, PayerKind } from "@/types";

export const Route = createFileRoute("/payer-directory")({
  component: PayerDirectoryPage,
});

const KIND_PILL: Record<PayerKind, StatusColor> = {
  commercial: "brand",
  medicare: "blue",
  medicaid: "teal",
  medicaid_mco: "teal",
  medicare_advantage: "blue",
  tricare: "violet",
};

function PayerRow({ payer }: { payer: Payer }) {
  const kind = payer.payerKind ?? "commercial";
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2.5 align-top">
        <div className="text-[13px] font-medium text-foreground">{payer.name}</div>
        {(payer.aliases ?? []).length > 0 ? (
          <div className="mt-0.5 max-w-[420px] truncate text-[11px] text-muted-foreground">
            {(payer.aliases ?? []).join(" · ")}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-2.5 align-top">
        <StatusPill status={KIND_PILL[kind]} label={PAYER_KIND_LABELS[kind]} />
      </td>
      <td className="px-3 py-2.5 align-top text-[13px] text-foreground">
        {formatStates(payer.states)}
      </td>
      <td className="px-3 py-2.5 align-top text-[13px] text-muted-foreground">
        {payer.payerSlug || "—"}
      </td>
      <td className="px-3 py-2.5 align-top text-[13px] text-muted-foreground">
        {payer.avgDecisionDays != null ? `${payer.avgDecisionDays} days` : "—"}
      </td>
      <td className="px-3 py-2.5 align-top text-[13px] text-muted-foreground">
        {payer.caqhPullDeadlineDays != null ? `${payer.caqhPullDeadlineDays} days` : "—"}
      </td>
      <td className="px-3 py-2.5 align-top">
        {payer.portalUrl ? (
          <a
            href={payer.portalUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[13px] text-[#1B4D3E] underline-offset-2 hover:underline"
          >
            Portal <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        ) : (
          <span className="text-[13px] text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 align-top">
        {(payer.status ?? "active") !== "active" ? (
          <StatusPill status="neutral" label={payer.status === "merged" ? "Merged" : "Retired"} />
        ) : null}
      </td>
    </tr>
  );
}

function PayerDirectoryPage() {
  const { data, isLoading, isError, refetch } = useGlobalPayers();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<string>("all");
  const [kind, setKind] = useState<DirectoryKindFilter>(DEFAULT_DIRECTORY_KIND);

  const payers = useMemo(() => data ?? [], [data]);
  const rows = useMemo(
    () => filterDirectoryRows(payers, { query, state, kind }),
    [payers, query, state, kind],
  );

  return (
    <div>
      <PageHeader
        title="Payer Directory"
        description="The global payer catalog — one canonical identity per payer, with the operational credentialing facts attached."
      />
      <div className="space-y-4">
        <PayerCatalogChangesPanel payers={payers} />

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or alias…"
            aria-label="Search payers"
            className="h-9 w-72"
          />
          <Select value={state} onValueChange={setState}>
            <SelectTrigger className="h-9 w-40" aria-label="Filter by state">
              <SelectValue placeholder="State" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              {US_STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={kind} onValueChange={(v) => setKind(v as DirectoryKindFilter)}>
            <SelectTrigger className="h-9 w-52" aria-label="Filter by payer kind">
              <SelectValue placeholder="Kind" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="commercial">Commercial (default)</SelectItem>
              <SelectItem value="medicaid_mco">Medicaid MCO</SelectItem>
              <SelectItem value="medicare_advantage">Medicare Advantage</SelectItem>
              <SelectItem value="tricare">TRICARE</SelectItem>
              <SelectItem value="medicare">Medicare</SelectItem>
              <SelectItem value="medicaid">Medicaid</SelectItem>
              <SelectItem value="all">All kinds</SelectItem>
            </SelectContent>
          </Select>
          <span className="ml-auto text-[12px] text-muted-foreground">
            {isLoading ? "Loading…" : `${rows.length} payer${rows.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {isError ? (
          <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] p-4 text-[13px] text-[#B91C1C]">
            Couldn&apos;t load the payer catalog.{" "}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => refetch()}
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-[880px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Payer</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">States</th>
                  <th className="px-3 py-2">Catalog key</th>
                  <th className="px-3 py-2">Avg decision</th>
                  <th className="px-3 py-2">CAQH pull</th>
                  <th className="px-3 py-2">Portal</th>
                  <th className="px-3 py-2">
                    <span className="sr-only">Status</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-8 text-center text-[13px] text-muted-foreground"
                    >
                      Loading the catalog…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-8 text-center text-[13px] text-muted-foreground"
                    >
                      No payers match the current filters.
                    </td>
                  </tr>
                ) : (
                  rows.map((p) => <PayerRow key={p.id} payer={p} />)
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
