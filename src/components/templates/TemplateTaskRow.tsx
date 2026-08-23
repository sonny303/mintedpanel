// Editor card for a single template task, including its SOP steps and
// per-step data field rows. Drag state is owned by the parent so
// cross-task reordering keeps working exactly as before.
import { memo, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { FormStepPanel } from "@/components/templates/FormStepPanel";
import { TokenPicker } from "@/components/templates/TokenPicker";
import {
  actionNamePatch,
  AUTHORING_ACTION_MODES,
  authoringModeValue,
  executionTypeForActionMode,
  isCollapsedAction,
  newEditableRecipient,
  taskPortalKeys,
  type EditableRecipient,
} from "@/components/templates/editableTemplate";
import { emailTokenFromLiteral, filterEmailRecipientTokens } from "@/lib/sopAuthoringTokens";
import {
  EXECUTION_TYPE_HINTS,
  EXECUTION_TYPE_LABELS,
  INERT_EXECUTION_TYPES,
  authoringExecutionTypeOptions,
  type ExecutionType,
} from "@/lib/executionTypes";
import { isValidEmail } from "@/lib/contactValidation";
import { DOCUMENT_KIND_META, parseDocumentKind, requireableDocumentKinds } from "@/lib/documents";
import type { DocumentKind } from "@/types";
import { normalizePortalKey } from "@/lib/tokenFormat";
import type { Portal, SOPStepType } from "@/types";
import type { TokenGroup } from "@/lib/tokenGroups";

interface DataField {
  label: string;
  token: string;
}

interface EmailTemplate {
  subject: string;
  body: string;
  to: EditableRecipient[];
  cc: EditableRecipient[];
}

interface EditableStep {
  id: string;
  label: string;
  detail: string;
  stepType: SOPStepType;
  emailTemplate: EmailTemplate;
  dataFields: DataField[];
  portalKey: string;
  expectedTurnaroundDays: number | null;
  followUpEveryDays: number | null;
  requiredArtifacts: string[];
}

const NO_PORTAL = "__none__";

interface EditableTask {
  id: string;
  title: string;
  description: string;
  dueOffsetDays: number;
  // E4.2 TE-12 — per-task execution type (edited here since the Slice F
  // Tasks-&-steps merge folded the old Tasks step into this card).
  executionType: ExecutionType;
  steps: EditableStep[];
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
  /** Total task count — disables the last card's move-down arrow. */
  taskCount: number;
  canEdit: boolean;
  groupedTokens: TokenGroup[];
  // The org's portal registry + this template's selected payer, so an
  // online_form step can be linked to a real portal (payer-filtered by default).
  portals: Portal[];
  templatePayerId: string | null;
  /** E6.5 F6.5.6 — the template is a GLOBAL row: the step's form machinery
   * registers/trains against the global tier. Primitive (memo-safe). */
  isGlobalAuthoring: boolean;
  /** Slice F — the step a readiness deep-link (?intent=) landed on: that step's
   * form panel mounts EXPANDED. Stable string (memo-safe); null = none. */
  autoOpenStepId: string | null;
  dragTaskId: string | null;
  setDragTaskId: (v: string | null) => void;
  dragStep: DragStep | null;
  setDragStep: (v: DragStep | null) => void;
  reorderTasks: (fromId: string, toId: string) => void;
  // E4.2 PM round-4 — keyboard-operable task reorder alongside drag.
  moveTask: (index: number, delta: -1 | 1) => void;
  updateTask: (taskId: string, patch: Partial<EditableTask>) => void;
  removeTask: (taskId: string) => void;
  addStep: (taskId: string) => void;
  removeStep: (taskId: string, stepId: string) => void;
  updateStep: (taskId: string, stepId: string, patch: Partial<EditableStep>) => void;
  reorderSteps: (taskId: string, fromId: string, toId: string) => void;
  // E4.2 PM round-4 — accessible step reorder (move up/down, keyboard-operable).
  moveStep: (taskId: string, index: number, delta: -1 | 1) => void;
  addDataField: (taskId: string, stepId: string) => void;
  updateDataField: (taskId: string, stepId: string, idx: number, patch: Partial<DataField>) => void;
  removeDataField: (taskId: string, stepId: string, idx: number) => void;
}

// memo (measured hotfix, 2026-07-17): the wizard re-renders on every keystroke,
// and each task card is a forest of Radix selects — without the bailout, typing
// in ONE step's field re-rendered every card (measured 264–296ms p50 per
// keystroke on a 10-task template, prod build, 4x CPU throttle; ~30ms with the
// bailout). Requires every function prop to be referentially stable — the
// wizard passes useCallback handlers; keep it that way.
export const TemplateTaskRow = memo(function TemplateTaskRow({
  task,
  taskIdx,
  taskCount,
  canEdit,
  groupedTokens,
  portals,
  isGlobalAuthoring,
  templatePayerId,
  autoOpenStepId,
  dragTaskId,
  setDragTaskId,
  dragStep,
  setDragStep,
  reorderTasks,
  moveTask,
  updateTask,
  removeTask,
  addStep,
  removeStep,
  updateStep,
  reorderSteps,
  moveStep,
  addDataField,
  updateDataField,
  removeDataField,
}: TemplateTaskRowProps) {
  // BITE-SOP-TT-03 / D-SOP-1 A — ≤1 step collapses to one Action row (name +
  // Mode + mode config). Multi-step keeps the expanded step list.
  const collapsed = isCollapsedAction(task);
  const soleStep = task.steps.length === 1 ? task.steps[0] : null;
  const inertExecution = (INERT_EXECUTION_TYPES as readonly string[]).includes(task.executionType);
  // Portal Mode → Auto-fill toggle; multi-step / inert legacy keep the select.
  const showAutoFillToggle = collapsed && soleStep?.stepType === "online_form" && !inertExecution;
  const showExecutionSelect = !collapsed || inertExecution;

  function setPortalKey(stepId: string, portalKey: string) {
    updateStep(task.id, stepId, { portalKey });
    // Selecting a portal on the online_form path keeps/sets Auto-fill.
    if (portalKey.trim() !== "") {
      updateTask(task.id, { executionType: "extension_fill" });
    }
  }

  function setActionMode(stepId: string, stepType: SOPStepType) {
    updateStep(task.id, stepId, { stepType });
    // Collapsed Action: Mode owns Auto-fill vs Manual. Multi-step: only promote
    // to Auto-fill when an online_form step is chosen — never demote from a
    // sibling channel step while another portal step may still need Auto-fill.
    if (collapsed || stepType === "online_form") {
      updateTask(task.id, { executionType: executionTypeForActionMode(stepType) });
    }
  }

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
          <div className="mt-1 flex flex-col items-center gap-0.5">
            <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
            {/* E4.2 PM round-4 — keyboard-operable action reorder alongside drag. */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={taskIdx === 0}
              aria-label={`Move action ${taskIdx + 1} up`}
              onClick={() => moveTask(taskIdx, -1)}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={taskIdx === taskCount - 1}
              aria-label={`Move action ${taskIdx + 1} down`}
              onClick={() => moveTask(taskIdx, 1)}
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null}
        <div className="flex-1 grid grid-cols-[1fr_140px] gap-3">
          <div>
            <Label>Action {taskIdx + 1} name</Label>
            <Input
              value={task.title}
              onChange={(e) => updateTask(task.id, actionNamePatch(task, e.target.value))}
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
          {showAutoFillToggle ? (
            <div className="col-span-2">
              <label className="flex items-start gap-2">
                <Checkbox
                  className="mt-0.5"
                  checked={task.executionType === "extension_fill"}
                  disabled={!canEdit}
                  onCheckedChange={(checked) =>
                    updateTask(task.id, {
                      executionType: checked === true ? "extension_fill" : "manual",
                    })
                  }
                  aria-label="Auto-fill"
                />
                <span>
                  <span className="text-sm font-medium leading-none">Auto-fill</span>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {EXECUTION_TYPE_HINTS.extension_fill}
                  </p>
                </span>
              </label>
            </div>
          ) : null}
          {showExecutionSelect ? (
            <div>
              {/* E4.2 TE-12 — execution type (captured configuration; only
                  Auto-fill drives form setup + readiness today). */}
              <Label>Execution type</Label>
              <Select
                value={task.executionType}
                onValueChange={(v) => updateTask(task.id, { executionType: v as ExecutionType })}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {authoringExecutionTypeOptions(task.executionType).map((t) => (
                    <SelectItem key={t} value={t}>
                      {EXECUTION_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {EXECUTION_TYPE_HINTS[task.executionType]}
              </p>
            </div>
          ) : null}
          {/* Collapsed Action rows hide the always-on description — Mode +
              name carry the intent. Multi-step keeps notes visible. */}
          {!collapsed ? (
            <div className="col-span-2">
              <Label>Description</Label>
              <Textarea
                value={task.description}
                onChange={(e) => updateTask(task.id, { description: e.target.value })}
                disabled={!canEdit}
                rows={2}
              />
            </div>
          ) : null}
        </div>
        {canEdit ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => removeTask(task.id)}
            className="text-muted-foreground hover:text-destructive"
            aria-label={`Remove action ${taskIdx + 1}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <div className="p-4 space-y-3">
        {taskPortalKeys(task).length > 1 ? (
          <div className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] px-3 py-2 text-[11px] text-[#92400E]">
            This action links more than one portal ({taskPortalKeys(task).join(", ")}). An action
            can fill only one portal — pick one. Save is blocked until then.
          </div>
        ) : null}

        {collapsed && soleStep ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Mode</span>
              {canEdit ? (
                <Button size="sm" variant="outline" onClick={() => addStep(task.id)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add another step
                </Button>
              ) : null}
            </div>
            <div>
              <Label className="text-xs">Mode</Label>
              <Select
                value={authoringModeValue(soleStep.stepType)}
                onValueChange={(v) => setActionMode(soleStep.id, v as SOPStepType)}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUTHORING_ACTION_MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <StepModeBody
              step={soleStep}
              taskId={task.id}
              canEdit={canEdit}
              groupedTokens={groupedTokens}
              portals={portals}
              templatePayerId={templatePayerId}
              isGlobalAuthoring={isGlobalAuthoring}
              autoOpenStepId={autoOpenStepId}
              updateStep={updateStep}
              addDataField={addDataField}
              updateDataField={updateDataField}
              removeDataField={removeDataField}
              onPortalKeyChange={(portalKey) => setPortalKey(soleStep.id, portalKey)}
            />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Steps in this action
              </span>
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
                    <div className="mt-1 flex flex-col items-center gap-0.5">
                      <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={stepIdx === 0}
                        aria-label={`Move step ${stepIdx + 1} up`}
                        onClick={() => moveStep(task.id, stepIdx, -1)}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={stepIdx === task.steps.length - 1}
                        aria-label={`Move step ${stepIdx + 1} down`}
                        onClick={() => moveStep(task.id, stepIdx, 1)}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
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
                      <Label className="text-xs">Mode</Label>
                      <Select
                        value={authoringModeValue(step.stepType)}
                        onValueChange={(v) => setActionMode(step.id, v as SOPStepType)}
                        disabled={!canEdit}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {AUTHORING_ACTION_MODES.map((m) => (
                            <SelectItem key={m.value} value={m.value}>
                              {m.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <StepModeBody
                      step={step}
                      taskId={task.id}
                      canEdit={canEdit}
                      groupedTokens={groupedTokens}
                      portals={portals}
                      templatePayerId={templatePayerId}
                      isGlobalAuthoring={isGlobalAuthoring}
                      autoOpenStepId={autoOpenStepId}
                      updateStep={updateStep}
                      addDataField={addDataField}
                      updateDataField={updateDataField}
                      removeDataField={removeDataField}
                      onPortalKeyChange={(portalKey) => setPortalKey(step.id, portalKey)}
                    />
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
          </>
        )}
      </div>
    </div>
  );
});

/** Mode-specific step body (portal / email / data fields / cadence). Shared by
 * the collapsed Action row and the expanded multi-step list. */
function StepModeBody({
  step,
  taskId,
  canEdit,
  groupedTokens,
  portals,
  templatePayerId,
  isGlobalAuthoring,
  autoOpenStepId,
  updateStep,
  addDataField,
  updateDataField,
  removeDataField,
  onPortalKeyChange,
}: {
  step: EditableStep;
  taskId: string;
  canEdit: boolean;
  groupedTokens: TokenGroup[];
  portals: Portal[];
  templatePayerId: string | null;
  isGlobalAuthoring: boolean;
  autoOpenStepId: string | null;
  updateStep: TemplateTaskRowProps["updateStep"];
  addDataField: TemplateTaskRowProps["addDataField"];
  updateDataField: TemplateTaskRowProps["updateDataField"];
  removeDataField: TemplateTaskRowProps["removeDataField"];
  onPortalKeyChange: (portalKey: string) => void;
}) {
  // Portal registration lives in Form setup (E6.5) — Admin > Portals redirects
  // away. The picker CTA bumps this signal so FormStepPanel opens the dialog.
  const [registerSignal, setRegisterSignal] = useState(0);
  const selectedPortalKey = normalizePortalKey(step.portalKey);
  const selectedPortal = selectedPortalKey
    ? portals.find((p) => normalizePortalKey(p.portalKey) === selectedPortalKey)
    : undefined;
  // Orphan key only — an empty list while portals are still loading must not
  // force every Form setup panel open. Zero-portal authors use the amber
  // "Register portal" CTA, which bumps registerSignal.
  const needsPortalRegistration = Boolean(
    portals.length > 0 && selectedPortalKey && !selectedPortal,
  );

  return (
    <>
      {step.stepType === "draft_email" ? (
        <div className="space-y-2 rounded-md border border-[#FDE68A] bg-[#FEF3C7] p-3">
          <p className="text-[11px] text-[#92400E]">
            Tokens like {"{{provider.firstName}}"} resolve when the task is created. The product
            drafts the email for review — it never sends.
          </p>
          <RecipientListEditor
            label="To"
            required
            recipients={step.emailTemplate.to}
            groupedTokens={groupedTokens}
            canEdit={canEdit}
            onChange={(to) =>
              updateStep(taskId, step.id, {
                emailTemplate: { ...step.emailTemplate, to },
              })
            }
          />
          <RecipientListEditor
            label="Cc"
            recipients={step.emailTemplate.cc}
            groupedTokens={groupedTokens}
            canEdit={canEdit}
            onChange={(cc) =>
              updateStep(taskId, step.id, {
                emailTemplate: { ...step.emailTemplate, cc },
              })
            }
          />
          <div>
            <Label className="text-xs">Subject</Label>
            <Input
              value={step.emailTemplate.subject}
              onChange={(e) =>
                updateStep(taskId, step.id, {
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
                <TokenPicker
                  aria-label="Insert token into the email body"
                  value=""
                  clearOnSelect
                  placeholder="Insert token"
                  groupedTokens={groupedTokens}
                  className="w-[160px]"
                  onValueChange={(token) =>
                    updateStep(taskId, step.id, {
                      emailTemplate: {
                        ...step.emailTemplate,
                        body: appendToken(step.emailTemplate.body, token),
                      },
                    })
                  }
                />
              ) : null}
            </div>
            <Textarea
              value={step.emailTemplate.body}
              onChange={(e) =>
                updateStep(taskId, step.id, {
                  emailTemplate: { ...step.emailTemplate, body: e.target.value },
                })
              }
              disabled={!canEdit}
              rows={5}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {step.stepType === "online_form" ? (
            <>
              <PortalStepSelect
                step={step}
                portals={portals}
                templatePayerId={templatePayerId}
                canEdit={canEdit}
                onChange={onPortalKeyChange}
                onRequestRegister={canEdit ? () => setRegisterSignal((n) => n + 1) : undefined}
              />
              {/* E6.5 F6.5.2 — register/train/prove without leaving the
                  editor. Self-contained (own cached hooks); renders
                  collapsed so Step 3 typing never pays for it. Auto-opens
                  when nothing is registered yet so Register portal is visible. */}
              <FormStepPanel
                portalKey={selectedPortalKey}
                templatePayerId={templatePayerId}
                canEdit={canEdit}
                isGlobalAuthoring={isGlobalAuthoring}
                defaultOpen={autoOpenStepId === step.id || needsPortalRegistration}
                openRegisterSignal={registerSignal}
                onPortalKeyChange={onPortalKeyChange}
              />
            </>
          ) : null}
          {/* E6.9 F6.9.6: on online-form steps the registry in Form
              setup IS the field list — a field used to be mapped
              twice, with two labels and two pickers over the same
              catalog. Fax/phone/mail steps (the other users of this
              branch) keep Data fields exactly as before; draft_email
              never had them. The stored `dataFields` JSON is retained
              on every step (additive-only rule) — it simply stops
              being read for online-form steps, so an unmigrated or
              rolled-back reader still finds what it expects. */}
          <div className={step.stepType === "online_form" ? "hidden" : undefined}>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs">Data fields</Label>
              {canEdit ? (
                <Button size="sm" variant="ghost" onClick={() => addDataField(taskId, step.id)}>
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
                        updateDataField(taskId, step.id, i, {
                          label: e.target.value,
                        })
                      }
                      disabled={!canEdit}
                    />
                    <TokenPicker
                      aria-label={`Token for data field ${field.label || i + 1}`}
                      value={field.token}
                      groupedTokens={groupedTokens}
                      disabled={!canEdit}
                      className="h-9 w-full"
                      onValueChange={(v) => updateDataField(taskId, step.id, i, { token: v })}
                    />
                    {canEdit ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeDataField(taskId, step.id, i)}
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
        </div>
      )}

      <StepCadenceFields
        step={step}
        canEdit={canEdit}
        onChange={(patch) => updateStep(taskId, step.id, patch)}
      />
    </>
  );
}

// E1.7b F1.7b.5 (TE-15) — the To/CC recipient editor for a draft-email step.
// Every row has an explicit "Recipient source" selector (Email address | Profile
// token) and, for that source, either a validated literal-address input or a
// searchable token picker narrowed to the catalog's email columns (never the
// full authoring catalog). No recipient is inferred from prose; BCC is not
// offered.
function RecipientListEditor({
  label,
  recipients,
  groupedTokens,
  canEdit,
  onChange,
  required = false,
}: {
  label: string;
  recipients: EditableRecipient[];
  groupedTokens: TokenGroup[];
  canEdit: boolean;
  onChange: (next: EditableRecipient[]) => void;
  required?: boolean;
}) {
  const emailTokenGroups = useMemo(
    () =>
      groupedTokens
        .map((group) => ({ ...group, items: filterEmailRecipientTokens(group.items) }))
        .filter((group) => group.items.length > 0),
    [groupedTokens],
  );

  function update(id: string, patch: Partial<EditableRecipient>) {
    onChange(recipients.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  // An address box holding exactly one email token is the author naming a token
  // recipient by hand: retag the row rather than reject it as a bad address.
  function updateAddress(id: string, address: string) {
    const token = emailTokenFromLiteral(address);
    update(id, token ? { source: "token", token, address: "" } : { address });
  }
  function remove(id: string) {
    onChange(recipients.filter((r) => r.id !== id));
  }
  function add() {
    onChange([...recipients, newEditableRecipient()]);
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <Label className="text-xs">
          {label}
          {required ? <span className="text-[#B91C1C]"> *</span> : null}
        </Label>
        {canEdit ? (
          <Button size="sm" variant="ghost" onClick={add}>
            <Plus className="h-4 w-4 mr-1" />
            Add {label.toLowerCase()}
          </Button>
        ) : null}
      </div>
      {recipients.length === 0 ? (
        <p className="text-[11px] text-[#92400E]">
          {required
            ? "Add at least one recipient — a fixed email address or an email token."
            : "No Cc recipients."}
        </p>
      ) : (
        <div className="space-y-2">
          {recipients.map((r) => {
            const literalInvalid =
              r.source === "literal" && r.address.trim() !== "" && !isValidEmail(r.address);
            return (
              <div key={r.id} className="grid grid-cols-[130px_1fr_auto] gap-2 items-start">
                <Select
                  value={r.source}
                  onValueChange={(v) => update(r.id, { source: v as EditableRecipient["source"] })}
                  disabled={!canEdit}
                >
                  <SelectTrigger aria-label={`${label} recipient source`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="literal">Email address</SelectItem>
                    <SelectItem value="token">Profile token</SelectItem>
                  </SelectContent>
                </Select>
                <div>
                  {r.source === "literal" ? (
                    <Input
                      placeholder="name@example.com or {{group.credentialingEmail}}"
                      value={r.address}
                      onChange={(e) => updateAddress(r.id, e.target.value)}
                      disabled={!canEdit}
                      aria-label={`${label} email address`}
                      aria-invalid={literalInvalid || undefined}
                    />
                  ) : (
                    <TokenPicker
                      aria-label={`${label} recipient token`}
                      value={r.token}
                      groupedTokens={emailTokenGroups}
                      disabled={!canEdit}
                      className="h-9 w-full"
                      onValueChange={(v) => update(r.id, { token: v })}
                    />
                  )}
                  {literalInvalid ? (
                    <p className="mt-0.5 text-[11px] text-[#B91C1C]">
                      Enter a valid email address, or an email token like{" "}
                      {"{{group.credentialingEmail}}"}.
                    </p>
                  ) : null}
                </div>
                {canEdit ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => remove(r.id)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${label} recipient`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// The documents a step's submission must SEND to the payer. A GOVERNED
// picker, not free text: the case side joins these to the provider/group
// vault through `parseDocumentKind`, so a hand-typed name that resolves to
// nothing never links and never fills — silently. That was not theoretical
// ("License" was authored on live SOPs and resolved to nothing while
// "state_license" worked). The picker can only emit canonical machine keys.
// Entries authored before it stay visible and editable and are NEVER
// rewritten — renaming someone's SOP text is the admin's call, not a
// migration's — but they are flagged so the gap is visible.
const REQUIREABLE_DOCUMENT_KINDS = requireableDocumentKinds();

// E1.7b step-shape extension editor: expected payer turnaround, follow-up
// cadence (both optional day counts), and the required-documents list.
function StepCadenceFields({
  step,
  canEdit,
  onChange,
}: {
  step: EditableStep;
  canEdit: boolean;
  onChange: (patch: Partial<EditableStep>) => void;
}) {
  function parseDays(raw: string): number | null {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  // A kind already on the step is not offered again — the checklist is a set,
  // and a duplicate would render two rows sharing one key for one document.
  const taken = new Set(
    step.requiredArtifacts
      .map((a) => parseDocumentKind(a))
      .filter((k): k is DocumentKind => k !== null),
  );
  const available = REQUIREABLE_DOCUMENT_KINDS.filter((k) => !taken.has(k));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={`step-${step.id}-turnaround`} className="text-xs">
            Expected turnaround (days)
          </Label>
          <Input
            id={`step-${step.id}-turnaround`}
            type="number"
            min={1}
            value={step.expectedTurnaroundDays ?? ""}
            onChange={(e) => onChange({ expectedTurnaroundDays: parseDays(e.target.value) })}
            disabled={!canEdit}
          />
        </div>
        <div>
          <Label htmlFor={`step-${step.id}-follow-up`} className="text-xs">
            Follow up every (days)
          </Label>
          <Input
            id={`step-${step.id}-follow-up`}
            type="number"
            min={1}
            value={step.followUpEveryDays ?? ""}
            onChange={(e) => onChange({ followUpEveryDays: parseDays(e.target.value) })}
            disabled={!canEdit}
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">Required documents</Label>
          {canEdit && available.length > 0 ? (
            <Select
              value=""
              onValueChange={(kind) =>
                onChange({ requiredArtifacts: [...step.requiredArtifacts, kind] })
              }
            >
              <SelectTrigger className="h-8 w-[200px] text-xs">
                <SelectValue placeholder="Add document…" />
              </SelectTrigger>
              <SelectContent>
                {available.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {DOCUMENT_KIND_META[kind].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
        {step.requiredArtifacts.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Pick the documents this submission must send with it (a state licence, a W-9). The case
            shows whether each one is on file and lets the specialist download it. Reference shared
            logins by name only — never record a password in an SOP step.
          </p>
        ) : (
          <div className="space-y-2">
            {step.requiredArtifacts.map((artifact, i) => {
              const kind = parseDocumentKind(artifact);
              const label = kind ? DOCUMENT_KIND_META[kind].label : artifact;
              return (
                <div key={i} className="space-y-1">
                  <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                    {kind ? (
                      <span className="rounded-md border border-[#E8E5E0] bg-muted/40 px-2 py-1.5 text-[13px]">
                        {label}
                      </span>
                    ) : (
                      <Input
                        placeholder="Document name"
                        value={artifact}
                        aria-label={`Unlinked document entry ${i + 1}`}
                        onChange={(e) =>
                          onChange({
                            requiredArtifacts: step.requiredArtifacts.map((a, j) =>
                              j === i ? e.target.value : a,
                            ),
                          })
                        }
                        disabled={!canEdit}
                      />
                    )}
                    {canEdit ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove ${label || "document"}`}
                        onClick={() =>
                          onChange({
                            requiredArtifacts: step.requiredArtifacts.filter((_, j) => j !== i),
                          })
                        }
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                  {kind ? null : (
                    <p className="text-[11px] text-[#92400E]">
                      Not a known document — this shows on the case as a note only. Pick it from Add
                      document above to link it to the vault.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Portal picker for an online_form step. Options default to portals registered
// against this template's payer (a portal_key links the step to a real portal so
// the extension can close this task on submit); "Show all portals" reveals the
// rest. Never required — an unlinked step still works, it just won't drive the
// extension's task close-out.
function PortalStepSelect({
  step,
  portals,
  templatePayerId,
  canEdit,
  onChange,
  onRequestRegister,
}: {
  step: EditableStep;
  portals: Portal[];
  templatePayerId: string | null;
  canEdit: boolean;
  onChange: (portalKey: string) => void;
  /** Opens Form setup's Register portal dialog — the live registration path
   * after Admin > Portals became a redirect shell. */
  onRequestRegister?: () => void;
}) {
  const [showAll, setShowAll] = useState(false);

  const matching = templatePayerId ? portals.filter((p) => p.payerId === templatePayerId) : [];
  // Fall back to the full list when the payer has no portals (or the template
  // has no payer) — otherwise the user would see an empty picker.
  const useAll = showAll || !templatePayerId || matching.length === 0;
  const base = useAll ? portals : matching;

  const selectedKey = normalizePortalKey(step.portalKey);
  const selected = selectedKey
    ? portals.find((p) => normalizePortalKey(p.portalKey) === selectedKey)
    : undefined;
  // Keep the currently-selected portal visible even when the payer filter would
  // otherwise hide it, so the Select value always resolves to an option.
  const options = selected && !base.some((p) => p.id === selected.id) ? [...base, selected] : base;
  const value = selected ? selected.portalKey : NO_PORTAL;

  const canToggle =
    Boolean(templatePayerId) && matching.length > 0 && portals.length > matching.length;

  const registerCta = onRequestRegister ? (
    <button
      type="button"
      onClick={onRequestRegister}
      className="font-medium underline underline-offset-2 hover:opacity-80"
    >
      Register portal
    </button>
  ) : (
    <span className="font-medium">Form setup</span>
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Portal</Label>
        {canToggle ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[11px] text-[#1B4D3E] hover:underline"
          >
            {useAll ? "Show payer portals" : "Show all portals"}
          </button>
        ) : null}
      </div>

      {portals.length === 0 ? (
        <div className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] px-3 py-2 text-[11px] text-[#92400E]">
          No portal registered{templatePayerId ? " for this payer" : ""}.{" "}
          {onRequestRegister ? (
            <>{registerCta} in Form setup below.</>
          ) : (
            <>Open Form setup below to register one.</>
          )}
        </div>
      ) : (
        <>
          <Select
            value={value}
            onValueChange={(v) => onChange(v === NO_PORTAL ? "" : v)}
            disabled={!canEdit}
          >
            <SelectTrigger>
              <SelectValue placeholder="No portal (not linked)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PORTAL}>No portal (not linked)</SelectItem>
              {options.map((p) => (
                <SelectItem key={p.id} value={p.portalKey}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {!selectedKey ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#92400E]">
              <span>This step won&apos;t be linked for extension fill.</span>
              {onRequestRegister ? <>{registerCta} to link one.</> : null}
            </div>
          ) : !selected ? (
            <div className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] px-3 py-2 text-[11px] text-[#92400E]">
              Saved portal key <code>{selectedKey}</code> isn&apos;t in your registry — pick one
              above or {registerCta}.
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
