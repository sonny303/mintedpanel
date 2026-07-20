// E1.6 F1.6.1 + E4.2 hardening — the browsable global payer catalog (org_id IS
// NULL rows only) with the org-admin self-service Add / In-network / Reactivate /
// Remove controls derived from org_payer_assignments. Extracted from the
// /payer-directory route (E4.2 unified payer setup, TE-19) so the standalone
// page and the Payer Setup workspace's Catalog tab render ONE implementation —
// composition over duplication; the catalog filtering logic lives in
// src/lib/payerDirectory.ts either way. Non-admins browse read-only; there is
// deliberately NO free-text payer creation (identity is Minted-curated).
// 2026-07-20 catalog UX pass: the subscription verbs say what they do ("Add to
// my network" — an org-scoped org_payer_assignments row, never a catalog
// write); the list keeps browse columns only (catalog key + avg decision moved
// to the per-payer detail drill-in at catalog/$payerId); long state lists
// expand in place; an "In my network" filter narrows to adopted payers.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import { useGlobalPayers } from "@/hooks/usePayerCatalog";
import {
  useAddAssignment,
  useArchiveAssignment,
  useOrgPayerAssignments,
  useReactivateAssignment,
} from "@/hooks/useOrgPayerAssignments";
import { useIsAdmin } from "@/lib/permissions";
import {
  assignmentsByPayerId,
  catalogAction,
  isActiveAssignment,
  type CatalogAction,
} from "@/lib/payerCatalogActions";
import {
  DEFAULT_DIRECTORY_KIND,
  filterDirectoryRows,
  PAYER_KIND_LABELS,
  type DirectoryKindFilter,
} from "@/lib/payerDirectory";
import { US_STATES } from "@/lib/usStates";
import type { OrgPayerAssignment, Payer, PayerKind } from "@/types";

const KIND_PILL: Record<PayerKind, StatusColor> = {
  commercial: "brand",
  medicare: "blue",
  medicaid: "teal",
  medicaid_mco: "teal",
  medicare_advantage: "blue",
  tricare: "violet",
};

interface RowProps {
  payer: Payer;
  action: CatalogAction;
  canManage: boolean;
  pending: boolean;
  onAdd: (payer: Payer) => void;
  onReactivate: (payer: Payer) => void;
  onRemove: (payer: Payer) => void;
}

function ManageCell({
  payer,
  action,
  canManage,
  pending,
  onAdd,
  onReactivate,
  onRemove,
}: RowProps) {
  if (action.kind === "unavailable") {
    return (
      <span className="text-[12px] text-muted-foreground">
        {action.reason === "merged" ? "Merged" : "Retired"} — can&apos;t be added
        {action.reason === "merged" && action.successor ? (
          <>
            {" · use "}
            <span className="text-foreground">{action.successor.name}</span>
          </>
        ) : null}
      </span>
    );
  }
  if (action.kind === "added") {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <StatusPill status="green" label="In my network" />
        {canManage ? (
          <>
            <Link
              to="/onboarding/wizard"
              search={{ section: "payer_network" }}
              className="text-[12px] font-medium text-[#1B4D3E] underline underline-offset-2"
            >
              Configure credentialing scope
            </Link>
            <button
              type="button"
              className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              disabled={pending}
              onClick={() => onRemove(payer)}
            >
              Remove
            </button>
          </>
        ) : null}
      </span>
    );
  }
  if (!canManage) {
    // Non-admin / no-org browse: no mutation control.
    return <span className="text-[12px] text-muted-foreground">—</span>;
  }
  if (action.kind === "reactivate") {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-[11px]"
        disabled={pending}
        onClick={() => onReactivate(payer)}
      >
        Reactivate
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      className="h-7 bg-[#1B4D3E] px-2 text-[11px] text-white hover:bg-[#163F33]"
      disabled={pending}
      onClick={() => onAdd(payer)}
    >
      Add to my network
    </Button>
  );
}

