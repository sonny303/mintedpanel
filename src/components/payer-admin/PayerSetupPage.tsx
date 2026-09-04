// Payer & Cases design bundle, screen 1 (Slice A) — the Payer Setup page as
// ONE view, no tabs: header with a live count, four KPI FILTER cards
// (All / Needs template / Form not proven / Drift detected), a
// search · State · Kind · Show archived toolbar with the "+ Set up payer"
// entry, the `Payer · State(s) · Kind · Template status` table (Published /
// Needs template — one badge, no Partial), the payerless default-template
// card (edit-only), and 5–100 pagination. Supersedes the E6.5 catalog-tab
// composition (Ready-for-business funnel + catalog browse) on this route;
// the readiness DERIVATION is still the E6.5 funnel (usePayerReadinessFunnel)
// — this page only re-projects it via the pure src/lib/payerSetupView.ts.
//
// Deliberately NOT here (design "do not re-add"): next-step CTA column, drift
// alert banner, drafts strip, meta subtitle under the payer name, membership
// KPIs, the catalog browse, alias search, and the interactive +N-more state
// disclosure (long state lists truncate to text; full coverage lives on the
// payer detail).
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { usePayers, useReactivatePayer, useSops } from "@/hooks/useAdmin";
import { useActiveNetworkPayerIds } from "@/hooks/useActiveNetworkPayerIds";
import { usePayerReadinessFunnel } from "@/hooks/usePayerReadinessFunnel";
import { fmtDate } from "@/lib/format";
import { catalogSetupPayers } from "@/lib/payerSetup";
import { resolvePayerNextAction } from "@/lib/payerNextAction";
import {
  DEFAULT_PAYER_SETUP_FILTERS,
  DEFAULT_PAYER_SETUP_PAGE_SIZE,
  PAYER_SETUP_PAGE_SIZES,
  buildPayerSetupRows,
  countPayerSetupKpis,
  filterPayerSetupRows,
  paginateRows,
  payerSetupKindOptions,
  payerSetupStateOptions,
  type PayerSetupFilters,
  type PayerSetupKpiKey,
  type PayerSetupViewRow,
} from "@/lib/payerSetupView";
import { PAYER_KIND_LABELS, formatStates } from "@/lib/payerDirectory";
import { isFallbackTemplate } from "@/lib/pickTemplate";
import { useIsAdmin } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { FunnelRow } from "@/lib/payerReadinessFunnel";
import { ArrowRight } from "lucide-react";

const KPI_CARDS: Array<{ key: PayerSetupKpiKey; label: string }> = [
  { key: "all", label: "All payers" },
  { key: "needs_template", label: "Needs template" },
  { key: "form_not_proven", label: "Form not proven" },
  { key: "drift", label: "Drift detected" },
];

