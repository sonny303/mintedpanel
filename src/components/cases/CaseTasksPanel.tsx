// Tasks card on the case detail page. Sequential lock: a task is locked
// until previous tasks are completed. Row click navigates to /tasks/:id.
import { differenceInDays, format, parseISO } from 'date-fns';
import { useNavigate } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { EmptyState } from '@/components/EmptyState';
import { CheckCircle2, Circle, Lock } from 'lucide-react';
import type { Task } from '@/types';

function taskStatusIcon(status: Task['status'], locked: boolean) {
  if (locked) return <Lock className="w-4 h-4 text-muted-foreground" />;
  if (status === 'completed') return <CheckCircle2 className="w-4 h-4 text-[#059669]" />;
  if (status === 'in_progress') return <Circle className="w-4 h-4 text-[#D97706] fill-[#FEF3C7]" />;
  if (status === 'blocked') return <Lock className="w-4 h-4 text-muted-foreground" />;
  return <Circle className="w-4 h-4 text-muted-foreground" />;
}

export function CaseTasksPanel({ tasks }: { tasks: Task[] }) {
  const navigate = useNavigate();
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;

  return (
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
              const row = (
                <div
                  className={`p-3 flex items-center gap-3 text-[13px] ${
                    locked ? 'opacity-60 cursor-not-allowed' : 'hover:bg-muted/30 cursor-pointer'
                  }`}
                  onClick={() => {
                    if (locked) return;
                    navigate({ to: '/tasks/$id', params: { id: t.id } });
                  }}
                >
                  <div className="flex-shrink-0">{taskStatusIcon(t.status, locked)}</div>
                  <div
                    className={`flex-1 ${
                      t.status === 'completed'
                        ? 'text-muted-foreground line-through'
                        : 'text-foreground font-medium'
                    }`}
                  >
                    {t.title}
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
  );
}