/**
 * Item-3 fix for the truncated states column: up to four codes render inline;
 * longer lists get an in-place "+N more" popover with every state, so a
 * national payer's coverage is readable without leaving the list. The full
 * list also lives on the payer detail page.
 */
function StatesCell({ states }: { states: readonly string[] | null | undefined }) {
  const list = states ?? [];
  if (list.length === 0) return <>—</>;
  if (list.length <= 4) return <>{list.join(", ")}</>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span>{list.slice(0, 4).join(", ")}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="text-[12px] font-medium text-[#1B4D3E] underline underline-offset-2"
          >
            +{list.length - 4} more
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 border-[#E8E5E0] p-3 shadow-none">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {list.length} states
          </div>
          <div className="flex flex-wrap gap-1">
            {list.map((s) => (
              <span
                key={s}
                className="rounded-[4px] bg-[#F4F2EF] px-1.5 py-0.5 text-[11px] text-foreground"
              >
                {s}
              </span>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
}

function PayerRow(props: RowProps) {
  const { payer } = props;
  const kind = payer.payerKind ?? "commercial";
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2.5 align-top">
        {/* The name is the drill-in: identity facts (catalog key, avg decision,
            full coverage) + the payer's SOPs and portals live on the detail. */}
        <Link
          to="/admin/payer-admin/catalog/$payerId"
          params={{ payerId: payer.id }}
          className="text-[13px] font-medium text-foreground underline-offset-2 hover:underline"
        >
          {payer.name}
        </Link>
        {(payer.aliases ?? []).length > 0 ? (
          <div className="mt-0.5 max-w-[420px] truncate text-[11px] text-muted-foreground">
            {(payer.aliases ?? []).join(" · ")}
          </div>
        ) : null}
        {/* E6.5 F6.5.5 — delegation as a curated catalog fact (Minted-written;
            no app writer). Replaces the retired MSO routing engine: workflow
            detail belongs in the payer's SOP, this line says who to go through. */}
        {payer.delegationNote?.trim() ? (
          <div className="mt-1 max-w-[420px] rounded-[4px] border border-[#FDE68A] bg-[#FEF3C7] px-2 py-1 text-[11px] text-[#92400E]">
            Delegated: {payer.delegationNote}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-2.5 align-top">
        <StatusPill status={KIND_PILL[kind]} label={PAYER_KIND_LABELS[kind]} />
      </td>
      <td className="px-3 py-2.5 align-top text-[13px] text-foreground">
        <StatesCell states={payer.states} />
      </td>
      <td className="px-3 py-2.5 align-top">
        <ManageCell {...props} />
      </td>
    </tr>
  );
}

export function RemovePayerConfirmDialog({
  payer,
  onClose,
}: {
  payer: Payer;
  onClose: () => void;
}) {
  const archiveMut = useArchiveAssignment();
  const handleRemove = () => {
    archiveMut.mutate(payer.id, {
      onSuccess: (res) => {
        const n = res.archivedTargetCount;
        toast.success(
          n > 0
            ? `${payer.name} removed — ${n} network target${n === 1 ? "" : "s"} archived.`
            : `${payer.name} removed from your network`,
        );
        onClose();
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't remove the payer"),
    });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-[#E8E5E0] shadow-none">
        <DialogHeader>
          <DialogTitle>Remove {payer.name} from my network?</DialogTitle>
          <DialogDescription>
            This archives the payer for this organization along with any active credentialing scope
            (group × state targets) it has. Nothing is deleted — you can reactivate it later and
            restore its targets from Payer Network.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={archiveMut.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleRemove} disabled={archiveMut.isPending}>
            {archiveMut.isPending ? "Removing…" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PayerCatalogBrowser() {
  const { data, isLoading, isError, refetch } = useGlobalPayers();
  const assignmentsQ = useOrgPayerAssignments();
  const isAdmin = useIsAdmin();
  const addMut = useAddAssignment();
  const reactivateMut = useReactivateAssignment();

  const [query, setQuery] = useState("");
  const [state, setState] = useState<string>("all");
  const [kind, setKind] = useState<DirectoryKindFilter>(DEFAULT_DIRECTORY_KIND);
  const [network, setNetwork] = useState<"all" | "mine">("all");
  const [removing, setRemoving] = useState<Payer | null>(null);

  const payers = useMemo(() => data ?? [], [data]);
  const payerById = useMemo(() => new Map(payers.map((p) => [p.id, p])), [payers]);
  const assignByPayer = useMemo(
    () => assignmentsByPayerId((assignmentsQ.data as OrgPayerAssignment[] | undefined) ?? []),
    [assignmentsQ.data],
  );
  // Item-7 adopted-payers filter: "In my network" = an ACTIVE subscription
  // (org_payer_assignments), the same fact the Manage column renders — a
  // client-side narrowing over the already-loaded caches, nothing stored.
  const rows = useMemo(() => {
    const filtered = filterDirectoryRows(payers, { query, state, kind });
    if (network === "all") return filtered;
    return filtered.filter((p) => isActiveAssignment(assignByPayer.get(p.id)));
  }, [payers, query, state, kind, network, assignByPayer]);
  // An admin in an active org may mutate; everyone else browses read-only.
  const canManage = isAdmin && assignmentsQ.data !== undefined;

  // "In my network" means EVERY adopted payer — auto-widen the kind filter
  // (whose default is commercial-only) when it's selected, or an adopted
  // Medicaid MCO / MA payer would be silently dropped before the network
  // narrowing ever sees it (Devin review, PR #221). The widening is visible in
  // the Kind select and the user can still re-narrow afterward.
  const handleNetworkChange = (v: string) => {
    const next = v as "all" | "mine";
    setNetwork(next);
    if (next === "mine") setKind("all");
  };

  const handleAdd = (payer: Payer) => {
    addMut.mutate(payer.id, {
      onSuccess: () =>
        toast.success(`${payer.name} added to your network — configure credentialing scope next.`),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't add the payer"),
    });
  };
  const handleReactivate = (payer: Payer) => {
    reactivateMut.mutate(payer.id, {
      onSuccess: () => toast.success(`${payer.name} reactivated`),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't reactivate the payer"),
    });
  };
  const pendingId =
    (addMut.isPending ? addMut.variables : undefined) ??
    (reactivateMut.isPending ? reactivateMut.variables : undefined);

  return (
    <div className="space-y-4">
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
        <Select value={network} onValueChange={handleNetworkChange}>
          <SelectTrigger className="h-9 w-44" aria-label="Filter by network">
            <SelectValue placeholder="Network" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payers</SelectItem>
            <SelectItem value="mine">In my network</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-[12px] text-muted-foreground">
          {isLoading ? "Loading…" : `${rows.length} payer${rows.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {isError ? (
        <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] p-4 text-[13px] text-[#B91C1C]">
          Couldn&apos;t load the payer catalog.{" "}
          <button type="button" className="underline underline-offset-2" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Payer</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">States</th>
                <th className="px-3 py-2">Manage</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-8 text-center text-[13px] text-muted-foreground"
                  >
                    Loading the catalog…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-8 text-center text-[13px] text-muted-foreground"
                  >
                    No payers match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((p) => (
                  <PayerRow
                    key={p.id}
                    payer={p}
                    action={catalogAction(p, assignByPayer.get(p.id), payerById)}
                    canManage={canManage}
                    pending={pendingId === p.id}
                    onAdd={handleAdd}
                    onReactivate={handleReactivate}
                    onRemove={setRemoving}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {removing ? (
        <RemovePayerConfirmDialog payer={removing} onClose={() => setRemoving(null)} />
      ) : null}
    </div>
  );
}
