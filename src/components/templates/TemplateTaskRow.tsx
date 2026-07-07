// Editor card for a single template task, including its SOP steps and
// per-step data field rows. Drag state is owned by the parent so
// cross-task reordering keeps working exactly as before.
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import type { SOPStepType } from "@/types";

interface DataField {
  label: string;
  token: string;
}

interface EmailTemplate {
  subject: string;
  body: string;
}

interface EditableStep {
  id: string;
  label: string;
  detail: string;
  stepType: SOPStepType;
  emailTemplate: EmailTemplate;
  dataFields: DataField[];
}

interface EditableTask {
  id: string;
  title: string;
  description: string;
  dueOffsetDays: number;
  steps: EditableStep[];
}

interface SopFieldToken {
  token: string;
  table: string;
  column: string;
}

interface TokenGroup {
  prefix: string;
  label: string;
  items: SopFieldToken[];
}

interface DragStep {
  taskId: string;
  stepId: string;
}

// Append a {{token}} placeholder to the email body, spacing it off prior text.
function appendToken(body: string, token: string): string {
  const sep = body.length > 0 && !/\s$/.test(body) ? " " : "";
  return `${body}${sep}{{${token}}}`;
}

export interface TemplateTaskRowProps {
  task: EditableTask;
  taskIdx: number;
  canEdit: boolean;
  groupedTokens: TokenGroup[];
  dragTaskId: string | null;
  setDragTaskId: (v: string | null) => void;
  dragStep: DragStep | null;
  setDragStep: (v: DragStep | null) => void;
  reorderTasks: (fromId: string, toId: string) => void;
  updateTask: (taskId: string, patch: Partial<EditableTask>) => void;
  removeTask: (taskId: string) => void;
  addStep: (taskId: string) => void;
  removeStep: (taskId: string, stepId: string) => void;
  updateStep: (taskId: string, stepId: string, patch: Partial<EditableStep>) => void;
  reorderSteps: (taskId: string, fromId: string, toId: string) => void;
  addDataField: (taskId: string, stepId: string) => void;
  updateDataField: (taskId: string, stepId: string, idx: number, patch: Partial<DataField>) => void;
  removeDataField: (taskId: string, stepId: string, idx: number) => void;
}

