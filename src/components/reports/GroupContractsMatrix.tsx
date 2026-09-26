import { useMemo, useState } from "react";
import { Search, Plus, FileText, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill } from "@/components/triage/StatusPill";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useContracts } from "@/hooks/useContracts";
import { usePayers, useStatusConfigs } from "@/hooks/useAdmin";
import { useProviderGroups, useFacilities } from "@/hooks/useLookups";
import { usePayerNetworkTargets } from "@/hooks/usePayerNetworkTargets";
import { PRE_CRED_PAYER_NAME } from "@/lib/statusLabels";
import { fmtDate } from "@/lib/format";
import type { Contract, Payer } from "@/types";
import { ContractDetailDrawer } from "./ContractDetailDrawer";

export function GroupContractsMatrix() {
  const groupsQ = useProviderGroups();
  const payersQ = usePayers();
  const contractsQ = useContracts();
  const statusesQ = useStatusConfigs("contracting");
  const facilitiesQ = useFacilities();
  const targetsQ = usePayerNetworkTargets();

  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [payerSearch, setPayerSearch] = useState<string>("");

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeCell, setActiveCell] = useState<{
    contract: Contract | null;
    payerId: string;
    payerName: string;
    state: string;
  } | null>(null);

  const groups = useMemo(() => groupsQ.data ?? [], [groupsQ.data]);
  const activeGroupId = selectedGroupId || groups[0]?.id || "";
  const currentGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId),
    [groups, activeGroupId],
  );

  const statusById = useMemo(
    () => new Map((statusesQ.data ?? []).map((s) => [s.id, s])),
    [statusesQ.data],
  );

  // Determine active states for the chosen group
  const states = useMemo(() => {
    if (!activeGroupId) return [];
    const set = new Set<string>();

    (facilitiesQ.data ?? []).forEach((f) => {
      if (f.groupId === activeGroupId && f.state) {
        set.add(f.state.toUpperCase());
      }
    });

    (contractsQ.data ?? []).forEach((c) => {
      if (c.groupId === activeGroupId && c.state) {
        set.add(c.state.toUpperCase());
      }
    });

    (targetsQ.data ?? []).forEach((t) => {
      if (t.groupId === activeGroupId && t.state) {
        set.add(t.state.toUpperCase());
      }
    });

    return Array.from(set).sort();
  }, [activeGroupId, facilitiesQ.data, contractsQ.data, targetsQ.data]);

  // Contracts lookup map for selected group: `${payerId}|${state}` => Contract
  const contractsByKey = useMemo(() => {
    const map = new Map<string, Contract>();
    (contractsQ.data ?? []).forEach((c) => {
      if (c.groupId === activeGroupId && c.payerId && c.state) {
        map.set(`${c.payerId}|${c.state.toUpperCase()}`, c);
      }
    });
    return map;
  }, [contractsQ.data, activeGroupId]);

  // Payers list filtered by search
  const filteredPayers = useMemo(() => {
    const list = (payersQ.data ?? []).filter((p) => p.name !== PRE_CRED_PAYER_NAME);
    const search = payerSearch.trim().toLowerCase();
    if (!search) return list;
    return list.filter((p) => p.name.toLowerCase().includes(search));
  }, [payersQ.data, payerSearch]);

  // Contracts with notes for footer dependencies card
  const groupNotes = useMemo(() => {
    const list: Array<{ contract: Contract; payerName: string }> = [];
    const payerMap = new Map((payersQ.data ?? []).map((p) => [p.id, p.name]));
    (contractsQ.data ?? []).forEach((c) => {
      if (c.groupId === activeGroupId && c.notes?.trim()) {
        const payerName = c.payerId
          ? (payerMap.get(c.payerId) ?? "Unknown Payer")
          : "Unknown Payer";
        list.push({ contract: c, payerName });
      }
    });
    return list;
  }, [contractsQ.data, activeGroupId, payersQ.data]);

  const isLoading = groupsQ.isLoading || payersQ.isLoading || contractsQ.isLoading;
  const isError = groupsQ.isError || payersQ.isError || contractsQ.isError;

  if (isLoading) {
    return <div className="h-64 rounded-lg bg-muted animate-pulse" />;
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <EmptyState
          message="Failed to load group contracts matrix"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                contractsQ.refetch();
                groupsQ.refetch();
                payersQ.refetch();
              }}
            >
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <EmptyState message="No provider groups found in this organization" />
      </div>
    );
  }

  function handleCellClick(payer: Payer, state: string) {
    const contract = contractsByKey.get(`${payer.id}|${state}`) ?? null;
    setActiveCell({
      contract,
      payerId: payer.id,
      payerName: payer.name,
      state,
    });
    setDrawerOpen(true);
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        {/* Top Control Bar: Group Selector, Payer Search, Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-card p-4 rounded-lg border border-border shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Provider Group
              </span>
              <Select value={activeGroupId} onValueChange={setSelectedGroupId}>
                <SelectTrigger className="w-[260px] h-9 font-medium">
                  <SelectValue placeholder="Select Group" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      <span className="truncate">{g.name}</span>
                      {g.tin ? (
                        <span className="ml-2 text-xs text-muted-foreground">({g.tin})</span>
                      ) : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Filter Payers
              </span>
              <div className="relative w-[200px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8 h-9 text-xs"
                  placeholder="Search payer..."
                  value={payerSearch}
                  onChange={(e) => setPayerSearch(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <div className="text-xs text-muted-foreground text-right mr-2 hidden md:block">
              <span className="font-semibold text-foreground">{contractsByKey.size}</span> active
              contracts mapped
            </div>
          </div>
        </div>

        {/* Status Legend Bar */}
        <div className="bg-muted/40 border border-border/80 rounded-md p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
            Legend:
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold border border-emerald-300">
                x
              </span>
              <span>In-Network</span>
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold border border-amber-300">
                x
              </span>
              <span>In Progress (Signed)</span>
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="h-2 w-2 rounded-full bg-blue-600" />
              <span>Application Submitted</span>
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="h-2 w-2 rounded-full bg-orange-600" />
              <span>Appealed</span>
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="h-2 w-2 rounded-full bg-red-600" />
              <span>Denied</span>
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="h-2 w-2 rounded-full bg-slate-500" />
              <span>OON</span>
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <span>—</span>
              <span>Not Started</span>
            </span>
          </div>
        </div>

        {/* Matrix Grid Table */}
        {states.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-12 text-center">
            <EmptyState
              message="No states or facilities assigned to this group"
              description="Attach payers or facilities in the onboarding wizard to expand contracting states."
            />
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card shadow-sm overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/60">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground sticky left-0 bg-muted/90 backdrop-blur z-10 w-[240px]">
                    Payer
                  </th>
                  {states.map((s) => (
                    <th
                      key={s}
                      className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wider text-muted-foreground min-w-[110px] border-l border-border/60"
                    >
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredPayers.map((payer) => (
                  <tr key={payer.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground sticky left-0 bg-card z-10 whitespace-nowrap shadow-[2px_0_4px_rgba(0,0,0,0.02)]">
                      <span className="block truncate max-w-[220px]" title={payer.name}>
                        {payer.name}
                      </span>
                    </td>
                    {states.map((s) => {
                      const contract = contractsByKey.get(`${payer.id}|${s}`);
                      const status = contract?.contractingStatusId
                        ? statusById.get(contract.contractingStatusId)
                        : null;
                      const statusLabel = status?.label ?? "";

                      const isSignedOrInNetwork =
                        statusLabel === "In-Network" ||
                        statusLabel === "In Progress (Contract Signed)" ||
                        statusLabel === "Contracted";

                      return (
                        <td
                          key={s}
                          onClick={() => handleCellClick(payer, s)}
                          className="px-2 py-2.5 text-center border-l border-border/60 cursor-pointer hover:bg-muted/50 transition-colors"
                        >
                          {contract ? (
                            <div className="inline-flex flex-col items-center justify-center gap-0.5">
                              {/* Primary symbol / badge */}
                              {statusLabel === "In-Network" ? (
                                <span className="font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 rounded px-1.5 py-0.5 text-xs">
                                  x
                                </span>
                              ) : statusLabel === "In Progress (Contract Signed)" ? (
                                <span className="font-bold text-amber-800 bg-amber-100 border border-amber-300 rounded px-1.5 py-0.5 text-xs">
                                  x
                                </span>
                              ) : status ? (
                                <span
                                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded border"
                                  style={{
                                    backgroundColor: `${status.color}15`,
                                    borderColor: `${status.color}40`,
                                    color: status.color,
                                  }}
                                >
                                  {status.label}
                                </span>
                              ) : (
                                <span className="font-semibold text-muted-foreground text-xs">
                                  x
                                </span>
                              )}

                              {/* Tentative Date */}
                              {contract.tentativeEffectiveDate ? (
                                <span className="text-[10px] text-amber-700 font-medium whitespace-nowrap">
                                  tent {fmtDate(contract.tentativeEffectiveDate)}
                                </span>
                              ) : null}

                              {/* Effective Date */}
                              {contract.effectiveDate && statusLabel === "In-Network" ? (
                                <span className="text-[10px] text-emerald-700 font-medium whitespace-nowrap">
                                  eff {fmtDate(contract.effectiveDate)}
                                </span>
                              ) : null}

                              {/* Notes indicator icon */}
                              {contract.notes?.trim() ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-block mt-0.5 text-muted-foreground hover:text-foreground">
                                      <FileText className="h-3 w-3" />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-xs text-xs">
                                    <p className="font-semibold">
                                      {payer.name} ({s}) Note:
                                    </p>
                                    <p>{contract.notes}</p>
                                  </TooltipContent>
                                </Tooltip>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-muted-foreground/50 hover:text-foreground text-sm font-light select-none">
                              —
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer Notes: Cross-Payer Dependencies Card */}
        <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Cross-Payer Dependencies & Contract Notes
            </h4>
          </div>
          {groupNotes.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No cross-payer dependencies or notes recorded for {currentGroup?.name ?? "this group"}
              . Click any cell in the matrix to record prerequisites.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              {groupNotes.map(({ contract, payerName }) => (
                <div
                  key={contract.id}
                  className="bg-muted/30 border border-border/70 rounded p-2.5 flex items-start gap-2"
                >
                  <span className="font-bold text-foreground shrink-0">
                    {payerName} ({contract.state}):
                  </span>
                  <span className="text-muted-foreground break-words">{contract.notes}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Edit Drawer */}
        {activeCell ? (
          <ContractDetailDrawer
            open={drawerOpen}
            onClose={() => {
              setDrawerOpen(false);
              setActiveCell(null);
            }}
            contract={activeCell.contract}
            groupId={activeGroupId}
            payerId={activeCell.payerId}
            state={activeCell.state}
            groupName={currentGroup?.name}
            payerName={activeCell.payerName}
          />
        ) : null}
      </div>
    </TooltipProvider>
  );
}