function KpiCard({
  label,
  count,
  selected,
  onToggle,
}: {
  label: string;
  count: number;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cn(
        "flex flex-col gap-2 rounded-[6px] border p-4 text-left transition-colors hover:border-[#1B4D3E]",
        selected ? "border-[#1B4D3E] bg-[#1B4D3E]" : "border-[#E8E5E0] bg-white",
      )}
    >
      <span
        className={cn(
          "text-[11px] font-semibold uppercase tracking-[.06em]",
          selected ? "text-white/70" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "text-[26px] font-bold leading-none",
          selected ? "text-white" : "text-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function TemplateStatusCell({
  row,
  isAdmin,
  reactivatingId,
  onReactivate,
}: {
  row: PayerSetupViewRow;
  isAdmin: boolean;
  reactivatingId: string | null;
  onReactivate: (row: PayerSetupViewRow) => void;
}) {
  if (row.archived) {
    return (
      <span className="inline-flex items-center gap-2.5">
        <StatusPill status="neutral" label="Archived" />
        {isAdmin ? (
          <button
            type="button"
            className="text-[12.5px] font-medium text-[#1B4D3E] underline-offset-2 hover:underline disabled:opacity-50"
            disabled={reactivatingId === row.payerId}
            onClick={() => onReactivate(row)}
          >
            {reactivatingId === row.payerId ? "Reactivating…" : "Reactivate"}
          </button>
        ) : null}
      </span>
    );
  }
  return row.templateStatus === "published" ? (
    <StatusPill status="green" label="Published" />
  ) : (
    <StatusPill status="amber" label="Needs template" />
  );
}

/** Three-step orientation for an empty catalog (design zero-payers state). */
const ZERO_STEPS = [
  { n: 1, title: "Add a payer", desc: "Name, states, and the IDs it issues." },
  { n: 2, title: "Author a template", desc: "The tasks a case follows for that payer." },
  { n: 3, title: "Attach to a group", desc: "From that group's Payer Network board." },
];

function ZeroPayersCard({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="rounded-[6px] border border-[#E8E5E0] bg-white px-6 py-12 text-center">
      <div className="text-[17px] font-semibold text-foreground">No payers yet</div>
      <p className="mx-auto mt-1 max-w-md text-[13.5px] text-muted-foreground">
        Add payers to the catalog. Attach a payer to a group from Groups → Payer Network when that
        group credentials with it.
      </p>
      <div className="mx-auto mt-6 flex max-w-xl flex-wrap items-start justify-center">
        {ZERO_STEPS.map((step, i) => (
          <div key={step.n} className="flex items-start">
            <div className="flex w-[150px] flex-col items-center gap-1.5">
              <span
                className={cn(
                  "flex h-[26px] w-[26px] items-center justify-center rounded-full text-[12px] font-bold",
                  i === 0 ? "bg-[#1B4D3E] text-white" : "bg-[#F1F1EF] text-muted-foreground",
                )}
              >
                {step.n}
              </span>
              <span
                className={cn(
                  "text-[13px] font-medium",
                  i === 0 ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {step.title}
              </span>
              <span className="text-center text-[12px] leading-snug text-muted-foreground">
                {step.desc}
              </span>
            </div>
            {i < ZERO_STEPS.length - 1 ? (
              <span aria-hidden className="mt-3 h-px w-5 bg-[#DCDAD4]" />
            ) : null}
          </div>
        ))}
      </div>
      {isAdmin ? (
        <Button asChild className="mt-6 bg-[#1B4D3E] text-white hover:bg-[#163F33]">
          <Link to="/admin/payers/new">+ Add your first payer</Link>
        </Button>
      ) : null}
    </div>
  );
}

function FilteredToNoneCard({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-[6px] border border-[#E8E5E0] bg-white px-6 py-10 text-center">
      <div className="text-[15px] font-semibold text-foreground">No payers match these filters</div>
      <p className="mx-auto mt-1 max-w-sm text-[13.5px] text-muted-foreground">
        There are payers in the catalog — none of them match what you&apos;ve selected.
      </p>
      <Button variant="outline" className="mt-4" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  );
}

/** The payerless fallback template — edit-only by design (no create path; the
 * seeded fallback row is the one place the generic checklist lives). Rendered
 * only when the fallback row resolves so nothing mock ever shows. */
function DefaultTemplateCard() {
  const templatesQ = useSops();
  const fallback = useMemo(
    () => (templatesQ.data ?? []).find((t) => isFallbackTemplate(t) && !t.archived) ?? null,
    [templatesQ.data],
  );
  if (!fallback) return null;
  const taskCount = fallback.taskDefinitions.length;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[6px] border border-[#E8E5E0] bg-white px-4 py-3.5">
      <div className="min-w-[220px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/admin/templates/$id"
            params={{ id: fallback.id }}
            className="text-[14px] font-semibold text-foreground underline-offset-2 hover:underline"
          >
            {fallback.name}
          </Link>
          <span className="inline-flex h-5 items-center rounded-[4px] border border-[#E8E5E0] bg-[#F5F4F1] px-2 text-[11.5px] font-medium text-muted-foreground">
            Default template
          </span>
        </div>
        <div className="mt-0.5 text-[12.5px] text-muted-foreground">
          Used when no payer template matches · {taskCount} task{taskCount === 1 ? "" : "s"} ·
          updated {fmtDate(fallback.updatedAt)}
        </div>
      </div>
      <Button asChild variant="outline" size="sm" className="h-8 flex-none">
        <Link to="/admin/templates/$id" params={{ id: fallback.id }}>
          Edit
        </Link>
      </Button>
    </div>
  );
}

function NextActionCell({
  row,
  funnel,
  inNetwork,
}: {
  row: PayerSetupViewRow;
  funnel: FunnelRow | null;
  inNetwork: boolean;
}) {
  if (row.archived) {
    // Badge lives under Template status — do not repeat "Archived" here
    // (strict-mode e2e and visual noise).
    return <span className="text-[12.5px] text-muted-foreground">—</span>;
  }
  const action = resolvePayerNextAction({ funnel, inNetwork, archived: false });

  if (action.kind === "ready" || action.kind === "ready_no_form") {
    return <StatusPill status="green" label={action.label} />;
  }

  if (action.kind === "author_template") {
    return (
      <Link
        to="/admin/templates/new"
        search={{ payerId: row.payerId, tier: "global" }}
        className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#1B4D3E] underline-offset-2 hover:underline"
      >
        {action.label} <ArrowRight className="h-3 w-3" />
      </Link>
    );
  }

  if (action.kind === "attach_group") {
    return (
      <Link
        to="/groups"
        className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#1B4D3E] underline-offset-2 hover:underline"
      >
        {action.label} <ArrowRight className="h-3 w-3" />
      </Link>
    );
  }

  if (action.templateId && action.intent) {
    return (
      <Link
        to="/admin/templates/$id"
        params={{ id: action.templateId }}
        search={{ intent: action.intent }}
        className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#1B4D3E] underline-offset-2 hover:underline"
      >
        {action.label} <ArrowRight className="h-3 w-3" />
      </Link>
    );
  }

  return (
    <Link
      to="/admin/payer-admin/setup/$payerId"
      params={{ payerId: row.payerId }}
      search={action.detailTab ? { tab: action.detailTab } : undefined}
      className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#1B4D3E] underline-offset-2 hover:underline"
    >
      {action.label} <ArrowRight className="h-3 w-3" />
    </Link>
  );
}

export function PayerSetupPage() {
  const payersQ = usePayers();
  const funnel = usePayerReadinessFunnel();
  const networkIds = useActiveNetworkPayerIds();
  const isAdmin = useIsAdmin();
  const reactivateMut = useReactivatePayer();

  const [filters, setFilters] = useState<PayerSetupFilters>(DEFAULT_PAYER_SETUP_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAYER_SETUP_PAGE_SIZE);

  const setFilter = (patch: Partial<PayerSetupFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const funnelByPayer = useMemo(() => {
    const map = new Map<string, FunnelRow>();
    for (const row of funnel.rows ?? []) map.set(row.payerId, row);
    return map;
  }, [funnel.rows]);

  // Catalog inclusion (no group-attach filter). Archived rows ride the same
  // rule with the opt-in flag; funnel rows (active payers only) carry the
  // readiness facts.
  const rows = useMemo(() => {
    const included = catalogSetupPayers(payersQ.data ?? [], { includeArchived: true });
    return buildPayerSetupRows(included, funnel.rows ?? []);
  }, [payersQ.data, funnel.rows]);

  const kpis = useMemo(() => countPayerSetupKpis(rows), [rows]);
  const visible = useMemo(() => filterPayerSetupRows(rows, filters), [rows, filters]);
  const slice = useMemo(() => paginateRows(visible, page, pageSize), [visible, page, pageSize]);
  const stateOptions = useMemo(() => payerSetupStateOptions(rows), [rows]);
  const kindOptions = useMemo(() => payerSetupKindOptions(rows), [rows]);

  const totalCount = rows.length;
  const isLoading = funnel.isLoading || payersQ.isLoading;
  const isError = funnel.isError || payersQ.isError;

  const handleReactivate = (row: PayerSetupViewRow) => {
    reactivateMut.mutate(row.payerId, {
      onSuccess: () => toast.success(`${row.name} reactivated`),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't reactivate the payer"),
    });
  };
  const reactivatingId = reactivateMut.isPending ? reactivateMut.variables : null;

  const kpiCounts: Record<PayerSetupKpiKey, number> = {
    all: kpis.all,
    needs_template: kpis.needsTemplate,
    form_not_proven: kpis.formNotProven,
    drift: kpis.drift,
  };

  return (
    <div>
      <PageHeader
        title="Payer Setup"
        description={
          isLoading
            ? "Loading payers…"
            : `${totalCount} payer${totalCount === 1 ? "" : "s"} in the catalog. Attaching a payer to a group happens on Groups → Payer Network.`
        }
      />

      {isError ? (
        <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] p-4 text-[13px] text-[#B91C1C]">
          Couldn&apos;t load payers. Refresh the page to retry.
        </div>
      ) : isLoading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {KPI_CARDS.map((card) => (
              <Skeleton key={card.key} className="h-[84px] rounded-[6px]" />
            ))}
          </div>
          <Skeleton className="h-9 w-72 rounded-[4px]" />
          <Skeleton className="h-48 rounded-[6px]" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {KPI_CARDS.map((card) => (
              <KpiCard
                key={card.key}
                label={card.label}
                count={kpiCounts[card.key]}
                selected={filters.kpi === card.key}
                onToggle={() => setFilter({ kpi: filters.kpi === card.key ? "all" : card.key })}
              />
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Input
              value={filters.search}
              onChange={(e) => setFilter({ search: e.target.value })}
              placeholder="Search payers…"
              aria-label="Search payers"
              className="h-9 w-full min-w-[180px] flex-1 basis-[220px] sm:w-auto"
            />
            <Select value={filters.state} onValueChange={(v) => setFilter({ state: v })}>
              <SelectTrigger className="h-9 w-[130px] flex-none" aria-label="Filter by state">
                <SelectValue placeholder="State" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All states</SelectItem>
                {stateOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.kind} onValueChange={(v) => setFilter({ kind: v })}>
              <SelectTrigger className="h-9 w-[180px] flex-none" aria-label="Filter by payer kind">
                <SelectValue placeholder="Kind" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All kinds</SelectItem>
                {kindOptions.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {PAYER_KIND_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="flex flex-none items-center gap-2">
              <Checkbox
                id="payer-setup-show-archived"
                checked={filters.showArchived}
                onCheckedChange={(checked) => setFilter({ showArchived: checked === true })}
              />
              <Label
                htmlFor="payer-setup-show-archived"
                className="cursor-pointer whitespace-nowrap text-[13px] font-normal text-[#4B5563]"
              >
                Show archived
              </Label>
            </span>
            {isAdmin ? (
              <Button asChild className="flex-none bg-[#1B4D3E] text-white hover:bg-[#163F33]">
                <Link to="/admin/payers/new">+ Set up payer</Link>
              </Button>
            ) : null}
          </div>

          {totalCount === 0 ? (
            <div className="mt-4">
              <ZeroPayersCard isAdmin={isAdmin} />
            </div>
          ) : visible.length === 0 ? (
            <div className="mt-4">
              <FilteredToNoneCard
                onClear={() => setFilter({ kpi: "all", search: "", state: "all", kind: "all" })}
              />
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-[6px] border border-[#E8E5E0] bg-white">
              <table className="w-full min-w-[800px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#E8E5E0] bg-[#FBFBF9] text-[11px] font-semibold uppercase tracking-[.05em] text-muted-foreground">
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Payer
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">
                      State(s)
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">
                      Kind
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Template status
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Next action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {slice.pageRows.map((row) => (
                    <tr key={row.payerId} className="border-b border-[#F0EEEA] last:border-b-0">
                      <td className="px-4 py-3">
                        <Link
                          to="/admin/payer-admin/setup/$payerId"
                          params={{ payerId: row.payerId }}
                          className="text-[14px] font-semibold text-foreground underline-offset-2 hover:text-[#1B4D3E] hover:underline"
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td
                        className="px-3 py-3 text-[13px] text-muted-foreground"
                        title={row.states.length > 4 ? row.states.join(", ") : undefined}
                      >
                        {formatStates(row.states)}
                      </td>
                      <td className="px-3 py-3 text-[13px] text-muted-foreground">
                        {PAYER_KIND_LABELS[row.kind]}
                      </td>
                      <td className="px-4 py-3">
                        <TemplateStatusCell
                          row={row}
                          isAdmin={isAdmin}
                          reactivatingId={reactivatingId ?? null}
                          onReactivate={handleReactivate}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <NextActionCell
                          row={row}
                          funnel={funnelByPayer.get(row.payerId) ?? null}
                          inNetwork={networkIds.has(row.payerId)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <DefaultTemplateCard />

          {visible.length > 0 ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Label
                  htmlFor="payer-setup-page-size"
                  className="whitespace-nowrap text-[13px] font-normal text-muted-foreground"
                >
                  Rows per page
                </Label>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => {
                    setPageSize(Number(v));
                    setPage(1);
                  }}
                >
                  <SelectTrigger
                    id="payer-setup-page-size"
                    className="h-8 w-[76px]"
                    aria-label="Rows per page"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYER_SETUP_PAGE_SIZES.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="whitespace-nowrap text-[13px] text-muted-foreground">
                  Showing {slice.from}–{slice.to} of {visible.length} payer
                  {visible.length === 1 ? "" : "s"}
                </span>
              </div>
              {slice.totalPages > 1 ? (
                <nav aria-label="Pagination" className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={slice.page <= 1}
                    onClick={() => setPage(slice.page - 1)}
                  >
                    Prev
                  </Button>
                  {slice.totalPages <= 7 ? (
                    Array.from({ length: slice.totalPages }, (_, i) => i + 1).map((n) => (
                      <Button
                        key={n}
                        variant="outline"
                        size="sm"
                        aria-current={n === slice.page ? "page" : undefined}
                        className={cn(
                          "h-8 min-w-8 px-2",
                          n === slice.page &&
                            "border-[#1B4D3E] bg-[#1B4D3E] text-white hover:bg-[#163F33] hover:text-white",
                        )}
                        onClick={() => setPage(n)}
                      >
                        {n}
                      </Button>
                    ))
                  ) : (
                    <span className="px-1 text-[13px] text-muted-foreground">
                      Page {slice.page} of {slice.totalPages}
                    </span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={slice.page >= slice.totalPages}
                    onClick={() => setPage(slice.page + 1)}
                  >
                    Next
                  </Button>
                </nav>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
