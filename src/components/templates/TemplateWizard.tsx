// Four-step wizard for authoring an SOP template (Admin > Templates). Replaces
// the old single-page editor. Writes sop_templates.task_definitions jsonb via
// the templates service in ONE write on the final step. The jsonb shape is
// unchanged (owned by src/lib/sopResolver.ts): tasks -> steps -> data fields
// with bare tokens; case creation reads it untouched.
import { useEffect, useMemo, useState } from "react";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { Archive, ArchiveRestore, ChevronLeft, ChevronRight, Copy, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
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
import { GripVertical, Trash2 } from "lucide-react";
import { TemplateTaskRow } from "@/components/templates/TemplateTaskRow";
import { useDiscardConfirm } from "@/components/templates/DiscardConfirmDialog";
import {
  fromEditable,
  portalKeyConflicts,
  randId,
  toEditable,
  type EditableTask,
} from "@/components/templates/editableTemplate";
import { useCreateSop, usePayers, useUpdateSop } from "@/hooks/useAdmin";
import { useProviderGroups } from "@/hooks/useLookups";
import { useTokenCatalog } from "@/hooks/useMappingReview";
import { usePortals } from "@/hooks/usePortals";
import { useIsAdmin } from "@/lib/permissions";
import { normalizePortalKey } from "@/lib/tokenFormat";
import { cn } from "@/lib/utils";
import type { Portal, SOPTaskDefinition, SOPTemplate } from "@/types";

interface SopFieldToken {
  token: string;
  table: string;
  column: string;
}

const TOKEN_GROUP_LABELS: Record<string, string> = {
  provider: "Provider",
  group: "Group",
  facility: "Facility",
  payer: "Payer",
  mso: "MSO",
  contract: "Contract",
  license: "License",
  assignment: "Assignment",
  groupInsurance: "Group Insurance",
  user: "User",
};

const TOKEN_GROUP_ORDER = [
  "provider",
  "group",
  "facility",
  "payer",
  "mso",
  "contract",
  "license",
  "assignment",
  "groupInsurance",
  "user",
];

const US_STATES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
];

const STEPS = [
  { n: 1, label: "Basics" },
  { n: 2, label: "Tasks" },
  { n: 3, label: "Steps & fields" },
  { n: 4, label: "Review" },
] as const;

interface TemplateWizardProps {
  // null = create mode; a template = edit mode (pre-filled).
  initial: SOPTemplate | null;
}

