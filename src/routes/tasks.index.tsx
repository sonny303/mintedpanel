// Task queue at /tasks. Summary strip + filters + table of open tasks across
// the active org with sortable headers, column picker, persisted prefs, and
// infinite scroll. Click a row to open the task detail runner.
import { useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  differenceInCalendarDays,
  endOfWeek,
  parseISO,
  startOfWeek,
} from 'date-fns';
import { fmtDate } from '@/lib/format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { TableSkeletonRows } from '@/components/TableSkeletonRows';
import { EmptyState } from '@/components/EmptyState';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { StatusPill, type StatusColor } from '@/components/StatusPill';
import {
  ColumnPicker,
  InfiniteScrollSentinel,
  SortableTh,
  StaticTh,
  compareForSort,
  useInfiniteRows,
} from '@/components/shared/TableToolkit';
import { useTablePrefs } from '@/hooks/useTablePrefs';
import { useTasks } from '@/hooks/useTasks';
import { useCases } from '@/hooks/useCases';
import { useProviders } from '@/hooks/useProviders';
import { usePayers } from '@/hooks/useAdmin';
import { useCoordinators } from '@/hooks/useLookups';
import type {
  CredentialCase,
  Payer,
  Profile,
  Provider,
  Task,
  TaskStatus,
} from '@/types';

export const Route = createFileRoute('/tasks/')({
  component: TaskQueuePage,
});

const ALL = '__all__';

const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
  blocked: 'Blocked',
};

const STATUS_COLOR: Record<TaskStatus, StatusColor> = {
  not_started: 'gray',
  in_progress: 'blue',
  completed: 'green',
  blocked: 'red',
};

const STATUS_SORT_RANK: Record<TaskStatus, number> = {
  blocked: 0,
  in_progress: 1,
  not_started: 2,
  completed: 3,
};

type ColumnKey = 'task' | 'provider' | 'payerState' | 'dueDate' | 'status' | 'case';
const COLUMN_DEFS: { key: ColumnKey; label: string }[] = [
  { key: 'task', label: 'Task' },
  { key: 'provider', label: 'Provider' },
  { key: 'payerState', label: 'Payer · State' },
  { key: 'dueDate', label: 'Due date' },
  { key: 'status', label: 'Status' },
  { key: 'case', label: 'Case' },
];
const ALL_KEYS = COLUMN_DEFS.map((c) => c.key);
const DEFAULT_VISIBILITY: Record<ColumnKey, boolean> = {
  task: true,
  provider: true,
  payerState: true,
  dueDate: true,
  status: true,
  case: true,
};

interface EnrichedTask {
  task: Task;
  provider: Provider | null;
  payer: Payer | null;
  caseRow: CredentialCase | null;
  coordinatorId: string | null;
  isOverdue: boolean;
}

