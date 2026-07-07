// Task detail at /tasks/$id. SOP step runner that coordinators use side-by-side
// with a payer portal: ordered step lock, copy buttons for data fields, notes.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Calendar, CheckCircle2, ExternalLink, Loader2, Lock, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/EmptyState";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { CopyButton } from "@/components/CopyButton";
import { useTask, useCompleteSOPStep, useUpdateTaskStatus } from "@/hooks/useTasks";
import { useCase } from "@/hooks/useCases";
import { useLogNote, useTaskTouchlog } from "@/hooks/useTouches";
import { useCanWrite } from "@/lib/permissions";
import type { SOPStep, TaskStatus } from "@/types";

export const Route = createFileRoute("/tasks/$id")({
  component: TaskDetailPage,
});

interface DataField {
  label: string;
  value: string;
}

function initialsOf(name: string | null | undefined): string {
  if (!name) return "··";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "··";
}

function readInstruction(step: SOPStep): string {
  const raw = step as unknown as { instruction?: unknown; label?: unknown };
  if (typeof raw.instruction === "string") return raw.instruction;
  if (typeof raw.label === "string") return raw.label;
  return "";
}

function readDataFields(step: SOPStep): DataField[] {
  const raw = step as unknown as { dataFields?: unknown; data_fields?: unknown };
  const candidate = raw.dataFields ?? raw.data_fields;
  if (!Array.isArray(candidate)) return [];
  const out: DataField[] = [];
  for (const item of candidate) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const label = typeof o.label === "string" && o.label.trim() !== "" ? o.label : null;
    if (label === null) continue;
    if (o.value === null || o.value === undefined) continue;
    const value = String(o.value);
    if (value === "") continue;
    out.push({ label, value });
  }
  return out;
}

function TaskDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const canEdit = useCanWrite();

  const taskQ = useTask(id);
  const task = taskQ.data ?? null;
  const caseQ = useCase(task?.caseId ?? undefined);
  const touchlogQ = useTaskTouchlog(id);

  const completeStepM = useCompleteSOPStep();
  const updateStatusM = useUpdateTaskStatus();
  const logNoteM = useLogNote();

  const [noteDraft, setNoteDraft] = useState("");

  const sopIsValid = Array.isArray(task?.sopContent);
  const steps = useMemo<SOPStep[]>(
    () =>
      Array.isArray(task?.sopContent)
        ? task!.sopContent.slice().sort((a, b) => a.order - b.order)
        : [],
    [task?.sopContent],
  );

  const completedCount = steps.filter((s) => s.isCompleted).length;
  const totalSteps = steps.length;
  const allComplete = totalSteps > 0 && completedCount === totalSteps;
  const firstIncompleteIndex = steps.findIndex((s) => !s.isCompleted);

  // Auto-complete the task once all steps are checked off.
  useEffect(() => {
    if (!task) return;
    if (allComplete && task.status !== "completed" && !updateStatusM.isPending) {
      updateStatusM.mutate(
        { id: task.id, status: "completed" },
        {
          onError: (err: unknown) =>
            toast.error(err instanceof Error ? err.message : "Could not update status"),
        },
      );
    }
  }, [allComplete, task, updateStatusM]);

  if (taskQ.isLoading) {
    return (
      <div className="max-w-[860px] mx-auto space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (taskQ.isError) {
    return (
      <div className="max-w-[860px] mx-auto space-y-3">
        <h1 className="text-[20px] font-semibold">Something went wrong loading this task</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => taskQ.refetch()}>
            Retry
          </Button>
          <Button variant="outline" onClick={() => navigate({ to: "/cases" })}>
            Back to cases
          </Button>
        </div>
      </div>
    );
  }
  if (!task) {
    return (
      <div className="max-w-[860px] mx-auto space-y-3">
        <h1 className="text-[20px] font-semibold">Task not found</h1>
        <Button variant="outline" onClick={() => navigate({ to: "/cases" })}>
          Back to cases
        </Button>
      </div>
    );
  }

  const c = caseQ.data ?? null;
  const providerName = c?.provider ? `${c.provider.firstName} ${c.provider.lastName}` : null;
  const payerName = c?.payer?.name ?? null;
  const stateCode = c?.state ?? null;
  const caseLabel = c
    ? [providerName, payerName, stateCode].filter(Boolean).join(" · ") || "Case"
    : "Case";

  // Locked when any earlier task in the same case is not yet completed.
  const isLocked = (() => {
    if (!c?.tasks || task.status === "completed") return false;
    const ordered = c.tasks.slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = ordered.findIndex((t) => t.id === task.id);
    if (idx <= 0) return false;
    return ordered.slice(0, idx).some((t) => t.status !== "completed");
  })();

  const handleToggleStep = (stepIndex: number, checked: boolean) => {
    if (!checked) return; // ordered, no uncheck
    if (stepIndex !== firstIncompleteIndex) return;
    const step = steps[stepIndex];
    if (!step) return;
    completeStepM.mutate(
      { taskId: task.id, stepId: step.id },
      {
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Could not complete step"),
      },
    );
  };

  const handleStatusChange = (next: string) => {
    if (!canEdit) return;
    if (next === task.status) return;
    updateStatusM.mutate(
      { id: task.id, status: next as TaskStatus },
      {
        onSuccess: () => toast.success("Status updated"),
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Could not update status"),
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
        onSuccess: () => {
          setNoteDraft("");
          touchlogQ.refetch();
        },
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Could not add note"),
      },
    );
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="max-w-[860px] mx-auto space-y-6">
        {/* Header */}
        <div className="space-y-3">
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-2 text-sm text-muted-foreground min-w-0"
          >
            <Link to="/cases" className="hover:text-foreground hover:underline underline-offset-4">
              Cases
            </Link>
            <span className="text-border">/</span>
            {task.caseId ? (
              <Link
                to="/cases/$id"
                params={{ id: task.caseId }}
                className="hover:text-foreground hover:underline underline-offset-4 truncate"
              >
                {caseLabel}
              </Link>
            ) : (
              <span className="truncate">{caseLabel}</span>
            )}
            <span className="text-border">/</span>
            <span className="text-foreground truncate">{task.title}</span>
          </nav>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-[20px] font-semibold text-foreground">{task.title}</h1>
              {c ? (
                <Link
                  to="/cases/$id"
                  params={{ id: c.id }}
                  className="text-[14px] text-muted-foreground mt-1 inline-flex items-center gap-2 flex-wrap hover:text-foreground group"
                >
                  <span className="group-hover:underline underline-offset-4">
                    {providerName ?? "Provider"}
                  </span>
                  <span className="text-border">•</span>
                  <span className="group-hover:underline underline-offset-4">
                    {payerName ?? "—"}
                  </span>
                  <span className="text-border">•</span>
                  <span className="group-hover:underline underline-offset-4">
                    {stateCode ?? "—"}
                  </span>
                  <ExternalLink className="h-3 w-3" />
                </Link>
              ) : task.caseId ? (
                <p className="text-[14px] text-muted-foreground mt-1">Loading case…</p>
              ) : null}
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span className="tabular-nums">Due {fmtDate(task.dueDate)}</span>
              </div>
              {updateStatusM.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : null}
              {task.status !== "completed" ? (
                isLocked ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Button
                          size="sm"
                          className="h-8 bg-[#1B4D3E] hover:bg-[#1B4D3E]/90 text-white"
                          disabled
                        >
                          Mark complete
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Complete earlier tasks first</TooltipContent>
                  </Tooltip>
                ) : (
                  <Button
                    size="sm"
                    className="h-8 bg-[#1B4D3E] hover:bg-[#1B4D3E]/90 text-white"
                    disabled={!canEdit || updateStatusM.isPending}
                    onClick={() => handleStatusChange("completed")}
                  >
                    Mark complete
                  </Button>
                )
              ) : null}
              <Select
                value={task.status === "completed" ? "completed" : task.status}
                onValueChange={handleStatusChange}
                disabled={!canEdit || updateStatusM.isPending || task.status === "completed"}
              >
                <SelectTrigger className="w-[150px] h-8 text-[13px] shadow-none">
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

          {/* Progress */}
          <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-[#1B4D3E] transition-all"
                style={{
                  width: totalSteps > 0 ? `${(completedCount / totalSteps) * 100}%` : "0%",
                }}
              />
            </div>
            <span className="tabular-nums font-medium text-foreground">
              {completedCount} / {totalSteps} steps
            </span>
          </div>
        </div>

        {/* Success banner */}
        {allComplete ? (
          <div className="flex items-center gap-2 rounded-md border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-2 text-[13px] text-[#065F46]">
            <CheckCircle2 className="h-4 w-4" />
            All steps complete. Task marked completed.
          </div>
        ) : null}

        {/* SOP Steps */}
        <Card className="shadow-none border-[#E8E5E0]">
          <CardContent className="p-0 divide-y divide-[#E8E5E0]">
            {!sopIsValid ? (
              <div className="m-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
                SOP steps could not be read for this task.
              </div>
            ) : steps.length === 0 ? (
              <div className="p-6 text-[14px] text-muted-foreground">
                No SOP steps defined for this task.
              </div>
            ) : (
              steps.map((step, index) => {
                const isChecked = step.isCompleted;
                const isActive = !isChecked && index === firstIncompleteIndex;
                const isLocked = !isChecked && !isActive;
                const fields = readDataFields(step);
                const stepNumber = index + 1;
                const blockingStep = firstIncompleteIndex + 1;

                return (
                  <div
                    key={step.id}
                    className={`p-4 flex gap-4 ${isLocked ? "opacity-60" : ""} ${
                      isActive ? "bg-[#1B4D3E]/[0.03]" : ""
                    }`}
                  >
                    <div className="flex flex-col items-center gap-2 flex-shrink-0 pt-0.5">
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-semibold tabular-nums ${
                          isChecked
                            ? "bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]"
                            : isActive
                              ? "bg-[#1B4D3E] text-white"
                              : "bg-muted text-muted-foreground border border-[#E8E5E0]"
                        }`}
                      >
                        {isChecked ? <CheckCircle2 className="h-4 w-4" /> : stepNumber}
                      </span>

                      {isLocked ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <Checkbox
                                checked={false}
                                disabled
                                aria-label={`Locked — complete step ${blockingStep} first`}
                              />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Complete step {blockingStep} first</TooltipContent>
                        </Tooltip>
                      ) : (
                        <Checkbox
                          checked={isChecked}
                          disabled={isChecked || !isActive || !canEdit || completeStepM.isPending}
                          onCheckedChange={(v) => handleToggleStep(index, Boolean(v))}
                          aria-label={`Mark step ${stepNumber} complete`}
                        />
                      )}
                    </div>

                    <div className="flex-1 min-w-0 space-y-3">
                      <div className="flex items-start gap-2">
                        <p
                          className={`text-[14px] leading-relaxed ${
                            isChecked ? "text-muted-foreground" : "text-foreground font-medium"
                          }`}
                        >
                          {readInstruction(step)}
                        </p>
                        {isLocked ? (
                          <Lock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-1" />
                        ) : null}
                      </div>

                      {fields.length > 0 ? (
                        <div className="bg-[#FAFAF9] border border-[#E8E5E0] rounded-md divide-y divide-[#E8E5E0]">
                          {fields.map((field, fi) => (
                            <div
                              key={`${field.label}-${fi}`}
                              className="flex items-center justify-between gap-4 px-3 py-2"
                            >
                              <span className="text-[12px] uppercase tracking-wide text-muted-foreground font-semibold w-24 flex-shrink-0">
                                {field.label}
                              </span>
                              <span className="text-[14px] font-medium tabular-nums flex-1 truncate">
                                {field.value}
                              </span>
                              <CopyButton value={field.value} label={field.label} />
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Notes Thread */}
        <Card className="shadow-none border-[#E8E5E0]">
          <div className="p-4 pb-2 border-b border-[#E8E5E0] flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-[14px] font-semibold">Activity</h2>
          </div>
          <CardContent className="p-4 space-y-4">
            {touchlogQ.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : touchlogQ.isError ? (
              <p className="text-[13px] text-muted-foreground">Could not load activity.</p>
            ) : (touchlogQ.data ?? []).length === 0 ? (
              <EmptyState message="No activity yet" />
            ) : (
              <div className="space-y-4">
                {(touchlogQ.data ?? []).map((n) => (
                  <div key={n.id} className="flex gap-3">
                    <div className="h-7 w-7 rounded-full bg-[#1B4D3E]/10 border border-[#1B4D3E]/20 flex items-center justify-center text-[#1B4D3E] font-medium text-[11px] flex-shrink-0">
                      {initialsOf(n.authorName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-[12px]">
                        <span className="font-semibold text-foreground">{n.authorName ?? "—"}</span>
                        {n.entryType !== "note" ? (
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1 py-0.5">
                            {n.entryType === "task_update" ? "Task update" : "System"}
                          </span>
                        ) : null}
                        <span className="text-muted-foreground tabular-nums">
                          {fmtDateTime(n.createdAt)}
                        </span>
                      </div>
                      <p className="text-[14px] text-foreground mt-0.5 leading-relaxed whitespace-pre-wrap">
                        {n.content}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {canEdit ? (
              <div className="pt-2 border-t border-[#E8E5E0] space-y-2">
                <Textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Add a note for this task…"
                  className="min-h-[72px] text-[14px] shadow-none resize-none"
                  aria-label="Add a note"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={handleAddNote}
                    disabled={!noteDraft.trim() || logNoteM.isPending}
                  >
                    {logNoteM.isPending ? "Saving…" : "Add note"}
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
