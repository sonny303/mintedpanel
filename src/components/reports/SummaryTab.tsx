// Summary tab of the Reports page. Filters + status/payer charts, avg days
// to approval by payer, and coordinator workload table with CSV export.
import { useMemo, useState } from "react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { Download } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
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
import { EmptyState } from "@/components/EmptyState";
import { downloadCsv } from "@/lib/csv";
import { useCases } from "@/hooks/useCases";
import { useTasks } from "@/hooks/useTasks";
import { useProviders } from "@/hooks/useProviders";
import { usePayers, useStatusConfigs } from "@/hooks/useAdmin";
import { useProviderGroups, useCoordinators } from "@/hooks/useLookups";
import { useTouchSummary } from "@/hooks/useReports";

const ALL = "__all__";

export function SummaryTab() {
  const casesQ = useCases();
  const tasksQ = useTasks();
  const providersQ = useProviders();
  const payersQ = usePayers();
  const statusesQ = useStatusConfigs("credentialing");
  const groupsQ = useProviderGroups();
  const coordinatorsQ = useCoordinators();
  const touchesQ = useTouchSummary();

  const [groupFilter, setGroupFilter] = useState<string>(ALL);
  const [stateFilter, setStateFilter] = useState<string>(ALL);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const payerById = useMemo(
    () => new Map((payersQ.data ?? []).map((p) => [p.id, p])),
    [payersQ.data],
  );
  const statusById = useMemo(
    () => new Map((statusesQ.data ?? []).map((s) => [s.id, s])),
    [statusesQ.data],
  );
  const coordinatorById = useMemo(
    () => new Map((coordinatorsQ.data ?? []).map((c) => [c.id, c])),
    [coordinatorsQ.data],
  );

  const states = useMemo(() => {
    const s = new Set<string>();
    (casesQ.data ?? []).forEach((c) => c.state && s.add(c.state));
    return Array.from(s).sort();
  }, [casesQ.data]);

  const filteredCases = useMemo(() => {
    return (casesQ.data ?? []).filter((c) => {
      if (groupFilter !== ALL && c.groupId !== groupFilter) return false;
      if (stateFilter !== ALL && c.state !== stateFilter) return false;
      if (from && (!c.submittedDate || c.submittedDate < from)) return false;
      if (to && (!c.submittedDate || c.submittedDate > to)) return false;
      return true;
    });
  }, [casesQ.data, groupFilter, stateFilter, from, to]);

  const statusBars = useMemo(() => {
    const counts = new Map<string, number>();
    filteredCases.forEach((c) => {
      const id = c.credentialingStatusId ?? "__none__";
      counts.set(id, (counts.get(id) ?? 0) + 1);
    });
    return (statusesQ.data ?? [])
      .map((s) => ({
        id: s.id,
        label: s.label,
        color: s.color || "#6B7280",
        count: counts.get(s.id) ?? 0,
      }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [filteredCases, statusesQ.data]);

  const payerBars = useMemo(() => {
    const counts = new Map<string, number>();
    filteredCases.forEach((c) => {
      counts.set(c.payerId, (counts.get(c.payerId) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([payerId, count]) => ({
        payerId,
        label: payerById.get(payerId)?.name ?? "—",
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [filteredCases, payerById]);

  const approvalRows = useMemo(() => {
    const map = new Map<string, { total: number; n: number }>();
    filteredCases.forEach((c) => {
      if (!c.submittedDate || !c.approvedDate) return;
      try {
        const days = differenceInCalendarDays(parseISO(c.approvedDate), parseISO(c.submittedDate));
        if (days < 0) return;
        const cur = map.get(c.payerId) ?? { total: 0, n: 0 };
        cur.total += days;
        cur.n += 1;
        map.set(c.payerId, cur);
      } catch {
        return;
      }
    });
    return Array.from(map.entries())
      .map(([payerId, { total, n }]) => {
        const payer = payerById.get(payerId);
        const avg = Math.round(total / n);
        const expected = payer?.avgDecisionDays ?? null;
        const variance = expected !== null ? avg - expected : null;
        return {
          payerId,
          payerName: payer?.name ?? "—",
          avg,
          count: n,
          expected,
          variance,
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [filteredCases, payerById]);

  const coordinatorRows = useMemo(() => {
    const filteredCaseIds = new Set(filteredCases.map((c) => c.id));
    const openByCoord = new Map<string, number>();
    const terminalLabels = new Set(["denied", "expired", "terminated", "closed"]);
    filteredCases.forEach((c) => {
      if (!c.assignedTo) return;
      const st = c.credentialingStatusId ? statusById.get(c.credentialingStatusId) : null;
      const label = (st?.label ?? "").toLowerCase();
      const closed = Array.from(terminalLabels).some((t) => label.includes(t));
      if (closed) return;
      openByCoord.set(c.assignedTo, (openByCoord.get(c.assignedTo) ?? 0) + 1);
    });

    const todayStr = new Date().toISOString().slice(0, 10);
    const overdueByCoord = new Map<string, number>();
    const caseAssignee = new Map<string, string | null>();
    filteredCases.forEach((c) => caseAssignee.set(c.id, c.assignedTo));
    (tasksQ.data ?? []).forEach((t) => {
      if (!t.caseId || !filteredCaseIds.has(t.caseId)) return;
      if (t.status === "completed") return;
      if (!t.dueDate || t.dueDate >= todayStr) return;
      const assignee = caseAssignee.get(t.caseId);
      if (!assignee) return;
      overdueByCoord.set(assignee, (overdueByCoord.get(assignee) ?? 0) + 1);
    });

    const since = new Date();
    since.setDate(since.getDate() - 30);
    const sinceStr = since.toISOString().slice(0, 10);
    const touchesByCoord = new Map<string, number>();
    (touchesQ.data ?? []).forEach((t) => {
      if (!t.coordinatorId) return;
      if (!t.touchDate || t.touchDate < sinceStr) return;
      touchesByCoord.set(t.coordinatorId, (touchesByCoord.get(t.coordinatorId) ?? 0) + 1);
    });

    const ids = new Set<string>([
      ...openByCoord.keys(),
      ...overdueByCoord.keys(),
      ...touchesByCoord.keys(),
    ]);
    return Array.from(ids)
      .map((id) => {
        const prof = coordinatorById.get(id);
        const name = prof?.fullName ?? prof?.email ?? "—";
        return {
          id,
          name,
          openCases: openByCoord.get(id) ?? 0,
          overdueTasks: overdueByCoord.get(id) ?? 0,
          touches30: touchesByCoord.get(id) ?? 0,
        };
      })
      .sort((a, b) => b.openCases - a.openCases);
  }, [filteredCases, tasksQ.data, touchesQ.data, statusById, coordinatorById]);

  const loading =
    casesQ.isLoading ||
    tasksQ.isLoading ||
    providersQ.isLoading ||
    payersQ.isLoading ||
    statusesQ.isLoading ||
    groupsQ.isLoading ||
    coordinatorsQ.isLoading ||
    touchesQ.isLoading;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const isError =
    casesQ.isError ||
    tasksQ.isError ||
    providersQ.isError ||
    payersQ.isError ||
    statusesQ.isError ||
    groupsQ.isError ||
    coordinatorsQ.isError ||
    touchesQ.isError;
  const retry = () => {
    if (casesQ.isError) casesQ.refetch();
    if (tasksQ.isError) tasksQ.refetch();
    if (providersQ.isError) providersQ.refetch();
    if (payersQ.isError) payersQ.refetch();
    if (statusesQ.isError) statusesQ.refetch();
    if (groupsQ.isError) groupsQ.refetch();
    if (coordinatorsQ.isError) coordinatorsQ.refetch();
    if (touchesQ.isError) touchesQ.refetch();
  };

  if (isError) {
    return (
      <div className="border border-border rounded-md px-3 py-12 text-center">
        <div className="text-[13px] text-foreground mb-3">Failed to load summary data.</div>
        <Button variant="outline" size="sm" onClick={retry}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Group
          </Label>
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
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            State
          </Label>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="h-9 w-[140px]">
              <SelectValue placeholder="State" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All states</SelectItem>
              {states.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Submitted from
          </Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 w-[160px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Submitted to
          </Label>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 w-[160px]"
          />
        </div>
        {(groupFilter !== ALL || stateFilter !== ALL || from || to) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setGroupFilter(ALL);
              setStateFilter(ALL);
              setFrom("");
              setTo("");
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-[#E8E5E0] rounded-md bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-medium">Cases by credentialing status</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                downloadCsv("cases-by-status.csv", [
                  ["Status", "Cases"],
                  ...statusBars.map((r) => [r.label, r.count]),
                ])
              }
            >
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          </div>
          {statusBars.length === 0 ? (
            <div className="py-8">
              <EmptyState message="No data" />
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusBars} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
                  <CartesianGrid stroke="#F3F4F6" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "#6B7280" }}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6B7280" }} />
                  <RTooltip cursor={{ fill: "#FAFAF9" }} />
                  <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                    {statusBars.map((r) => (
                      <Cell key={r.id} fill={r.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="border border-[#E8E5E0] rounded-md bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-medium">Cases by payer</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                downloadCsv("cases-by-payer.csv", [
                  ["Payer", "Cases"],
                  ...payerBars.map((r) => [r.label, r.count]),
                ])
              }
            >
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          </div>
          {payerBars.length === 0 ? (
            <div className="py-8">
              <EmptyState message="No data" />
            </div>
          ) : (
            <div style={{ height: Math.max(payerBars.length * 28 + 40, 200) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={payerBars}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                >
                  <CartesianGrid stroke="#F3F4F6" horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "#6B7280" }}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={140}
                    tick={{ fontSize: 11, fill: "#374151" }}
                  />
                  <RTooltip cursor={{ fill: "#FAFAF9" }} />
                  <Bar dataKey="count" fill="#1B4D3E" radius={[0, 2, 2, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="border border-[#E8E5E0] rounded-md bg-white">
        <div className="flex items-center justify-between p-4">
          <h3 className="text-[13px] font-medium">Avg days to approval by payer</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              downloadCsv("avg-approval-by-payer.csv", [
                ["Payer", "Avg days", "Cases", "Expected (avg_decision_days)", "Variance"],
                ...approvalRows.map((r) => [
                  r.payerName,
                  r.avg,
                  r.count,
                  r.expected ?? "",
                  r.variance ?? "",
                ]),
              ])
            }
          >
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-t border-[#E8E5E0] text-xs uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-4 h-9 font-medium">Payer</th>
              <th className="text-right px-4 h-9 font-medium">Avg days</th>
              <th className="text-right px-4 h-9 font-medium">Cases</th>
              <th className="text-right px-4 h-9 font-medium">Expected</th>
              <th className="text-right px-4 h-9 font-medium">Variance</th>
            </tr>
          </thead>
          <tbody>
            {approvalRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-12">
                  <EmptyState message="No approved cases in range" />
                </td>
              </tr>
            ) : (
              approvalRows.map((r) => {
                const varClass =
                  r.variance === null
                    ? "text-muted-foreground"
                    : r.variance <= 0
                      ? "text-[#059669]"
                      : "text-[#DC2626]";
                const varText =
                  r.variance === null
                    ? "—"
                    : r.variance === 0
                      ? "on target"
                      : r.variance < 0
                        ? `${r.variance} d faster`
                        : `+${r.variance} d slower`;
                return (
                  <tr key={r.payerId} className="border-t border-[#E8E5E0] h-10 hover:bg-[#FAFAF9]">
                    <td className="px-4">{r.payerName}</td>
                    <td className="px-4 text-right tabular-nums">{r.avg}</td>
                    <td className="px-4 text-right tabular-nums">{r.count}</td>
                    <td className="px-4 text-right tabular-nums">{r.expected ?? "—"}</td>
                    <td className={`px-4 text-right tabular-nums ${varClass}`}>{varText}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="border border-[#E8E5E0] rounded-md bg-white">
        <div className="flex items-center justify-between p-4">
          <h3 className="text-[13px] font-medium">Coordinator workload</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              downloadCsv("coordinator-workload.csv", [
                ["Coordinator", "Open cases", "Overdue tasks", "Touches (30d)"],
                ...coordinatorRows.map((r) => [r.name, r.openCases, r.overdueTasks, r.touches30]),
              ])
            }
          >
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-t border-[#E8E5E0] text-xs uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-4 h-9 font-medium">Coordinator</th>
              <th className="text-right px-4 h-9 font-medium">Open cases</th>
              <th className="text-right px-4 h-9 font-medium">Overdue tasks</th>
              <th className="text-right px-4 h-9 font-medium">Touches (30d)</th>
            </tr>
          </thead>
          <tbody>
            {coordinatorRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-12">
                  <EmptyState message="No coordinator activity in range" />
                </td>
              </tr>
            ) : (
              coordinatorRows.map((r) => (
                <tr key={r.id} className="border-t border-[#E8E5E0] h-10 hover:bg-[#FAFAF9]">
                  <td className="px-4">{r.name}</td>
                  <td className="px-4 text-right tabular-nums">{r.openCases}</td>
                  <td className="px-4 text-right tabular-nums">{r.overdueTasks}</td>
                  <td className="px-4 text-right tabular-nums">{r.touches30}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
