import { useMemo, useState } from "react";
import { Search, FileText, AlertCircle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useContracts } from "@/hooks/useContracts";
import { usePayers, useStatusConfigs } from "@/hooks/useAdmin";
import { useProviderGroups, useFacilities } from "@/hooks/useLookups";
import { usePayerNetworkTargets } from "@/hooks/usePayerNetworkTargets";
import { resolveActiveGroupIds } from "@/lib/groupContractsMatrixSelection";
import { PRE_CRED_PAYER_NAME } from "@/lib/statusLabels";
import { fmtDate } from "@/lib/format";
import type { Contract, Payer } from "@/types";
import { ContractDetailDrawer } from "./ContractDetailDrawer";

const ALL_SPECIALTIES = "__all_specialties__";
const UNSPECIFIED_SPECIALTY = "__unspecified_specialty__";

interface ContractsMatrixContext {
  groupId?: string;
  payerId?: string;
  state?: string;
}

function specialtyKey(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() ?? "";
}

export function GroupContractsMatrix({
  initialContext,
}: {
  initialContext?: ContractsMatrixContext;
}) {
  const groupsQ = useProviderGroups();
  const payersQ = usePayers();
  const contractsQ = useContracts();
  const statusesQ = useStatusConfigs("contracting");
  const facilitiesQ = useFacilities();
  const targetsQ = usePayerNetworkTargets();

  const [selectedGroupIds, setSelectedGroupIds] = useState<string[] | null>(null);
  const [selectedSpecialty, setSelectedSpecialty] = useState(ALL_SPECIALTIES);
  const [payerSearch, setPayerSearch] = useState<string>("");

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeCell, setActiveCell] = useState<{
    contract: Contract | null;
    groupId: string;
    groupName: string;
    payerId: string;
    payerName: string;
    state: string;
  } | null>(null);

  const groups = useMemo(() => groupsQ.data ?? [], [groupsQ.data]);
  const activeGroupIds = useMemo(
    () =>
      resolveActiveGroupIds({
        groups,
        selectedGroupIds,
        contextGroupId: initialContext?.groupId,
      }),
    [selectedGroupIds, groups, initialContext?.groupId],
  );
  const activeGroups = useMemo(
    () => groups.filter((group) => activeGroupIds.includes(group.id)),
    [groups, activeGroupIds],
  );
  const contextPayer = (payersQ.data ?? []).find((payer) => payer.id === initialContext?.payerId);
  const contextGroup = useMemo(
    () => groups.find((group) => group.id === initialContext?.groupId),
    [groups, initialContext?.groupId],
  );

  const specialtyOptions = useMemo(() => {
    const options = new Map<string, string>();
    (contractsQ.data ?? []).forEach((contract) => {
      const label = contract.specialty?.trim();
      if (label) options.set(specialtyKey(label), label);
      else options.set(UNSPECIFIED_SPECIALTY, "Multi-Specialty / Unspecified");
    });
    return Array.from(options, ([key, label]) => ({ key, label })).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [contractsQ.data]);

  const statusById = useMemo(
    () => new Map((statusesQ.data ?? []).map((s) => [s.id, s])),
    [statusesQ.data],
  );

  const matrixGroups = useMemo(() => {
    const payers = (payersQ.data ?? []).filter((p) => p.name !== PRE_CRED_PAYER_NAME);
    const payerMap = new Map(payers.map((payer) => [payer.id, payer.name]));
    const search = payerSearch.trim().toLocaleLowerCase();

    return activeGroups.map((group) => {
      const contracts = (contractsQ.data ?? []).filter(
        (contract) =>
          contract.groupId === group.id &&
          (selectedSpecialty === ALL_SPECIALTIES ||
            (selectedSpecialty === UNSPECIFIED_SPECIALTY
              ? !specialtyKey(contract.specialty)
              : specialtyKey(contract.specialty) === selectedSpecialty)),
      );
      const contractsByKey = new Map<string, Contract>();
      const states = new Set<string>();
      contracts.forEach((contract) => {
        if (contract.state) states.add(contract.state.toUpperCase());
        if (contract.payerId && contract.state) {
          contractsByKey.set(`${contract.payerId}|${contract.state.toUpperCase()}`, contract);
        }
      });
      if (selectedSpecialty === ALL_SPECIALTIES) {
        (facilitiesQ.data ?? []).forEach((facility) => {
          if (facility.groupId === group.id && facility.state) {
            states.add(facility.state.toUpperCase());
          }
        });
        (targetsQ.data ?? []).forEach((target) => {
          if (target.groupId === group.id && target.state) {
            states.add(target.state.toUpperCase());
          }
        });
      }

      const matchedPayerIds = new Set(contracts.map((contract) => contract.payerId));
      const filteredPayers = payers.filter(
        (payer) =>
          (selectedSpecialty === ALL_SPECIALTIES || matchedPayerIds.has(payer.id)) &&
          (!search || payer.name.toLocaleLowerCase().includes(search)),
      );
      const filteredPayerIds = new Set(filteredPayers.map((payer) => payer.id));
      const notes = contracts
        .filter(
          (contract) =>
            contract.notes?.trim() &&
            (!search || (contract.payerId && filteredPayerIds.has(contract.payerId))),
        )
        .map((contract) => ({
          contract,
          payerName: contract.payerId
            ? (payerMap.get(contract.payerId) ?? "Unknown Payer")
            : "Unknown Payer",
        }));
      return {
        group,
        states: Array.from(states).sort(),
        contractsByKey,
        filteredPayers,
        notes,
      };
    });
  }, [
    activeGroups,
    contractsQ.data,
    facilitiesQ.data,
    targetsQ.data,
    payersQ.data,
    payerSearch,
    selectedSpecialty,
  ]);

  const visibleContractCount = matrixGroups.reduce(
    (count, matrixGroup) =>
      count +
      matrixGroup.filteredPayers.reduce(
        (payerCount, payer) =>
          payerCount +
          matrixGroup.states.filter((state) =>
            matrixGroup.contractsByKey.has(`${payer.id}|${state}`),
          ).length,
        0,
      ),
    0,
  );

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

  function handleCellClick(
    matrixGroup: (typeof matrixGroups)[number],
    payer: Payer,
    state: string,
  ) {
    const contract = matrixGroup.contractsByKey.get(`${payer.id}|${state}`) ?? null;
    if (selectedSpecialty !== ALL_SPECIALTIES && !contract) return;
    setActiveCell({
      contract,
      groupId: matrixGroup.group.id,
      groupName: matrixGroup.group.name,
      payerId: payer.id,
      payerName: payer.name,
      state,
    });
    setDrawerOpen(true);
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        {initialContext?.groupId || initialContext?.payerId || initialContext?.state ? (
          <div className="rounded-md border border-emerald-700/30 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-950">
            Matrix context: {contextGroup?.name ?? "selected group"}
            {contextPayer ? ` · ${contextPayer.name}` : ""}
            {initialContext?.state ? ` · ${initialContext.state}` : ""}
            {initialContext?.groupId &&
            activeGroupIds.includes(initialContext.groupId) &&
            contextPayer &&
            initialContext?.state ? (
              <span className="ml-2 text-emerald-800">Matching cell highlighted below.</span>
            ) : null}
          </div>
        ) : null}
        {/* Top Control Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-card p-4 rounded-lg border border-border shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Provider Groups
              </span>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-[260px] h-9 justify-between font-medium">
                    {activeGroups.length === 1
                      ? activeGroups[0].name
                      : `${activeGroups.length} groups selected`}
                    <ChevronDown className="h-4 w-4 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-64 w-[260px] overflow-y-auto">
                  {groups.map((group) => (
                    <DropdownMenuCheckboxItem
                      key={group.id}
                      checked={activeGroupIds.includes(group.id)}
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={(checked) => {
                        const next =
                          checked === true
                            ? [...activeGroupIds, group.id]
                            : activeGroupIds.filter((id) => id !== group.id);
                        setSelectedGroupIds(next);
                      }}
                    >
                      <span className="truncate">{group.name}</span>
                      {group.tin ? <span className="ml-1 text-xs">({group.tin})</span> : null}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="space-y-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Specialty
              </span>
              <Select value={selectedSpecialty} onValueChange={setSelectedSpecialty}>
                <SelectTrigger aria-label="Specialty" className="w-[240px] h-9 font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_SPECIALTIES}>All Specialties</SelectItem>
                  {specialtyOptions.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.label}
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
              <span className="font-semibold text-foreground">{visibleContractCount}</span> active
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
        {activeGroups.length === 0 ? (
          <div className="rounded-md border border-border bg-card p-8 text-center">
            <EmptyState message="Select a provider group to view contracts" />
          </div>
        ) : (
          matrixGroups.map((matrixGroup) => {
            const { group, states, contractsByKey, filteredPayers, notes } = matrixGroup;
            return (
              <section key={group.id} aria-label={`${group.name} contracts`} className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {group.name}
                  {group.tin ? ` (${group.tin})` : ""}
                </h3>
                {states.length === 0 || filteredPayers.length === 0 ? (
                  <div className="rounded-lg border border-border bg-card p-12 text-center">
                    <EmptyState
                      message={
                        selectedSpecialty !== ALL_SPECIALTIES
                          ? payerSearch.trim()
                            ? "No contracts match this specialty and payer search"
                            : "No contracts match this specialty"
                          : states.length === 0
                            ? "No states or facilities assigned to this group"
                            : payerSearch.trim()
                              ? "No payers match this search"
                              : "No payers available"
                      }
                      description={
                        selectedSpecialty === ALL_SPECIALTIES && states.length === 0
                          ? "Attach payers or facilities in the onboarding wizard to expand contracting states."
                          : undefined
                      }
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
                              const isContextCell =
                                initialContext?.groupId === group.id &&
                                initialContext?.payerId === payer.id &&
                                initialContext?.state?.toUpperCase() === s;
                              const status = contract?.contractingStatusId
                                ? statusById.get(contract.contractingStatusId)
                                : null;
                              const statusLabel = status?.label ?? "";

                              return (
                                <td
                                  key={s}
                                  onClick={() => handleCellClick(matrixGroup, payer, s)}
                                  aria-current={isContextCell ? "location" : undefined}
                                  className={`px-2 py-2.5 text-center border-l border-border/60 transition-colors ${
                                    selectedSpecialty === ALL_SPECIALTIES || contract
                                      ? "cursor-pointer hover:bg-muted/50"
                                      : ""
                                  }${isContextCell ? " bg-emerald-100 ring-2 ring-inset ring-emerald-700" : ""}`}
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
                  {notes.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      No cross-payer dependencies or notes recorded for {group.name}. Click any cell
                      in the matrix to record prerequisites.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      {notes.map(({ contract, payerName }) => (
                        <div
                          key={contract.id}
                          className="bg-muted/30 border border-border/70 rounded p-2.5 flex items-start gap-2"
                        >
                          <span className="font-bold text-foreground shrink-0">
                            {payerName} ({contract.state}):
                          </span>
                          <span className="text-muted-foreground break-words">
                            {contract.notes}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            );
          })
        )}

        {/* Edit Drawer */}
        {activeCell ? (
          <ContractDetailDrawer
            open={drawerOpen}
            onClose={() => {
              setDrawerOpen(false);
              setActiveCell(null);
            }}
            contract={activeCell.contract}
            groupId={activeCell.groupId}
            payerId={activeCell.payerId}
            state={activeCell.state}
            groupName={activeCell.groupName}
            payerName={activeCell.payerName}
          />
        ) : null}
      </div>
    </TooltipProvider>
  );
}
