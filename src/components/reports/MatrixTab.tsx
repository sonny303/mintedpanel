// Enrollment Matrix tab of the Reports page. Providers × payers grid with a
// per-cell credentialing status pill (or state count when multiple).
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill, hexToStatusColor } from "@/components/StatusPill";
import { useCases } from "@/hooks/useCases";
import { useProviders } from "@/hooks/useProviders";
import { usePayers, useStatusConfigs } from "@/hooks/useAdmin";
import { useProviderGroups } from "@/hooks/useLookups";
import type { CredentialCase } from "@/types";

const ALL = "__all__";

export function MatrixTab() {
  const casesQ = useCases();
  const providersQ = useProviders();
  const payersQ = usePayers();
  const statusesQ = useStatusConfigs("credentialing");
  const groupsQ = useProviderGroups();

  const [groupFilter, setGroupFilter] = useState<string>(ALL);
  const [stateFilter, setStateFilter] = useState<string>(ALL);

  const statusById = useMemo(
    () => new Map((statusesQ.data ?? []).map((s) => [s.id, s])),
    [statusesQ.data],
  );

  const stateOptions = useMemo(() => {
    const set = new Set<string>();
    (casesQ.data ?? []).forEach((c) => set.add(c.state));
    return Array.from(set).sort();
  }, [casesQ.data]);

  const filteredProviders = useMemo(() => {
    return (providersQ.data ?? [])
      .filter((p) => groupFilter === ALL || p.groupId === groupFilter)
      .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
  }, [providersQ.data, groupFilter]);

  const payers = useMemo(
    () => (payersQ.data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [payersQ.data],
  );

  const cellMap = useMemo(() => {
    const m = new Map<string, Map<string, CredentialCase[]>>();
    (casesQ.data ?? []).forEach((c) => {
      if (stateFilter !== ALL && c.state !== stateFilter) return;
      let inner = m.get(c.providerId);
      if (!inner) {
        inner = new Map<string, CredentialCase[]>();
        m.set(c.providerId, inner);
      }
      const arr = inner.get(c.payerId) ?? [];
      arr.push(c);
      inner.set(c.payerId, arr);
    });
    return m;
  }, [casesQ.data, stateFilter]);

  const loading =
    casesQ.isLoading || providersQ.isLoading || payersQ.isLoading || statusesQ.isLoading;

  if (loading) {
    return <Skeleton className="h-64 w-full" />;
  }

  const isError =
    casesQ.isError || providersQ.isError || payersQ.isError || statusesQ.isError || groupsQ.isError;
  const retry = () => {
    if (casesQ.isError) casesQ.refetch();
    if (providersQ.isError) providersQ.refetch();
    if (payersQ.isError) payersQ.refetch();
    if (statusesQ.isError) statusesQ.refetch();
    if (groupsQ.isError) groupsQ.refetch();
  };

  if (isError) {
    return (
      <div className="border border-border rounded-md px-3 py-12 text-center">
        <div className="text-[13px] text-foreground mb-3">Failed to load enrollment matrix.</div>
        <Button variant="outline" size="sm" onClick={retry}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger className="h-9 w-[200px]">
              <SelectValue placeholder="Group" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All groups</SelectItem>
              {(groupsQ.data ?? []).map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue placeholder="State" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All states</SelectItem>
              {stateOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="border border-border rounded-md overflow-auto max-h-[calc(100vh-260px)]">
          <table className="text-[13px] border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 bg-[#FAFAF9] border-b border-r border-border text-left text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium min-w-[220px]">
                  Provider
                </th>
                {payers.map((p) => (
                  <th
                    key={p.id}
                    className="sticky top-0 z-10 bg-[#FAFAF9] border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground px-3 h-10 font-medium min-w-[140px] whitespace-nowrap"
                  >
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredProviders.length === 0 ? (
                <tr>
                  <td colSpan={payers.length + 1} className="px-3 py-12 text-center">
                    <EmptyState message="No providers match these filters" />
                  </td>
                </tr>
              ) : (
                filteredProviders.map((prov) => {
                  const row = cellMap.get(prov.id);
                  return (
                    <tr key={prov.id} className="border-b border-border last:border-b-0">
                      <td className="sticky left-0 z-10 bg-background border-r border-border px-3 h-10 align-middle whitespace-nowrap">
                        <Link
                          to="/providers/$id"
                          params={{ id: prov.id }}
                          className="hover:underline"
                        >
                          {prov.lastName}, {prov.firstName}
                          {prov.credentials ? `, ${prov.credentials}` : ""}
                        </Link>
                      </td>
                      {payers.map((p) => {
                        const list = row?.get(p.id) ?? [];
                        if (list.length === 0) {
                          return (
                            <td
                              key={p.id}
                              className="px-3 h-10 align-middle text-[#9CA3AF] text-center"
                            >
                              —
                            </td>
                          );
                        }
                        if (list.length === 1) {
                          const cs = list[0];
                          const st = cs.credentialingStatusId
                            ? statusById.get(cs.credentialingStatusId)
                            : null;
                          return (
                            <td key={p.id} className="px-3 h-10 align-middle">
                              <Link to="/cases/$id" params={{ id: cs.id }} className="inline-flex">
                                <StatusPill
                                  status={hexToStatusColor(st?.color)}
                                  label={`${cs.state} · ${st?.label ?? "—"}`}
                                />
                              </Link>
                            </td>
                          );
                        }
                        return (
                          <td key={p.id} className="px-3 h-10 align-middle">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Link
                                  to="/providers/$id"
                                  params={{ id: prov.id }}
                                  className="inline-flex items-center gap-1 text-[12px] font-medium text-[#1B4D3E] hover:underline"
                                >
                                  {list.length} states
                                </Link>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="space-y-1">
                                  {list.map((cs) => {
                                    const st = cs.credentialingStatusId
                                      ? statusById.get(cs.credentialingStatusId)
                                      : null;
                                    return (
                                      <div key={cs.id} className="text-[12px]">
                                        {cs.state} · {st?.label ?? "—"}
                                      </div>
                                    );
                                  })}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </TooltipProvider>
  );
}
