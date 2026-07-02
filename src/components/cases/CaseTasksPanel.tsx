// Tasks card on the case detail page. Sequential lock: a task is locked
// until previous tasks are completed. Row click opens the TaskDrawer.
import { useRef, useState } from 'react';
import { differenceInDays, format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { EmptyState } from '@/components/EmptyState';
import { StatusPill } from '@/components/StatusPill';
import { CheckCircle2, Circle, Lock } from 'lucide-react';
import { fmtDate } from '@/lib/format';
import { useUpdateTaskStatus } from '@/hooks/useTasks';
import { useCanWrite } from '@/lib/permissions';
import { TaskDrawer } from '@/components/cases/TaskDrawer';
import type { Task, TaskStatus } from '@/types';

function taskStatusIcon(status: Task['status'], locked: boolean) {
  if (locked) return <Lock className="w-4 h-4 text-muted-foreground" />;
  if (status === 'completed') return <CheckCircle2 className="w-4 h-4 text-[#059669]" />;
  if (status === 'in_progress') return <Circle className="w-4 h-4 text-[#D97706] fill-[#FEF3C7]" />;
  if (status === 'blocked') return <Lock className="w-4 h-4 text-[#DC2626]" />;
  return <Circle className="w-4 h-4 text-muted-foreground" />;
}

export function CaseTasksPanel({ tasks }: { tasks: Task[] }) {
  const canEdit = useCanWrite();
  const updateStatusM = useUpdateTaskStatus();
  const [drawerTask, setDrawerTask] = useState<{ task: Task; locked: boolean } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const undoRef = useRef<Set<string>>(new Set());
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;

  const openDrawer = (task: Task, locked: boolean) => {
    setDrawerTask({ task, locked });
    setDrawerOpen(true);
  };

  const completeWithUndo = (task: Task) => {
    if (!canEdit) return;
    if (task.status === 'completed') return;
    const previous: TaskStatus = task.status;
    updateStatusM.mutate(
      { id: task.id, status: 'completed' },
      {
        onSuccess: () => {
          toast.success(`Completed "${task.title}"`, {
            action: {
              label: 'Undo',
              onClick: () => {
                if (undoRef.current.has(task.id)) return;
                undoRef.current.add(task.id);
                updateStatusM.mutate(
                  { id: task.id, status: previous },
                  {
                    onSettled: () => undoRef.current.delete(task.id),
                    onError: (err: unknown) =>
                      toast.error(
                        err instanceof Error ? err.message : 'Could not undo',
                      ),
                  },
                );
              },
            },
          });
        },
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : 'Could not complete task'),
      },
    );
  };

  return (
    <>
      <Card className="shadow-none border-border">
        <CardHeader className="p-4 pb-2 border-b border-border flex flex-row items-center justify-between">
          <CardTitle className="text-[14px] font-semibold">Tasks</CardTitle>
          <span className="text-[12px] text-muted-foreground tabular-nums">
            {completedTasks} of {tasks.length} completed
          </span>
        </CardHeader>
        <CardContent className="p-0">
          {tasks.length === 0 ? (
            <div className="p-6">
              <EmptyState message="No tasks yet" />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {tasks.map((t, idx) => {
                const previousIncomplete = tasks
                  .slice(0, idx)
                  .some((p) => p.status !== 'completed');
                const locked = previousIncomplete && t.status !== 'completed';
                const overdue =
                  t.status !== 'completed' &&
                  t.dueDate &&
                  differenceInDays(new Date(), parseISO(t.dueDate)) > 0;

                const canComplete =
                  canEdit && !locked && t.status !== 'completed';

                const row = (
                  <div
                    className={`p-3 flex items-center gap-3 text-[13px] ${
                      locked ? 'opacity-60 cursor-not-allowed' : 'hover:bg-muted/30 cursor-pointer'
                    }`}
                    onClick={() => {
                      if (locked) {
                        openDrawer(t, true);
                        return;
                      }
                      openDrawer(t, false);
                    }}
                  >
                    <button
                      type="button"
                      className={`flex-shrink-0 -m-1 p-1 rounded ${
                        canComplete ? 'hover:bg-[#1B4D3E]/10 cursor-pointer' : 'cursor-default'
                      }`}
                      aria-label={
                        canComplete ? `Complete ${t.title}` : `Status ${t.status}`
                      }
                      disabled={!canComplete || updateStatusM.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!canComplete) return;
                        completeWithUndo(t);
                      }}
                    >
                      {taskStatusIcon(t.status, locked)}
                    </button>
                    <div
                      className={`flex-1 min-w-0 ${
                        t.status === 'completed'
                          ? 'text-muted-foreground'
                          : 'text-foreground font-medium'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={t.status === 'completed' ? 'line-through' : ''}>
                          {t.title}
                        </span>
                        {t.status === 'blocked' ? (
                          <StatusPill status="red" label="Blocked" />
                        ) : null}
                      </div>
                      {t.status === 'completed' && t.completedDate ? (
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          Completed {fmtDate(t.completedDate)}
                        </div>
                      ) : null}
                    </div>
                    <span
                      className={`w-20 text-right tabular-nums text-[12px] ${
                        overdue ? 'text-[#DC2626] font-semibold' : 'text-muted-foreground'
                      }`}
                    >
                      {t.dueDate ? format(parseISO(t.dueDate), 'MMM dd') : 'TBD'}
                    </span>
                  </div>
                );
                return locked ? (
                  <Tooltip key={t.id}>
                    <TooltipTrigger asChild><div>{row}</div></TooltipTrigger>
                    <TooltipContent>Complete previous task first</TooltipContent>
                  </Tooltip>
                ) : (
                  <div key={t.id}>{row}</div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <TaskDrawer
        taskId={drawerTask?.task.id ?? null}
        fallbackTask={drawerTask?.task ?? null}
        locked={drawerTask?.locked ?? false}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  );
}