export function TemplateTaskRow({
  task,
  taskIdx,
  canEdit,
  groupedTokens,
  dragTaskId,
  setDragTaskId,
  dragStep,
  setDragStep,
  reorderTasks,
  updateTask,
  removeTask,
  addStep,
  removeStep,
  updateStep,
  reorderSteps,
  addDataField,
  updateDataField,
  removeDataField,
}: TemplateTaskRowProps) {
  return (
    <div
      draggable={canEdit}
      onDragStart={() => setDragTaskId(task.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => {
        if (dragTaskId) reorderTasks(dragTaskId, task.id);
        setDragTaskId(null);
      }}
      className="rounded-md border border-[#E8E5E0] bg-card"
    >
      <div className="flex items-start gap-2 p-4 border-b border-[#E8E5E0]">
        {canEdit ? (
          <GripVertical className="h-4 w-4 text-muted-foreground mt-2 cursor-grab" />
        ) : null}
        <div className="flex-1 grid grid-cols-[1fr_140px] gap-3">
          <div>
            <Label>Task {taskIdx + 1} title</Label>
            <Input
              value={task.title}
              onChange={(e) => updateTask(task.id, { title: e.target.value })}
              disabled={!canEdit}
            />
          </div>
          <div>
            <Label>Due day offset</Label>
            <Input
              type="number"
              value={task.dueOffsetDays}
              onChange={(e) =>
                updateTask(task.id, {
                  dueOffsetDays: Number.parseInt(e.target.value, 10) || 0,
                })
              }
              disabled={!canEdit}
            />
          </div>
          <div className="col-span-2">
            <Label>Description</Label>
            <Textarea
              value={task.description}
              onChange={(e) => updateTask(task.id, { description: e.target.value })}
              disabled={!canEdit}
              rows={2}
            />
          </div>
        </div>
        {canEdit ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => removeTask(task.id)}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">SOP steps</span>
          {canEdit ? (
            <Button size="sm" variant="outline" onClick={() => addStep(task.id)}>
              <Plus className="h-4 w-4 mr-2" />
              Add step
            </Button>
          ) : null}
        </div>

        {task.steps.map((step, stepIdx) => (
          <div
            key={step.id}
            draggable={canEdit}
            onDragStart={(e) => {
              e.stopPropagation();
              setDragStep({ taskId: task.id, stepId: step.id });
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.stopPropagation();
              if (dragStep && dragStep.taskId === task.id) {
                reorderSteps(task.id, dragStep.stepId, step.id);
              }
              setDragStep(null);
            }}
            className="rounded-md border border-[#E8E5E0] p-3 bg-muted/20"
          >
            <div className="flex items-start gap-2">
              {canEdit ? (
                <GripVertical className="h-4 w-4 text-muted-foreground mt-2 cursor-grab" />
              ) : null}
              <div className="flex-1 space-y-2">
                <div>
                  <Label className="text-xs">Step {stepIdx + 1} instruction</Label>
                  <Textarea
                    value={step.label}
                    onChange={(e) => updateStep(task.id, step.id, { label: e.target.value })}
                    disabled={!canEdit}
                    rows={2}
                  />
                </div>

                <div>
                  <Label className="text-xs">Step type</Label>
                  <Select
                    value={step.stepType}
                    onValueChange={(v) =>
                      updateStep(task.id, step.id, { stepType: v as SOPStepType })
                    }
                    disabled={!canEdit}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="online_form">Online form</SelectItem>
                      <SelectItem value="draft_email">Draft email</SelectItem>
                      <SelectItem value="pdf" disabled>
                        PDF (coming soon)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {step.stepType === "draft_email" ? (
                  <div className="space-y-2 rounded-md border border-[#FDE68A] bg-[#FEF3C7] p-3">
                    <p className="text-[11px] text-[#92400E]">
                      Tokens like {"{{provider.firstName}}"} resolve when the task is created.
                    </p>
                    <div>
                      <Label className="text-xs">Subject</Label>
                      <Input
                        value={step.emailTemplate.subject}
                        onChange={(e) =>
                          updateStep(task.id, step.id, {
                            emailTemplate: { ...step.emailTemplate, subject: e.target.value },
                          })
                        }
                        disabled={!canEdit}
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <Label className="text-xs">Body</Label>
                        {canEdit ? (
                          <Select
                            value=""
                            onValueChange={(token) =>
                              updateStep(task.id, step.id, {
                                emailTemplate: {
                                  ...step.emailTemplate,
                                  body: appendToken(step.emailTemplate.body, token),
                                },
                              })
                            }
                          >
                            <SelectTrigger className="h-7 w-[160px] text-xs">
                              <SelectValue placeholder="Insert token" />
                            </SelectTrigger>
                            <SelectContent>
                              {groupedTokens.map((grp) => (
                                <div key={grp.prefix}>
                                  <div className="px-2 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                                    {grp.label}
                                  </div>
                                  {grp.items.map((t) => (
                                    <SelectItem key={t.token} value={t.token}>
                                      {t.token}
                                    </SelectItem>
                                  ))}
                                </div>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : null}
                      </div>
                      <Textarea
                        value={step.emailTemplate.body}
                        onChange={(e) =>
                          updateStep(task.id, step.id, {
                            emailTemplate: { ...step.emailTemplate, body: e.target.value },
                          })
                        }
                        disabled={!canEdit}
                        rows={5}
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs">Data fields</Label>
                      {canEdit ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => addDataField(task.id, step.id)}
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Add field
                        </Button>
                      ) : null}
                    </div>
                    {step.dataFields.length === 0 ? (
                      <EmptyState message="No data fields yet" />
                    ) : (
                      <div className="space-y-2">
                        {step.dataFields.map((field, i) => (
                          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                            <Input
                              placeholder="Label"
                              value={field.label}
                              onChange={(e) =>
                                updateDataField(task.id, step.id, i, {
                                  label: e.target.value,
                                })
                              }
                              disabled={!canEdit}
                            />
                            <Select
                              value={field.token}
                              onValueChange={(v) =>
                                updateDataField(task.id, step.id, i, { token: v })
                              }
                              disabled={!canEdit}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {groupedTokens.map((grp) => (
                                  <div key={grp.prefix}>
                                    <div className="px-2 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                                      {grp.label}
                                    </div>
                                    {grp.items.map((t) => (
                                      <SelectItem key={t.token} value={t.token}>
                                        {t.token}
                                      </SelectItem>
                                    ))}
                                  </div>
                                ))}
                              </SelectContent>
                            </Select>
                            {canEdit ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => removeDataField(task.id, step.id, i)}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {canEdit ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeStep(task.id, step.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