function TaskQueuePage() {
  const navigate = useNavigate();

  const [status, setStatus] = useState<string>(ALL);
  const [payerId, setPayerId] = useState<string>(ALL);
  const [coordinatorId, setCoordinatorId] = useState<string>(ALL);
  const [dueFrom, setDueFrom] = useState<string>('');
  const [dueTo, setDueTo] = useState<string>('');

  const { state: prefs, setVisible, cycleSort } = useTablePrefs<ColumnKey>({
    pageKey: 'tasks',
    defaults: { visibleCols: DEFAULT_VISIBILITY, sort: { key: 'task', dir: 'asc' } },
    allKeys: ALL_KEYS,
  });
  const visibleCols = prefs.visibleCols;
  const effectiveSort = prefs.sort ?? { key: 'task', dir: 'asc' as const };

  const tasksQ = useTasks({});
  const casesQ = useCases({});
  const providersQ = useProviders({});
  const payersQ = usePayers();
  const coordinatorsQ = useCoordinators();

  const caseById = useMemo(() => {
    const m = new Map<string, CredentialCase>();
    (casesQ.data ?? []).forEach((c) => m.set(c.id, c));
    return m;
  }, [casesQ.data]);

  const providerById = useMemo(() => {
    const m = new Map<string, Provider>();
    (providersQ.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [providersQ.data]);

  const payerById = useMemo(() => {
    const m = new Map<string, Payer>();
    (payersQ.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [payersQ.data]);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const enriched: EnrichedTask[] = useMemo(() => {
    return (tasksQ.data ?? []).map((task) => {
      const caseRow = task.caseId ? caseById.get(task.caseId) ?? null : null;
      const provider =
        (task.providerId ? providerById.get(task.providerId) : null) ??
        (caseRow ? providerById.get(caseRow.providerId) ?? null : null);
      const payer = caseRow ? payerById.get(caseRow.payerId) ?? null : null;
      const coordinatorId = caseRow?.assignedTo ?? null;
      const isOverdue =
        task.status !== 'completed' &&
        Boolean(task.dueDate) &&
        parseISO(task.dueDate as string) < today;
      return { task, provider, caseRow, payer, coordinatorId, isOverdue };
    });
  }, [tasksQ.data, caseById, providerById, payerById, today]);

  const summary = useMemo(() => {
    const weekStart = startOfWeek(today, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
    let overdue = 0;
    let dueWeek = 0;
    let open = 0;
    for (const e of enriched) {
      if (e.task.status === 'completed') continue;
      open += 1;
      if (e.isOverdue) overdue += 1;
      if (e.task.dueDate) {
        const d = parseISO(e.task.dueDate);
        if (d >= weekStart && d <= weekEnd) dueWeek += 1;
      }
    }
    return { overdue, dueWeek, open };
  }, [enriched, today]);

  const filtered = useMemo(() => {
    return enriched.filter((e) => {
      if (status !== ALL && e.task.status !== status) return false;
      if (payerId !== ALL && e.caseRow?.payerId !== payerId) return false;
      if (coordinatorId !== ALL && e.coordinatorId !== coordinatorId) return false;
      if (dueFrom && (!e.task.dueDate || e.task.dueDate < dueFrom)) return false;
      if (dueTo && (!e.task.dueDate || e.task.dueDate > dueTo)) return false;
      return true;
    });
  }, [enriched, status, payerId, coordinatorId, dueFrom, dueTo]);

  function sortValueFor(e: EnrichedTask, key: string): string | number | null {
    switch (key) {
      case 'task':
        return e.task.title || null;
      case 'provider':
        return e.provider ? (e.provider.lastName || e.provider.firstName || '').trim() || null : null;
      case 'payerState':
        return e.payer ? `${e.payer.name}${e.caseRow ? ` ${e.caseRow.state}` : ''}` : null;
      case 'dueDate':
        return e.task.dueDate ?? null;
      case 'status':
        return STATUS_SORT_RANK[e.task.status];
      default:
        return null;
    }
  }

  const sorted = useMemo(() => {
    const rows = [...filtered];
    const { key, dir } = effectiveSort;
    rows.sort((a, b) => compareForSort(sortValueFor(a, key), sortValueFor(b, key), dir));
    return rows;
  }, [filtered, effectiveSort.key, effectiveSort.dir]);

  const resetKey = `${effectiveSort.key}|${effectiveSort.dir}|${status}|${payerId}|${coordinatorId}|${dueFrom}|${dueTo}`;
  const { visible, hasMore, loadingMore, sentinelRef, total } = useInfiniteRows({
    items: sorted,
    resetKey,
  });

  const hasActiveFilter =
    status !== ALL ||
    payerId !== ALL ||
    coordinatorId !== ALL ||
    Boolean(dueFrom) ||
    Boolean(dueTo);

  function clearFilters() {
    setStatus(ALL);
    setPayerId(ALL);
    setCoordinatorId(ALL);
    setDueFrom('');
    setDueTo('');
  }

  const visibleCount = COLUMN_DEFS.filter((c) => visibleCols[c.key]).length;

  return (
    <div>
      <PageHeader
        title="Tasks"
        actions={
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {tasksQ.isSuccess ? `${total} tasks` : null}
          </span>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <SummaryCard label="Overdue" value={summary.overdue} accent="red" />
        <SummaryCard label="Due this week" value={summary.dueWeek} />
        <SummaryCard label="Total open" value={summary.open} />
      </div>

      <div className="flex items-center gap-3 mb-4 mt-4 flex-wrap">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={payerId} onValueChange={setPayerId}>
          <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="All payers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All payers</SelectItem>
            {(payersQ.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={coordinatorId} onValueChange={setCoordinatorId}>
          <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="All coordinators" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All coordinators</SelectItem>
            {(coordinatorsQ.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.fullName ?? p.email ?? p.id}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted-foreground">Due</span>
          <Input type="date" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} className="h-9 w-[150px]" />
          <span className="text-[12px] text-muted-foreground">to</span>
          <Input type="date" value={dueTo} onChange={(e) => setDueTo(e.target.value)} className="h-9 w-[150px]" />
        </div>

        {hasActiveFilter ? (
          <Button variant="ghost" size="sm" className="h-9" onClick={clearFilters}>Clear</Button>
        ) : null}

        <div className="ml-auto">
          <ColumnPicker
            columns={COLUMN_DEFS}
            visible={visibleCols}
            onChange={setVisible}
            lockedKeys={['task']}
          />
        </div>
      </div>

      <div className="border border-border rounded-md">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-10 bg-muted/30 backdrop-blur">
            <tr className="border-b border-border">
              {visibleCols.task && <SortableTh label="Task" sortKey="task" sort={effectiveSort} onSort={cycleSort} />}
              {visibleCols.provider && <SortableTh label="Provider" sortKey="provider" sort={effectiveSort} onSort={cycleSort} />}
              {visibleCols.payerState && <SortableTh label="Payer · State" sortKey="payerState" sort={effectiveSort} onSort={cycleSort} />}
              {visibleCols.dueDate && <SortableTh label="Due date" sortKey="dueDate" sort={effectiveSort} onSort={cycleSort} />}
              {visibleCols.status && <SortableTh label="Status" sortKey="status" sort={effectiveSort} onSort={cycleSort} />}
              {visibleCols.case && <StaticTh>Case</StaticTh>}
            </tr>
          </thead>
          <tbody>
            {tasksQ.isLoading ? (
              <TableSkeletonRows rows={8} cols={visibleCount} />
            ) : tasksQ.isError ? (
              <tr>
                <td colSpan={visibleCount} className="px-3 py-12 text-center">
                  <div className="text-[13px] text-foreground mb-3">Failed to load tasks.</div>
                  <Button variant="outline" size="sm" onClick={() => tasksQ.refetch()}>Retry</Button>
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={visibleCount} className="px-3 py-12 text-center">
                  <EmptyState
                    message={hasActiveFilter ? 'No tasks match these filters' : 'No tasks yet'}
                    action={hasActiveFilter ? (
                      <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>
                    ) : undefined}
                  />
                </td>
              </tr>
            ) : (
              visible.map((e) => (
                <tr
                  key={e.task.id}
                  className="border-b border-border h-10 hover:bg-muted/40 cursor-pointer"
                  onClick={() => navigate({ to: '/tasks/$id', params: { id: e.task.id } })}
                >
                  {visibleCols.task && (
                    <td className="px-3 truncate max-w-[280px] font-medium text-foreground">{e.task.title}</td>
                  )}
                  {visibleCols.provider && (
                    <td className="px-3 truncate max-w-[200px]">
                      {e.provider ? `${e.provider.firstName} ${e.provider.lastName}` : '—'}
                    </td>
                  )}
                  {visibleCols.payerState && (
                    <td className="px-3 truncate max-w-[200px] text-muted-foreground">
                      {e.payer ? `${e.payer.name}${e.caseRow ? ` · ${e.caseRow.state}` : ''}` : '—'}
                    </td>
                  )}
                  {visibleCols.dueDate && (
                    <td className={`px-3 tabular-nums ${e.isOverdue ? 'text-[#DC2626] font-medium' : ''}`}>
                      {e.task.status === 'completed' && e.task.completedDate ? (
                        <span className="text-muted-foreground">Completed {fmtDate(e.task.completedDate)}</span>
                      ) : (
                        <>
                          {e.task.dueDate ? fmtDate(e.task.dueDate) : '—'}
                          {e.isOverdue && e.task.dueDate
                            ? ` (${Math.abs(differenceInCalendarDays(parseISO(e.task.dueDate), today))}d)`
                            : ''}
                        </>
                      )}
                    </td>
                  )}
                  {visibleCols.status && (
                    <td className="px-3">
                      <StatusPill status={STATUS_COLOR[e.task.status]} label={STATUS_LABEL[e.task.status]} />
                    </td>
                  )}
                  {visibleCols.case && (
                    <td className="px-3">
                      {e.caseRow ? (
                        <button
                          type="button"
                          className="text-[#1B4D3E] hover:underline"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            navigate({ to: '/cases/$id', params: { id: e.caseRow!.id } });
                          }}
                        >
                          Open case
                        </button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
        <InfiniteScrollSentinel sentinelRef={sentinelRef} hasMore={hasMore} loadingMore={loadingMore} />
      </div>
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: number;
  accent?: 'red';
}

function SummaryCard({ label, value, accent }: SummaryCardProps) {
  return (
    <div className="border border-border rounded-md p-4 bg-background">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={`mt-1 text-[20px] font-semibold tabular-nums ${
          accent === 'red' && value > 0 ? 'text-[#DC2626]' : 'text-foreground'
        }`}
      >
        {value}
      </div>
    </div>
  );
}
