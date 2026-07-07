// Right-side slide-over that opens on task row click from the case Tasks panel.
// Lets coordinators run status changes, SOP steps, and notes without leaving the case page.
import { useEffect, useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useNavigate } from "@tanstack/react-router";
import { differenceInDays, parseISO } from "date-fns";
import { toast } from "sonner";
import {
  Calendar,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Lock,
  MessageSquare,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill } from "@/components/StatusPill";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useCompleteSOPStep, useTask, useUpdateTaskStatus } from "@/hooks/useTasks";
import { useLogNote, useTaskTouchlog } from "@/hooks/useTouches";
import { useCanWrite } from "@/lib/permissions";
import type { SOPStep, Task, TaskStatus } from "@/types";

interface TaskDrawerProps {
  taskId: string | null;
  fallbackTask: Task | null;
  locked: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function initialsOf(name: string | null | undefined): string {
  if (!name) return "··";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "··";
}

function statusLabel(s: TaskStatus): string {
  if (s === "not_started") return "Not started";
  if (s === "in_progress") return "In progress";
  if (s === "completed") return "Completed";
  return "Blocked";
}

function statusPillColor(s: TaskStatus): "gray" | "amber" | "green" | "red" {
  if (s === "completed") return "green";
  if (s === "in_progress") return "amber";
  if (s === "blocked") return "red";
  return "gray";
}

export function TaskDrawer({ taskId, fallbackTask, locked, open, onOpenChange }: TaskDrawerProps) {
  const navigate = useNavigate();
  const canEdit = useCanWrite();

  const taskQ = useTask(open && taskId ? taskId : undefined);
  const task = taskQ.data ?? fallbackTask;

  const touchlogQ = useTaskTouchlog(open && taskId ? taskId : undefined);
  const updateStatusM = useUpdateTaskStatus();
  const completeStepM = useCompleteSOPStep();
  const logNoteM = useLogNote();

  const [noteDraft, setNoteDraft] = useState("");
  useEffect(() => {
    if (!open) setNoteDraft("");
  }, [open]);

  const steps = useMemo<SOPStep[]>(
    () =>
      Array.isArray(task?.sopContent)
        ? task!.sopContent.slice().sort((a, b) => a.order - b.order)
        : [],
    [task?.sopContent],
  );
  const firstIncompleteIndex = steps.findIndex((s) => !s.isCompleted);

  if (!task) return null;

  const overdue =
    task.status !== "completed" &&
    task.dueDate &&
    differenceInDays(new Date(), parseISO(task.dueDate)) > 0;

  const handleSetStatus = (next: TaskStatus, successMsg = "Status updated") => {
    if (!canEdit) return;
    if (next === task.status) return;
    updateStatusM.mutate(
      { id: task.id, status: next },
      {
        onSuccess: () => toast.success(successMsg),
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Could not update status"),
      },
    );
  };

  const handleMarkComplete = () => {
    if (locked || task.status === "completed") return;
    handleSetStatus("completed", "Task completed");
  };

  const handleStep = (index: number, checked: boolean) => {
    if (!checked) return;
    if (index !== firstIncompleteIndex) return;
    const step = steps[index];
    if (!step) return;
    completeStepM.mutate(
      { taskId: task.id, stepId: step.id },
      {
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Could not complete step"),
      },
    );
  };

  const handleAddNote = () => {
    const content = noteDraft.trim();
    if (!content) return;
    if (!task.caseId) {
      toast.error("This task is not linked to a case, so notes can't be logged.");
      return;
    }
    logNoteM.mutate(
      { caseId: task.caseId, input: { content, taskId: task.id } },
      {
        onSuccess: () => setNoteDraft(""),
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Could not add note"),
      },
    );
  };

  const entries = touchlogQ.data ?? [];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-[480px] flex-col border-l border-[#E8E5E0] bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right duration-200"
          aria-describedby={undefined}
        >
          <TooltipProvider delayDuration={150}>
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-[#E8E5E0] p-4">
              <div className="min-w-0 flex-1 space-y-2">
                <DialogPrimitive.Title className="text-[15px] font-semibold text-foreground">
                  {task.title}
                </DialogPrimitive.Title>
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  <span
                    className={`inline-flex items-center gap-1 tabular-nums ${
                      overdue ? "text-[#DC2626] font-semibold" : "text-muted-foreground"
                    }`}
                  >
                    <Calendar className="h-3.5 w-3.5" />
                    Due {fmtDate(task.dueDate)}
                  </span>
                  <StatusPill
                    status={statusPillColor(task.status)}
                    label={statusLabel(task.status)}
                  />
                </div>
              </div>
              <DialogPrimitive.Close
                className="rounded-sm p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* Actions */}
              <div className="space-y-3">
                {task.status !== "completed" ? (
                  locked ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex w-full">
                          <Button
                            className="w-full bg-[#1B4D3E] hover:bg-[#1B4D3E]/90 text-white"
                            disabled
                          >
                            Mark complete
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Complete previous task first</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Button
                      className="w-full bg-[#1B4D3E] hover:bg-[#1B4D3E]/90 text-white"
                      onClick={handleMarkComplete}
                      disabled={!canEdit || updateStatusM.isPending}
                    >
                      {updateStatusM.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Mark complete"
                      )}
                    </Button>
                  )
                ) : null}

                <div className="flex items-center gap-2">
                  <label className="text-[12px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Status
                  </label>
                  <Select
                    value={task.status}
                    onValueChange={(v) => handleSetStatus(v as TaskStatus)}
                    disabled={!canEdit || updateStatusM.isPending || task.status === "completed"}
                  >
                    <SelectTrigger className="h-8 flex-1 text-[13px] shadow-none">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="not_started">Not started</SelectItem>
                      <SelectItem value="in_progress">In progress</SelectItem>
                      <SelectItem value="blocked">Blocked</SelectItem>
                      {task.status === "completed" ? (
                        <SelectItem value="completed" disabled>
                          Completed
                        </SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* SOP Steps */}
              <div className="space-y-2">
                <h3 className="text-[12px] uppercase tracking-wide text-muted-foreground font-semibold">
                  SOP steps
                </h3>
                {steps.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    No SOP steps defined for this task.
                  </p>
                ) : (
                  <div className="rounded-md border border-[#E8E5E0] divide-y divide-[#E8E5E0]">
                    {steps.map((step, index) => {
                      const isChecked = step.isCompleted;
                      const isActive = !isChecked && index === firstIncompleteIndex;
                      const isLocked = !isChecked && !isActive;
                      return (
                        <div key={step.id} className="flex items-start gap-3 p-3">
                          {isLocked ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex">
                                  <Checkbox checked={false} disabled />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                Complete step {firstIncompleteIndex + 1} first
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <Checkbox
                              checked={isChecked}
                              disabled={
                                isChecked || !isActive || !canEdit || completeStepM.isPending
                              }
                              onCheckedChange={(v) => handleStep(index, Boolean(v))}
                            />
                          )}
                          <p
                            className={`flex-1 text-[13px] leading-snug ${
                              isChecked ? "text-muted-foreground line-through" : "text-foreground"
                            }`}
                          >
                            {step.label}
                          </p>
                          {isChecked ? (
                            <CheckCircle2 className="h-4 w-4 text-[#059669] flex-shrink-0" />
                          ) : isLocked ? (
                            <Lock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Activity — the task-filtered slice of the touchlog */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-[14px] font-semibold">Activity</h3>
                </div>

                {touchlogQ.isLoading ? (
                  <p className="text-[13px] text-muted-foreground">Loading activity…</p>
                ) : touchlogQ.isError ? (
                  <p className="text-[13px] text-muted-foreground">Could not load activity.</p>
                ) : entries.length === 0 ? (
                  <EmptyState message="No activity yet" />
                ) : (
                  <div className="space-y-3">
                    {entries.map((n) => (
                      <div key={n.id} className="flex gap-2">
                        <div className="h-7 w-7 rounded-full bg-[#1B4D3E]/10 border border-[#1B4D3E]/20 flex items-center justify-center text-[#1B4D3E] font-medium text-[11px] flex-shrink-0">
                          {initialsOf(n.authorName)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-[11px]">
                            <span className="font-semibold text-foreground">
                              {n.authorName ?? "—"}
                            </span>
                            {n.entryType !== "note" ? (
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1 py-0.5">
                                {n.entryType === "task_update" ? "Task update" : "System"}
                              </span>
                            ) : null}
                            <span className="text-muted-foreground tabular-nums">
                              {fmtDateTime(n.createdAt)}
                            </span>
                          </div>
                          <p className="text-[13px] text-foreground mt-0.5 whitespace-pre-wrap leading-relaxed">
                            {n.content}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {canEdit ? (
                  <div className="space-y-2">
                    <Textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="Add a note…"
                      rows={2}
                      className="text-[13px] shadow-none resize-none"
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleAddNote}
                        disabled={!noteDraft.trim() || logNoteM.isPending}
                      >
                        Add note
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-[#E8E5E0] p-3">
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  navigate({ to: "/tasks/$id", params: { id: task.id } });
                }}
                className="inline-flex items-center gap-1.5 text-[13px] text-[#1B4D3E] hover:underline underline-offset-4"
              >
                Open full task page
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>
          </TooltipProvider>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
