// Four-step wizard for authoring an SOP template (Admin > Templates). Replaces
// the old single-page editor. The jsonb shape is unchanged (owned by
// src/lib/sopResolver.ts): tasks -> steps -> data fields with bare tokens;
// case creation reads it untouched.
//
// E1.7b Model A save split (TE-5): CONTENT (name + task definitions) saves
// through Publish — the publish_sop_template_version RPC inserts an immutable
// version row, updates the head, and bumps current_version (optimistic
// concurrency; a losing publish gets a friendly conflict toast). MATCH-KEY
// edits (payer/state/specialty/group) are head-level identity edits and go
// through the plain audited update — no version bump. Global templates
// (org_id NULL, incl. the seeded fallback) render read-only for org users.
import { useEffect, useMemo, useState } from "react";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Copy,
  History,
  Plus,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { TemplatePreviewTasks } from "@/components/templates/TemplatePreviewTasks";
import { TemplateVersionHistoryDialog } from "@/components/templates/TemplateVersionHistory";
import { useDiscardConfirm } from "@/components/templates/DiscardConfirmDialog";
import {
  fromEditable,
  randId,
  toEditable,
  type EditableTask,
} from "@/components/templates/editableTemplate";
import { useCreateSop, usePayers, usePublishSop, useUpdateSop } from "@/hooks/useAdmin";
import { useProviderGroups } from "@/hooks/useLookups";
import { useTokenCatalog } from "@/hooks/useMappingReview";
import { usePortals } from "@/hooks/usePortals";
import { useIsAdmin } from "@/lib/permissions";
import { isFallbackTemplate } from "@/lib/pickTemplate";
import { filterAuthoringTokens } from "@/lib/sopAuthoringTokens";
import { SopVersionConflictError } from "@/services/templates";
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
  const isAdmin = useIsAdmin();
  // Global templates (org_id NULL — assigned catalog SOPs and the seeded
  // fallback) are platform-managed: read-only for every org user, admin or not.
  const isGlobal = initial
    ? (initial as SOPTemplate & { orgId: string | null }).orgId === null
    : false;
  const isFallback = initial ? isFallbackTemplate(initial) : false;
  const canEdit = isAdmin && !isGlobal;

  const payersQ = usePayers();
  const groupsQ = useProviderGroups();
  const tokensQ = useTokenCatalog();
  const portalsQ = usePortals();
  const createMut = useCreateSop();
  const updateMut = useUpdateSop(initial?.id ?? "");
  const publishMut = usePublishSop(initial?.id ?? "");

  const portals = useMemo<Portal[]>(() => portalsQ.data ?? [], [portalsQ.data]);

  // TE-7: the authoring picker advertises only resolver-resolvable tokens — a
  // dataFields entry whose token the client resolver cannot substitute is
  // silently filtered at resolution. Case-scoped catalog families
  // (payer.*/contract.*, the user.* pair) stay available to their own
  // consumers (extension profile fill, mapping review), just not here.
  const tokens = useMemo(
    () => filterAuthoringTokens((tokensQ.data ?? []) as SopFieldToken[]),
    [tokensQ.data],
  );
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
  // E1.7b publish flow: the change-note dialog and the version-history dialog.
  const [publishOpen, setPublishOpen] = useState(false);
  const [changeNote, setChangeNote] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

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
                  expectedTurnaroundDays: null,
                  followUpEveryDays: null,
                  requiredArtifacts: [],
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

  // TE-5 split. Content = name + task definitions (versioned via Publish);
  // match keys = payer/state/specialty/group (unversioned head update).
  // Compare the task definitions against the same normalized round-trip so
  // toEditable's defaults never read as a phantom edit.
  const initialNormalizedDefs = useMemo(
    () => (initial ? JSON.stringify(fromEditable(toEditable(initial.taskDefinitions))) : ""),
    [initial],
  );
  const contentChanged =
    !isEdit ||
    !initial ||
    name.trim() !== initial.name ||
    JSON.stringify(previewTasks) !== initialNormalizedDefs;
  const matchKeyChanged =
    isEdit && initial
      ? payload.payerId !== initial.payerId ||
        payload.state !== initial.state ||
        payload.specialty !== (initial.specialty ?? null) ||
        payload.groupId !== initial.groupId
      : false;

  // Match-key-only head update (no version bump). Content changes go through
  // handlePublish below.
  async function saveMatchKey() {
    const { name: _name, taskDefinitions: _defs, archived: _archived, ...matchKey } = payload;
    await updateMut.mutateAsync(matchKey);
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast.error("Template name is required");
      setStep(1);
      return;
    }
    setSaving(true);
    try {
      const created = await createMut.mutateAsync(payload);
      setDirty(false);
      toast.success("Template created");
      navigate({ to: "/admin/templates/$id", params: { id: created.id } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  // Edit-mode save. Content changes publish an immutable version via the RPC;
  // a pure match-key edit is a head update with no version bump.
  async function handlePublish(note: string) {
    if (!initial) return;
    if (!name.trim()) {
      toast.error("Template name is required");
      setPublishOpen(false);
      setStep(1);
      return;
    }
    setSaving(true);
    try {
      if (matchKeyChanged) await saveMatchKey();
      if (contentChanged) {
        const result = await publishMut.mutateAsync({
          expectedVersion: initial.currentVersion ?? 1,
          name: name.trim(),
          taskDefinitions: previewTasks,
          changeNote: note.trim() || null,
        });
        toast.success(`Published version ${result.version}`);
      } else {
        toast.success("Match key updated — no new version");
      }
      setDirty(false);
      setPublishOpen(false);
      navigate({ to: "/admin/templates" });
    } catch (err) {
      if (err instanceof SopVersionConflictError) {
        toast.error("Someone else published a newer version — reload to see it.");
      } else {
        const msg = err instanceof Error ? err.message : "Publish failed";
        toast.error(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  function handleSaveClick() {
    if (!isEdit) {
      void handleCreate();
      return;
    }
    if (contentChanged) {
      // Content publishes a new version — collect the optional change note.
      setChangeNote("");
      setPublishOpen(true);
    } else {
      void handlePublish("");
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
            {isEdit ? (
              <Button variant="outline" onClick={() => setHistoryOpen(true)}>
                <History className="h-4 w-4 mr-2" />
                History
              </Button>
            ) : null}
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
          {isGlobal
            ? isFallback
              ? "Generic fallback SOP — used when a case's payer and state have no authored SOP. Managed by the platform; read-only."
              : "Global catalog SOP — managed by the platform; read-only."
            : "Read-only view. Only admins can create or edit templates."}
        </div>
      ) : null}

      {isEdit && canEdit ? (
        <div className="mb-4 rounded-md border border-[#E8E5E0] bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Version {initial?.currentVersion ?? 1}. Content changes publish a new version — earlier
          versions are never overwritten. Match-key changes (payer/state/specialty/group) update the
          template identity without a new version.
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

          <TemplatePreviewTasks tasks={previewTasks} portals={portals} />
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
            onClick={handleSaveClick}
            disabled={saving}
            style={{ backgroundColor: "#1B4D3E" }}
            className="text-white hover:opacity-90"
          >
            <Save className="h-4 w-4 mr-2" />
            {saving
              ? "Saving…"
              : !isEdit
                ? "Create template"
                : contentChanged
                  ? "Publish"
                  : "Save match key"}
          </Button>
        ) : (
          <span />
        )}
      </div>

      {publishOpen ? (
        <Dialog open onOpenChange={(o) => !o && setPublishOpen(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Publish version {(initial?.currentVersion ?? 1) + 1}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Publishing saves this content as an immutable version. Tasks generated from earlier
                versions keep the content they were created with.
              </p>
              <div>
                <Label className="text-xs">Change note (optional)</Label>
                <Textarea
                  value={changeNote}
                  onChange={(e) => setChangeNote(e.target.value)}
                  placeholder="What changed and why"
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPublishOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button
                onClick={() => void handlePublish(changeNote)}
                disabled={saving}
                style={{ backgroundColor: "#1B4D3E" }}
                className="text-white hover:opacity-90"
              >
                {saving ? "Publishing…" : "Publish"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {historyOpen && initial ? (
        <TemplateVersionHistoryDialog
          templateId={initial.id}
          currentVersion={initial.currentVersion ?? 1}
          portals={portals}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}

      {discardDialog}
    </div>
  );
}
