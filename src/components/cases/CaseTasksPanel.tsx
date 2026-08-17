// Tasks card on the case detail page. Sequential lock: a task is locked
// until previous tasks are completed. Row click opens the TaskDrawer.
//
// Slice E (payer-and-cases screen 6): ONE list — the step-at-a-time wizard is
// retired. Each task shows its execution type and due date, and its ordered
// steps render beneath it; the CURRENT step (the first incomplete step of the
// first unfinished task) carries the "Open step" affordance that opens the
// drawer, where the step bodies and Mark-step-done live.
import { useRef, useState } from "react";
import { differenceInDays, parseISO } from "date-fns";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill } from "@/components/StatusPill";
import { CheckCircle2, Circle, Lock } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { useUpdateTaskStatus } from "@/hooks/useTasks";
import { useCanWrite } from "@/lib/permissions";
import { TaskDrawer } from "@/components/cases/TaskDrawer";
import { currentStepPointer, orderedSteps, summarizeTasks } from "@/lib/caseDetailView";
import { EXECUTION_TYPE_LABELS, resolveExecutionType } from "@/lib/executionTypes";
import type { Task, TaskStatus } from "@/types";

function taskStatusIcon(status: Task["status"], locked: boolean) {
  if (locked) return <Lock className="w-4 h-4 text-muted-foreground" />;
  if (status === "completed") return <CheckCircle2 className="w-4 h-4 text-[#059669]" />;
  if (status === "in_progress") return <Circle className="w-4 h-4 text-[#D97706] fill-[#FEF3C7]" />;
  if (status === "blocked") return <Lock className="w-4 h-4 text-[#DC2626]" />;
  return <Circle className="w-4 h-4 text-muted-foreground" />;
}

