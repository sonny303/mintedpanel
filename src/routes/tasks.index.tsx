// Task queue at /tasks. Summary strip + filters + table of open tasks across
// the active org. Click a row to open the task detail runner.
import { useMemo, useState, type ReactNode } from 'react';
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

  const coordinatorById = useMemo(() => {
    const m = new Map<string, Profile>();
    (coordinatorsQ.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [coordinatorsQ.data]);

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

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      const ad = a.task.dueDate ?? '9999-12-31';
      const bd = b.task.dueDate ?? '9999-12-31';
      return ad.localeCompare(bd);
    });
  }, [filtered]);

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

  return (
    <div>
      <PageHeader
        title="Tasks"
        actions={
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {tasksQ.isSuccess ? `${sorted.length} tasks` : null}
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
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={payerId} onValueChange={setPayerId}>
          <SelectTrigger className="h-9 w-[160px]">
            <SelectValue placeholder="All payers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All payers</SelectItem>
            {(payersQ.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={coordinatorId} onValueChange={setCoordinatorId}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="All coordinators" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All coordinators</SelectItem>
            {(coordinatorsQ.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.fullName ?? p.email ?? p.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted-foreground">Due</span>
          <Input
            type="date"
            value={dueFrom}
            onChange={(e) => setDueFrom(e.target.value)}
            className="h-9 w-[150px]"
          />
          <span className="text-[12px] text-muted-foreground">to</span>
          <Input
            type="date"
            value={dueTo}
            onChange={(e) => setDueTo(e.target.value)}
            className="h-9 w-[150px]"
          />
        </div>

        {hasActiveFilter ? (
          <Button variant="ghost" size="sm" className="h-9" onClick={clearFilters}>
            Clear
          </Button>
        ) : null}
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <Th>Task</Th>
              <Th>Provider</Th>
              <Th>Payer · State</Th>
              <Th>Due date</Th>
              <Th>Status</Th>
              <Th>Case</Th>
            </tr>
          </thead>
          <tbody>
            {tasksQ.isLoading ? (
              <TableSkeletonRows rows={8} cols={6} />
            ) : tasksQ.isError ? (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center">
                  <div className="text-[13px] text-foreground mb-3">
                    Failed to load tasks.
                  </div>
                  <Button variant="outline" size="sm" onClick={() => tasksQ.refetch()}>
                    Retry
                  </Button>
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center">
                  <EmptyState
                    message={hasActiveFilter ? 'No tasks match these filters' : 'No tasks yet'}
                    action={
                      hasActiveFilter ? (
                        <Button variant="outline" size="sm" onClick={clearFilters}>
                          Clear filters
                        </Button>
                      ) : undefined
                    }
                  />
                </td>
              </tr>
            ) : (
              sorted.map((e) => (
                <tr
                  key={e.task.id}
                  className="border-b border-border h-10 hover:bg-muted/40 cursor-pointer"
                  onClick={() => navigate({ to: '/tasks/$id', params: { id: e.task.id } })}
                >
                  <td className="px-3 truncate max-w-[280px] font-medium text-foreground">
                    {e.task.title}
                  </td>
                  <td className="px-3 truncate max-w-[200px]">
                    {e.provider
                      ? `${e.provider.firstName} ${e.provider.lastName}`
                      : '—'}
                  </td>
                  <td className="px-3 truncate max-w-[200px] text-muted-foreground">
                    {e.payer
                      ? `${e.payer.name}${e.caseRow ? ` · ${e.caseRow.state}` : ''}`
                      : '—'}
                  </td>
                  <td
                    className={`px-3 tabular-nums ${
                      e.isOverdue ? 'text-[#DC2626] font-medium' : ''
                    }`}
                  >
                    {e.task.dueDate ? fmtDate(e.task.dueDate) : '—'}
                    {e.isOverdue && e.task.dueDate
                      ? ` (${Math.abs(
                          differenceInCalendarDays(parseISO(e.task.dueDate), today),
                        )}d)`
                      : ''}
                  </td>
                  <td className="px-3">
                    <StatusPill
                      status={STATUS_COLOR[e.task.status]}
                      label={STATUS_LABEL[e.task.status]}
                    />
                  </td>
                  <td className="px-3">
                    {e.caseRow ? (
                      <button
                        type="button"
                        className="text-[#1B4D3E] hover:underline"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          navigate({
                            to: '/cases/$id',
                            params: { id: e.caseRow!.id },
                          });
                        }}
                      >
                        Open case
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground px-3 h-9">
      {children}
    </th>
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
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
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