export function TemplateWizard({ initial }: TemplateWizardProps) {
  const navigate = useNavigate();
  const isEdit = initial !== null;
  const canEdit = useIsAdmin();

  const payersQ = usePayers();
  const groupsQ = useProviderGroups();
  const tokensQ = useTokenCatalog();
  const portalsQ = usePortals();
  const createMut = useCreateSop();
  const updateMut = useUpdateSop(initial?.id ?? "");

  const portals = useMemo<Portal[]>(() => portalsQ.data ?? [], [portalsQ.data]);

  const tokens = useMemo(() => (tokensQ.data ?? []) as SopFieldToken[], [tokensQ.data]);
  const groupedTokens = useMemo(() => {
    const map = new Map<string, SopFieldToken[]>();
    for (const t of tokens) {
      const prefix = t.token.split(".")[0];
      const arr = map.get(prefix) ?? [];
      arr.push(t);
      map.set(prefix, arr);
    }
    // Known prefixes first (in order), then any unexpected prefixes so no live
    // token is ever hidden from the picker.
    const known = TOKEN_GROUP_ORDER.filter((p) => map.has(p));
    const extra = [...map.keys()].filter((p) => !TOKEN_GROUP_ORDER.includes(p)).sort();
    return [...known, ...extra].map((p) => ({
      prefix: p,
      label: TOKEN_GROUP_LABELS[p] ?? p,
      items: map.get(p) ?? [],
    }));
  }, [tokens]);
  const firstToken = tokens[0]?.token ?? "provider.firstName";

  const [step, setStep] = useState(1);
  const [name, setName] = useState(initial?.name ?? "");
  const [payerId, setPayerId] = useState<string>(initial?.payerId ?? "none");
  const [state, setState] = useState<string>(initial?.state ?? "none");
  const [specialty, setSpecialty] = useState<string>(initial?.specialty ?? "");
  const [groupId, setGroupId] = useState<string>(initial?.groupId ?? "none");
  const [tasks, setTasks] = useState<EditableTask[]>(() => toEditable(initial?.taskDefinitions));
  const [isArchived, setIsArchived] = useState(
    Boolean(initial?.archived ?? initial?.isArchived ?? false),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragStep, setDragStep] = useState<{ taskId: string; stepId: string } | null>(null);

  const { ask: askDiscard, dialog: discardDialog } = useDiscardConfirm();

  useBlocker({
    shouldBlockFn: async () => {
      if (!dirty || saving) return false;
      const ok = await askDiscard();
      return !ok;
    },
  });

  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  function markDirty() {
    setDirty(true);
  }

  // --- task-level edits (Step 2 + used by Step 3 via TemplateTaskRow) ---
  function addTask() {
    setTasks((prev) => [
      ...prev,
      {
        id: randId(),
        title: "New task",
        description: "",
        dueOffsetDays: prev.length * 7,
        steps: [],
      },
    ]);
    markDirty();
  }
  function removeTask(taskId: string) {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    markDirty();
  }
  function updateTask(taskId: string, patch: Partial<EditableTask>) {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t)));
    markDirty();
  }
  function reorderTasks(fromId: string, toId: string) {
    if (fromId === toId) return;
    setTasks((prev) => {
      const next = [...prev];
      const fromIdx = next.findIndex((t) => t.id === fromId);
      const toIdx = next.findIndex((t) => t.id === toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
    markDirty();
  }

  // --- step-level edits (Step 3) ---
  function addStep(taskId: string) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              steps: [
                ...t.steps,
                {
                  id: randId(),
                  label: "New step",
                  detail: "",
                  stepType: "online_form",
                  emailTemplate: { subject: "", body: "" },
                  dataFields: [],
                  portalKey: "",
                },
              ],
            }
          : t,
      ),
    );
    markDirty();
  }
  function removeStep(taskId: string, stepId: string) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, steps: t.steps.filter((s) => s.id !== stepId) } : t,
      ),
    );
    markDirty();
  }
  function updateStep(
    taskId: string,
    stepId: string,
    patch: Partial<EditableTask["steps"][number]>,
  ) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, steps: t.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) }
          : t,
      ),
    );
    markDirty();
  }
  function reorderSteps(taskId: string, fromId: string, toId: string) {
    if (fromId === toId) return;
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        const next = [...t.steps];
        const fi = next.findIndex((s) => s.id === fromId);
        const ti = next.findIndex((s) => s.id === toId);
        if (fi < 0 || ti < 0) return t;
        const [moved] = next.splice(fi, 1);
        next.splice(ti, 0, moved);
        return { ...t, steps: next };
      }),
    );
    markDirty();
  }

  // --- data-field edits (Step 3) ---
  function addDataField(taskId: string, stepId: string) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              steps: t.steps.map((s) =>
                s.id === stepId
                  ? { ...s, dataFields: [...s.dataFields, { label: "", token: firstToken }] }
                  : s,
              ),
            }
          : t,
      ),
    );
    markDirty();
  }
  function updateDataField(
    taskId: string,
    stepId: string,
    idx: number,
    patch: Partial<{ label: string; token: string }>,
  ) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              steps: t.steps.map((s) =>
                s.id === stepId
                  ? {
                      ...s,
                      dataFields: s.dataFields.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
                    }
                  : s,
              ),
            }
          : t,
      ),
    );
    markDirty();
  }
  function removeDataField(taskId: string, stepId: string, idx: number) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              steps: t.steps.map((s) =>
                s.id === stepId
                  ? { ...s, dataFields: s.dataFields.filter((_, i) => i !== idx) }
                  : s,
              ),
            }
          : t,
      ),
    );
    markDirty();
  }

  const payload = useMemo(
    () => ({
      name: name.trim(),
      payerId: payerId === "none" ? null : payerId,
      state: state === "none" ? null : state,
      specialty: specialty.trim() || null,
      groupId: groupId === "none" ? null : groupId,
      taskDefinitions: fromEditable(tasks),
      archived: isArchived,
    }),
    [name, payerId, state, specialty, groupId, tasks, isArchived],
  );

  const previewTasks: SOPTaskDefinition[] = useMemo(() => fromEditable(tasks), [tasks]);

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Template name is required");
      setStep(1);
      return;
    }
    // One portal per task: the extension closes exactly one task per portal
    // submission, so two steps in a task pointing at different portals would
    // make the close-out target ambiguous.
    const conflicts = portalKeyConflicts(tasks);
    if (conflicts.length > 0) {
      const c = conflicts[0];
      toast.error(
        `"${c.title.trim() || `Task ${c.taskIdx + 1}`}" links more than one portal (${c.keys.join(", ")}). A task can fill only one portal — pick one.`,
      );
      setStep(3);
      return;
    }
    setSaving(true);
    try {
      if (isEdit && initial) {
        await updateMut.mutateAsync(payload);
        setDirty(false);
        toast.success("Template saved");
        navigate({ to: "/admin/templates" });
      } else {
        const created = await createMut.mutateAsync(payload);
        setDirty(false);
        toast.success("Template created");
        navigate({ to: "/admin/templates/$id", params: { id: created.id } });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate() {
    if (!initial) return;
    try {
      const created = await createMut.mutateAsync({
        ...payload,
        name: `${name} (copy)`,
        archived: false,
      });
      toast.success("Template duplicated");
      setDirty(false);
      navigate({ to: "/admin/templates/$id", params: { id: created.id } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Duplicate failed";
      toast.error(msg);
    }
  }

  async function handleToggleArchive() {
    if (!initial) return;
    const next = !isArchived;
    setIsArchived(next);
    try {
      await updateMut.mutateAsync({ archived: next });
      toast.success(next ? "Template archived" : "Template restored");
    } catch (err) {
      setIsArchived(!next);
      const msg = err instanceof Error ? err.message : "Update failed";
      toast.error(msg);
    }
  }

  const canGoBack = step > 1;
  const canGoNext = step < 4;

  return (
    <div className="p-6">
      <PageHeader
        title={isEdit ? name || "Untitled template" : "New template"}
        description={
          isEdit && isArchived ? "Archived. Hidden from case-creation matching." : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate({ to: "/admin/templates" })}>
              Cancel
            </Button>
            {isEdit && canEdit ? (
              <>
                <Button variant="outline" onClick={handleDuplicate}>
                  <Copy className="h-4 w-4 mr-2" />
                  Duplicate
                </Button>
                <Button variant="outline" onClick={handleToggleArchive}>
                  {isArchived ? (
                    <>
                      <ArchiveRestore className="h-4 w-4 mr-2" />
                      Restore
                    </>
                  ) : (
                    <>
                      <Archive className="h-4 w-4 mr-2" />
                      Archive
                    </>
                  )}
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      {!canEdit ? (
        <div className="mb-4 rounded-md border border-[#E8E5E0] bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          Read-only view. Only admins can create or edit templates.
        </div>
      ) : null}

      {/* Stepper */}
      <nav className="mb-6 flex items-center gap-2 text-sm">
        {STEPS.map((s, i) => (
          <div key={s.n} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep(s.n)}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-1.5 transition-colors",
                step === s.n
                  ? "bg-[#1B4D3E] text-white"
                  : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full border text-xs",
                  step === s.n ? "border-white/60" : "border-[#E8E5E0]",
                )}
              >
                {s.n}
              </span>
              {s.label}
            </button>
            {i < STEPS.length - 1 ? <span className="text-muted-foreground/40">/</span> : null}
          </div>
        ))}
      </nav>

      {/* Step body */}
      {step === 1 ? (
        <section className="rounded-md border border-[#E8E5E0] bg-[#FDFDFC] p-4 max-w-2xl">
          <h2 className="text-sm font-semibold mb-3">Match key</h2>
          <p className="text-xs text-muted-foreground mb-4">
            A case picks this template when its payer, state, specialty, and group match. Leave a
            field on "Any" to match broadly.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Template name</Label>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  markDirty();
                }}
                disabled={!canEdit}
              />
            </div>
            <div>
              <Label>Payer</Label>
              <Select
                value={payerId}
                onValueChange={(v) => {
                  setPayerId(v);
                  markDirty();
                }}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any payer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Any payer</SelectItem>
                  {(payersQ.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>State</Label>
              <Select
                value={state}
                onValueChange={(v) => {
                  setState(v);
                  markDirty();
                }}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any state" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Any state</SelectItem>
                  {US_STATES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Specialty</Label>
              <Input
                value={specialty}
                onChange={(e) => {
                  setSpecialty(e.target.value);
                  markDirty();
                }}
                placeholder="e.g. Physical Therapy"
                disabled={!canEdit}
              />
            </div>
            <div>
              <Label>Group</Label>
              <Select
                value={groupId}
                onValueChange={(v) => {
                  setGroupId(v);
                  markDirty();
                }}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Any group</SelectItem>
                  {(groupsQ.data ?? []).map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-3 max-w-3xl">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Tasks</h2>
              <p className="text-xs text-muted-foreground">
                Drag to reorder — order sets each task's sort order. Add steps in the next step.
              </p>
            </div>
            {canEdit ? (
              <Button size="sm" variant="outline" onClick={addTask}>
                <Plus className="h-4 w-4 mr-2" />
                Add task
              </Button>
            ) : null}
          </div>

          {tasks.length === 0 ? (
            <div className="rounded-md border border-dashed border-[#E8E5E0] p-6">
              <EmptyState
                message="No tasks yet"
                description="Add a task to start building this template"
              />
            </div>
          ) : null}

          {tasks.map((task, idx) => (
            <div
              key={task.id}
              draggable={canEdit}
              onDragStart={() => setDragTaskId(task.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragTaskId) reorderTasks(dragTaskId, task.id);
                setDragTaskId(null);
              }}
              className="rounded-md border border-[#E8E5E0] bg-[#FDFDFC] p-4"
            >
              <div className="flex items-start gap-2">
                {canEdit ? (
                  <GripVertical className="h-4 w-4 text-muted-foreground mt-2 cursor-grab" />
                ) : null}
                <div className="flex-1 grid grid-cols-[1fr_140px] gap-3">
                  <div>
                    <Label>Task {idx + 1} title</Label>
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
                      rows={2}
                      disabled={!canEdit}
                    />
                  </div>
                  <p className="col-span-2 text-xs text-muted-foreground">
                    {task.steps.length} step{task.steps.length === 1 ? "" : "s"}
                  </p>
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
            </div>
          ))}
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Steps &amp; fields</h2>
            <p className="text-xs text-muted-foreground">
              Add ordered steps to each task. Each step can carry data fields mapped to a live
              token, or be a draft-email step.
            </p>
          </div>
          {tasks.length === 0 ? (
            <div className="rounded-md border border-dashed border-[#E8E5E0] p-6">
              <EmptyState
                message="No tasks to detail"
                description="Go back to Tasks and add at least one task."
              />
            </div>
          ) : (
            tasks.map((task, taskIdx) => (
              <TemplateTaskRow
                key={task.id}
                task={task}
                taskIdx={taskIdx}
                canEdit={canEdit}
                groupedTokens={groupedTokens}
                portals={portals}
                templatePayerId={payerId === "none" ? null : payerId}
                dragTaskId={dragTaskId}
                setDragTaskId={setDragTaskId}
                dragStep={dragStep}
                setDragStep={setDragStep}
                reorderTasks={reorderTasks}
                updateTask={updateTask}
                removeTask={removeTask}
                addStep={addStep}
                removeStep={removeStep}
                updateStep={updateStep}
                reorderSteps={reorderSteps}
                addDataField={addDataField}
                updateDataField={updateDataField}
                removeDataField={removeDataField}
              />
            ))
          )}
        </section>
      ) : null}

      {step === 4 ? (
        <section className="space-y-4 max-w-3xl">
          <div>
            <h2 className="text-sm font-semibold">Review</h2>
            <p className="text-xs text-muted-foreground">
              This is how the template generates tasks. Tokens render as chips and resolve to real
              values when a case is created.
            </p>
          </div>

          <dl className="rounded-md border border-[#E8E5E0] bg-[#FDFDFC] p-4 grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{name.trim() || "—"}</dd>
            <dt className="text-muted-foreground">Payer</dt>
            <dd>
              {payerId === "none"
                ? "Any"
                : ((payersQ.data ?? []).find((p) => p.id === payerId)?.name ?? "—")}
            </dd>
            <dt className="text-muted-foreground">State</dt>
            <dd>{state === "none" ? "Any" : state}</dd>
            <dt className="text-muted-foreground">Specialty</dt>
            <dd>{specialty.trim() || "Any"}</dd>
            <dt className="text-muted-foreground">Group</dt>
            <dd>
              {groupId === "none"
                ? "Any"
                : ((groupsQ.data ?? []).find((g) => g.id === groupId)?.name ?? "—")}
            </dd>
          </dl>

          {previewTasks.length === 0 ? (
            <div className="rounded-md border border-dashed border-[#E8E5E0] p-6">
              <EmptyState
                message="No tasks defined"
                description="This template will generate no tasks."
              />
            </div>
          ) : (
            <div className="space-y-3">
              {previewTasks.map((t, i) => (
                <div key={i} className="rounded-md border border-[#E8E5E0] bg-[#FDFDFC] p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">{t.title || "Untitled task"}</p>
                    <span className="text-xs text-muted-foreground">
                      Day +{t.dueOffsetDays ?? 0}
                    </span>
                  </div>
                  {t.description ? (
                    <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                  ) : null}
                  <ol className="space-y-2 mt-3">
                    {(t.steps ?? []).map((s, j) => {
                      const fields =
                        (s as { dataFields?: { label: string; token: string }[] }).dataFields ?? [];
                      const stepType = s.stepType ?? "online_form";
                      const portalKey = normalizePortalKey(s.portalKey);
                      const portal = portalKey
                        ? portals.find((p) => normalizePortalKey(p.portalKey) === portalKey)
                        : null;
                      return (
                        <li key={j} className="rounded-md border border-[#E8E5E0] p-2 text-xs">
                          <p className="text-foreground">{s.label || `Step ${j + 1}`}</p>
                          {stepType === "online_form" ? (
                            portal ? (
                              <span className="mt-1 inline-flex items-center rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-2 py-0.5 text-[11px] text-[#059669]">
                                Portal: {portal.name}
                              </span>
                            ) : (
                              <span className="mt-1 inline-flex items-center rounded-full border border-[#FDE68A] bg-[#FEF3C7] px-2 py-0.5 text-[11px] text-[#92400E]">
                                Not linked for fill
                              </span>
                            )
                          ) : null}
                          {s.detail ? (
                            <p className="text-muted-foreground mt-0.5">{s.detail}</p>
                          ) : null}
                          {fields.length > 0 ? (
                            <div className="mt-2 space-y-1">
                              {fields.map((f, k) => (
                                <div key={k} className="flex items-center justify-between gap-2">
                                  <span className="text-muted-foreground">
                                    {f.label || f.token}
                                  </span>
                                  <span className="inline-flex items-center rounded-full border border-[#E8E5E0] bg-muted/40 px-2 py-0.5 font-mono text-[11px]">
                                    {`{{${f.token}}}`}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* Footer nav */}
      <div className="mt-6 flex items-center justify-between border-t border-[#E8E5E0] pt-4">
        <Button
          variant="outline"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={!canGoBack}
        >
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        {canGoNext ? (
          <Button
            onClick={() => setStep((s) => Math.min(4, s + 1))}
            style={{ backgroundColor: "#1B4D3E" }}
            className="text-white hover:opacity-90"
          >
            Next
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        ) : canEdit ? (
          <Button
            onClick={handleSave}
            disabled={saving}
            style={{ backgroundColor: "#1B4D3E" }}
            className="text-white hover:opacity-90"
          >
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Saving…" : isEdit ? "Save template" : "Create template"}
          </Button>
        ) : (
          <span />
        )}
      </div>

      {discardDialog}
    </div>
  );
}