export function CaseTasksPanel({
  tasks,
  tokenValues,
  groupId = null,
  providerName = "this provider",
  groupName = null,
}: {
  tasks: Task[];
  /** token -> value map for the drawer's pdf-step filler (built by the case page). */
  tokenValues?: Record<string, string>;
  /** ASD — the case's group, threaded to the drawer's step-artifact panel
   * and Active Documents rail. */
  groupId?: string | null;
  providerName?: string;
  groupName?: string | null;
}) {
  const canEdit = useCanWrite();
  const updateStatusM = useUpdateTaskStatus();
  const [drawerTask, setDrawerTask] = useState<{ task: Task; locked: boolean } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reopenTask, setReopenTask] = useState<Task | null>(null);
  const undoRef = useRef<Set<string>>(new Set());
  const summary = summarizeTasks(tasks);
  const currentStep = currentStepPointer(tasks);

  const openDrawer = (task: Task, locked: boolean) => {
    setDrawerTask({ task, locked });
    setDrawerOpen(true);
  };

  const reopenConfirm = () => {
    const t = reopenTask;
    if (!t) return;
    setReopenTask(null);
    updateStatusM.mutate(
      { id: t.id, status: "in_progress" },
      {
        onSuccess: () => toast.success(`Reopened "${t.title}"`),
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Could not reopen task"),
      },
    );
  };

  const completeWithUndo = (task: Task) => {
    if (!canEdit) return;
    if (task.status === "completed") return;
    const previous: TaskStatus = task.status;
    updateStatusM.mutate(
      { id: task.id, status: "completed" },
      {
        onSuccess: () => {
          toast.success(`Completed "${task.title}"`, {
            action: {
              label: "Undo",
              onClick: () => {
                if (undoRef.current.has(task.id)) return;
                undoRef.current.add(task.id);
                updateStatusM.mutate(
                  { id: task.id, status: previous },
                  {
                    onSettled: () => undoRef.current.delete(task.id),
                    onError: (err: unknown) =>
                      toast.error(err instanceof Error ? err.message : "Could not undo"),
                  },
                );
              },
            },
          });
        },
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Could not complete task"),
      },
    );
  };

  return (
    <>
      <Card className="shadow-none border-border">
        <CardHeader className="p-4 pb-2 border-b border-border flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-[14px] font-semibold">Tasks</CardTitle>
          <span className="text-[12px] text-muted-foreground tabular-nums">
            {summary.completed} of {summary.total} completed
            {summary.nextDueDate ? ` · next due ${fmtDate(summary.nextDueDate)}` : ""}
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
                  .some((p) => p.status !== "completed");
                const locked = previousIncomplete && t.status !== "completed";
                const overdue =
                  t.status !== "completed" &&
                  t.dueDate &&
                  differenceInDays(new Date(), parseISO(t.dueDate)) > 0;

                const canComplete = canEdit && !locked && t.status !== "completed";
                const canReopen = canEdit && t.status === "completed";
                const circleInteractive = canComplete || canReopen;

                const row = (
                  <div
                    className={`p-3 flex items-center gap-3 text-[13px] ${
                      locked ? "opacity-60 cursor-not-allowed" : "hover:bg-muted/30 cursor-pointer"
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
                        circleInteractive
                          ? "hover:bg-[#1B4D3E]/10 cursor-pointer"
                          : "cursor-default"
                      }`}
                      aria-label={
                        canComplete
                          ? `Complete ${t.title}`
                          : canReopen
                            ? `Reopen ${t.title}`
                            : `Status ${t.status}`
                      }
                      disabled={!circleInteractive || updateStatusM.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (canComplete) {
                          completeWithUndo(t);
                          return;
                        }
                        if (canReopen) {
                          setReopenTask(t);
                        }
                      }}
                    >
                      {taskStatusIcon(t.status, locked)}
                    </button>
                    <div
                      className={`flex-1 min-w-0 ${
                        t.status === "completed"
                          ? "text-muted-foreground"
                          : "text-foreground font-medium"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={t.status === "completed" ? "line-through" : ""}>
                          {t.title}
                        </span>
                        {/* Screen 6 — the E4.2 execution type rides every task
                            row (captured configuration; nothing runs here). */}
                        <span className="rounded-[4px] border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {EXECUTION_TYPE_LABELS[resolveExecutionType(t.executionType)]}
                        </span>
                        {t.status === "blocked" ? (
                          <StatusPill status="red" label="Blocked" />
                        ) : null}
                      </div>
                      {t.status === "completed" && t.completedDate ? (
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          Completed {fmtDate(t.completedDate)}
                        </div>
                      ) : null}
                    </div>
                    <span
                      className={`w-20 text-right tabular-nums text-[12px] ${
                        overdue ? "text-[#DC2626] font-semibold" : "text-muted-foreground"
                      }`}
                    >
                      {t.dueDate ? fmtDate(t.dueDate) : "TBD"}
                    </span>
                  </div>
                );

                const steps = orderedSteps(t);
                const body = (
                  <div>
                    {row}
                    {steps.length > 0 && !locked ? (
                      <ul className="space-y-1.5 px-3 pb-3 pl-11">
                        {steps.map((s) => {
                          const isCurrent =
                            currentStep?.taskId === t.id && currentStep?.stepId === s.id;
                          return (
                            <li
                              key={s.id}
                              className="flex flex-wrap items-center gap-2 text-[13px]"
                            >
                              <span
                                aria-hidden
                                className={`h-1.5 w-1.5 flex-none rounded-full ${
                                  s.isCompleted
                                    ? "bg-[#059669]"
                                    : isCurrent
                                      ? "bg-[#D97706]"
                                      : "bg-border"
                                }`}
                              />
                              <span
                                className={
                                  s.isCompleted ? "text-muted-foreground" : "text-foreground"
                                }
                              >
                                {s.label}
                              </span>
                              {isCurrent ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 px-2 text-[12px]"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openDrawer(t, false);
                                  }}
                                >
                                  Open step
                                </Button>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </div>
                );

                return locked ? (
                  <Tooltip key={t.id}>
                    <TooltipTrigger asChild>
                      <div>{body}</div>
                    </TooltipTrigger>
                    <TooltipContent>Complete previous task first</TooltipContent>
                  </Tooltip>
                ) : (
                  <div key={t.id}>{body}</div>
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
        tokenValues={tokenValues}
        groupId={groupId}
        caseTasks={tasks}
        providerName={providerName}
        groupName={groupName}
      />

      <Dialog
        open={reopenTask !== null}
        onOpenChange={(o) => {
          if (!o) setReopenTask(null);
        }}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Reopen this task?</DialogTitle>
            <DialogDescription>It will move back to In progress.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenTask(null)}>
              Cancel
            </Button>
            <Button
              className="bg-[#1B4D3E] hover:bg-[#1B4D3E]/90 text-white"
              onClick={reopenConfirm}
              disabled={updateStatusM.isPending}
            >
              Reopen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
