// Four-step wizard for authoring an SOP template (Admin > Templates). Replaces
// the old single-page editor. The jsonb shape is unchanged (owned by
// src/lib/sopResolver.ts): tasks -> steps -> data fields with bare tokens;
// case creation reads it untouched.
//
// E1.7b Model A save split (TE-5): CONTENT (name + task definitions) saves
// through Publish — the publish_sop_template_version RPC inserts an immutable
// version row, updates the head, and bumps current_version (optimistic
// concurrency; a losing publish gets a friendly conflict toast). MATCH-KEY
// edits (payer/state/group — the E4.2 supported grain; legacy specialty is
// preserved but not an editable match key) are head-level identity edits and go
// through the plain audited update — no version bump. Global templates
// (org_id NULL, incl. the seeded fallback) render read-only for org users.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileEdit,
  History,
  Plus,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  portalKeyConflicts,
  randId,
  toEditable,
  type EditableTask,
} from "@/components/templates/editableTemplate";
import { useCreateSop, usePayers, usePublishSop, useUpdateSop } from "@/hooks/useAdmin";
import { useAuthorGlobalSop } from "@/hooks/useGlobalAuthoring";
import { useProviderGroups } from "@/hooks/useLookups";
import { useTokenCatalog } from "@/hooks/useMappingReview";
import { usePortals } from "@/hooks/usePortals";
import { useIsAdmin } from "@/lib/permissions";
import { isFallbackTemplate } from "@/lib/pickTemplate";
import { orgSopMatchKeyError } from "@/lib/sopMatchKey";
import { filterAuthoringTokens } from "@/lib/sopAuthoringTokens";
import { SopVersionConflictError } from "@/services/templates";
import { lintSopForPublish } from "@/lib/sopPublishLint";
import { EXECUTION_TYPES, EXECUTION_TYPE_LABELS, type ExecutionType } from "@/lib/executionTypes";
import {
  PROFILE_ATTRIBUTES,
  normalizeRequiredAttributes,
  type ProfileAttributeKey,
} from "@/lib/profileGating";
import { useSaveSopTemplateDraft, useDeleteSopTemplateDraft } from "@/hooks/useSopTemplateDrafts";
import { cn } from "@/lib/utils";
import type { Portal, SOPTaskDefinition, SOPTemplate, SopTemplateDraft } from "@/types";

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

interface WizardPrefill {
  payerId?: string;
  state?: string;
  groupId?: string;
}

/** The serialized draft payload shape (E4.2 F4.2.1 save-as-draft). */
interface DraftPayload {
  name: string;
  payerId: string;
  state: string;
  specialty: string;
  groupId: string;
  tasks: EditableTask[];
  requiredProfileAttributes: ProfileAttributeKey[];
  isArchived: boolean;
}

interface TemplateWizardProps {
  // null = create mode; a template = edit mode (pre-filled).
  initial: SOPTemplate | null;
  // E4.2 TE-4 — the "Needs SOP" creation link prefills the match key.
  prefill?: WizardPrefill;
  // E4.2 F4.2.1 — resume an existing draft (create mode only).
  draft?: SopTemplateDraft | null;
  // E6.5 F6.5.6 — create-mode GLOBAL authoring (?tier=global): the head is an
  // org_id NULL row written through author_global_sop, inherited by every org.
  globalTier?: boolean;
}

export function TemplateWizard({ initial, prefill, draft, globalTier }: TemplateWizardProps) {
  const navigate = useNavigate();
  const isEdit = initial !== null;
  const draftPayload = (draft?.payload ?? null) as DraftPayload | null;
  const [draftId, setDraftId] = useState<string | null>(draft?.id ?? null);
  const isAdmin = useIsAdmin();
  // E6.5 F6.5.6 — GLOBAL templates (org_id NULL) are now AUTHORABLE from here
  // ("authored once, inherited by every org"), open to all authenticated users
  // under the interim governance posture (R7 introduces platform roles). The
  // seeded generic fallback stays platform-managed and read-only (its RPC
  // guards reject org-user edits too).
  const isGlobal = initial ? initial.orgId === null : Boolean(globalTier);
  const isFallback = initial ? isFallbackTemplate(initial) : false;
  const canEdit = isFallback ? false : isGlobal ? true : isAdmin;
  // E4.2 SOP hardening — the template tier, matching the deterministic
  // pickTemplate precedence (organization override → global payer SOP → generic
  // fallback). Org templates authored here are always the organization tier.
  const tierLabel = isFallback
    ? "Generic fallback"
    : isGlobal
      ? "Global payer SOP"
      : "Organization override";

  const payersQ = usePayers();
  const groupsQ = useProviderGroups();
  const tokensQ = useTokenCatalog();
  const portalsQ = usePortals();
  const createMut = useCreateSop();
  const authorGlobalMut = useAuthorGlobalSop();
  const updateMut = useUpdateSop(initial?.id ?? "");
  const publishMut = usePublishSop(initial?.id ?? "");
  const saveDraftMut = useSaveSopTemplateDraft();
  const deleteDraftMut = useDeleteSopTemplateDraft();

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
  const [name, setName] = useState(draftPayload?.name ?? initial?.name ?? "");
  const [payerId, setPayerId] = useState<string>(
    draftPayload?.payerId ?? initial?.payerId ?? prefill?.payerId ?? "none",
  );
  const [state, setState] = useState<string>(
    draftPayload?.state ?? initial?.state ?? prefill?.state ?? "none",
  );
  // Specialty is preserved (stored + displayed) but is NOT an editable runtime
  // match key any more (E4.2 hardening) — no setter is wired.
  const [specialty] = useState<string>(draftPayload?.specialty ?? initial?.specialty ?? "");
  const [groupId, setGroupId] = useState<string>(
    draftPayload?.groupId ?? initial?.groupId ?? prefill?.groupId ?? "none",
  );
  const [tasks, setTasks] = useState<EditableTask[]>(() =>
    draftPayload ? draftPayload.tasks : toEditable(initial?.taskDefinitions),
  );
  // E4.2 TE-13 — governed required provider-profile attributes for this SOP.
  const [requiredAttrs, setRequiredAttrs] = useState<ProfileAttributeKey[]>(() =>
    draftPayload
      ? normalizeRequiredAttributes(draftPayload.requiredProfileAttributes)
      : normalizeRequiredAttributes(initial?.requiredProfileAttributes),
  );
  const [isArchived, setIsArchived] = useState(
    Boolean(draftPayload?.isArchived ?? initial?.archived ?? initial?.isArchived ?? false),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // E1.7b publish flow: the change-note dialog and the version-history dialog.
  const [publishOpen, setPublishOpen] = useState(false);
  const [changeNote, setChangeNote] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  // E4.2 F4.2.1 — global-tier blast-radius acknowledgment. A global/shared
  // template is consumed by every org without an override, so publishing a
  // change requires an explicit confirmation. (Org templates publish as before;
  // global rows are platform-managed and read-only in the org UI, so this is a
  // defense-in-depth gate for any privileged publish path.)
  const [blastAck, setBlastAck] = useState(false);

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

  // Stable identity (measured hotfix, 2026-07-17): every handler handed to
  // TemplateTaskRow is a useCallback so React.memo on the row can actually
  // bail out — with plain per-render closures, one keystroke in any step field
  // re-rendered EVERY task card (each a forest of Radix selects), which
  // measured 264–296ms p50 per keystroke on a 10-task template (prod build,
  // 4x CPU throttle). All updaters use functional setTasks, so none needs the
  // current tasks value.
  const markDirty = useCallback(() => {
    setDirty(true);
  }, []);

  // --- task-level edits (Step 2 + used by Step 3 via TemplateTaskRow) ---
  function addTask() {
    setTasks((prev) => [
      ...prev,
      {
        id: randId(),
        title: "New task",
        description: "",
        dueOffsetDays: prev.length * 7,
        executionType: "manual",
        steps: [],
      },
    ]);
    markDirty();
  }
  // E4.2 PM round-4 — accessible task reorder (move up/down, no drag needed).
  function moveTask(index: number, delta: -1 | 1) {
    setTasks((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    markDirty();
  }
  const moveStep = useCallback(
    (taskId: string, index: number, delta: -1 | 1) => {
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;
          const target = index + delta;
          if (target < 0 || target >= t.steps.length) return t;
          const next = [...t.steps];
          [next[index], next[target]] = [next[target], next[index]];
          return { ...t, steps: next };
        }),
      );
      markDirty();
    },
    [markDirty],
  );
  function toggleRequiredAttr(key: ProfileAttributeKey) {
    setRequiredAttrs((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
    markDirty();
  }
  const removeTask = useCallback(
    (taskId: string) => {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      markDirty();
    },
    [markDirty],
  );
  const updateTask = useCallback(
    (taskId: string, patch: Partial<EditableTask>) => {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t)));
      markDirty();
    },
    [markDirty],
  );
  const reorderTasks = useCallback(
    (fromId: string, toId: string) => {
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
    },
    [markDirty],
  );

  // --- step-level edits (Step 3) ---
  const addStep = useCallback(
    (taskId: string) => {
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
                    stepType: "online_form" as const,
                    emailTemplate: { subject: "", body: "", to: [], cc: [] },
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
    },
    [markDirty],
  );
  const removeStep = useCallback(
    (taskId: string, stepId: string) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, steps: t.steps.filter((s) => s.id !== stepId) } : t,
        ),
      );
      markDirty();
    },
    [markDirty],
  );
  const updateStep = useCallback(
    (taskId: string, stepId: string, patch: Partial<EditableTask["steps"][number]>) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, steps: t.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) }
            : t,
        ),
      );
      markDirty();
    },
    [markDirty],
  );
  const reorderSteps = useCallback(
    (taskId: string, fromId: string, toId: string) => {
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
    },
    [markDirty],
  );

  // --- data-field edits (Step 3) ---
  const addDataField = useCallback(
    (taskId: string, stepId: string) => {
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
    },
    [firstToken, markDirty],
  );
  const updateDataField = useCallback(
    (
      taskId: string,
      stepId: string,
      idx: number,
      patch: Partial<{ label: string; token: string }>,
    ) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                steps: t.steps.map((s) =>
                  s.id === stepId
                    ? {
                        ...s,
                        dataFields: s.dataFields.map((f, i) =>
                          i === idx ? { ...f, ...patch } : f,
                        ),
                      }
                    : s,
                ),
              }
            : t,
        ),
      );
      markDirty();
    },
    [markDirty],
  );
  const removeDataField = useCallback(
    (taskId: string, stepId: string, idx: number) => {
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
    },
    [markDirty],
  );

  const previewTasks: SOPTaskDefinition[] = useMemo(() => fromEditable(tasks), [tasks]);

  const payload = useMemo(
    () => ({
      name: name.trim(),
      payerId: payerId === "none" ? null : payerId,
      state: state === "none" ? null : state,
      specialty: specialty.trim() || null,
      groupId: groupId === "none" ? null : groupId,
      taskDefinitions: previewTasks,
      requiredProfileAttributes: requiredAttrs,
      archived: isArchived,
    }),
    [name, payerId, state, specialty, groupId, previewTasks, requiredAttrs, isArchived],
  );

  // E4.2 PM round-4 — minimum-content publish lint (≥1 task, every task ≥1 step,
  // no placeholder labels). Blocks Create/Publish and surfaces on Review.
  const lint = useMemo(() => lintSopForPublish(previewTasks), [previewTasks]);

  // E4.2 F4.2.1 — save the current wizard state as a draft (WIP, never resolves
  // for generation). Persisted for handoff; deleted on publish.
  async function handleSaveDraft() {
    try {
      const saved = await saveDraftMut.mutateAsync({
        id: draftId ?? undefined,
        templateId: initial?.id ?? null,
        payload: {
          name,
          payerId,
          state,
          specialty,
          groupId,
          tasks,
          requiredProfileAttributes: requiredAttrs,
          isArchived,
        } satisfies DraftPayload,
      });
      setDraftId(saved.id);
      setDirty(false);
      toast.success("Draft saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the draft");
    }
  }

  async function discardDraftIfAny() {
    if (draftId) {
      try {
        await deleteDraftMut.mutateAsync(draftId);
      } catch {
        // A leftover draft is harmless; never block publish on cleanup.
      }
      setDraftId(null);
    }
  }

  // TE-5 split. Content = name + task definitions (versioned via Publish);
  // match keys = payer/state/specialty/group (unversioned head update).
  // Compare the task definitions against the same normalized round-trip so
  // toEditable's defaults never read as a phantom edit.
  const initialNormalizedDefs = useMemo(
    () => (initial ? JSON.stringify(fromEditable(toEditable(initial.taskDefinitions))) : ""),
    [initial],
  );
  // Memoized: the stringify is O(template size) and this ran on EVERY render
  // (every keystroke) before the measured hotfix.
  const contentChanged = useMemo(
    () =>
      !isEdit ||
      !initial ||
      name.trim() !== initial.name ||
      JSON.stringify(previewTasks) !== initialNormalizedDefs,
    [isEdit, initial, name, previewTasks, initialNormalizedDefs],
  );
  const matchKeyChanged =
    isEdit && initial
      ? payload.payerId !== initial.payerId ||
        payload.state !== initial.state ||
        payload.specialty !== (initial.specialty ?? null) ||
        payload.groupId !== initial.groupId
      : false;
  const routingMatchKeyChanged =
    isEdit && initial
      ? payload.payerId !== initial.payerId ||
        payload.state !== initial.state ||
        payload.groupId !== initial.groupId
      : false;

  // Match-key-only head update (no version bump). Content changes go through
  // handlePublish below. Global heads route through author_global_sop (no
  // table policy allows a global write); org heads keep the audited update.
  async function saveMatchKey() {
    if (isGlobal && initial) {
      await authorGlobalMut.mutateAsync({
        id: initial.id,
        name: payload.name,
        payerId: payload.payerId,
        state: payload.state,
        groupId: payload.groupId,
        archived: payload.archived,
      });
      return;
    }
    const { name: _name, taskDefinitions: _defs, archived: _archived, ...matchKey } = payload;
    await updateMut.mutateAsync(matchKey);
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast.error("Template name is required");
      setStep(1);
      return;
    }
    if (!lint.ok) {
      toast.error(lint.errors[0].message);
      setStep(3);
      return;
    }
    setSaving(true);
    try {
      const created = isGlobal
        ? await authorGlobalMut.mutateAsync({
            name: payload.name,
            payerId: payload.payerId,
            state: payload.state,
            groupId: payload.groupId,
            taskDefinitions: payload.taskDefinitions,
            requiredProfileAttributes: payload.requiredProfileAttributes,
            archived: false,
          })
        : await createMut.mutateAsync(payload);
      await discardDraftIfAny();
      setDirty(false);
      toast.success(isGlobal ? "Global SOP created" : "Template created");
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
    if (contentChanged && !lint.ok) {
      toast.error(lint.errors[0].message);
      setPublishOpen(false);
      setStep(3);
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
          requiredProfileAttributes: requiredAttrs,
        });
        toast.success(`Published version ${result.version}`);
      } else {
        toast.success("Match key updated — no new version");
      }
      await discardDraftIfAny();
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

  // One portal per task: the extension closes exactly one task per portal
  // submission, so a task whose online_form steps point at different portals
  // would make the close-out target ambiguous. Block every content-writing save
  // (create, publish, duplicate) BEFORE any mutation and steer the author to the
  // offending task, which also shows an inline warning in Step 3.
  function portalConflictBlocked(): boolean {
    const conflicts = portalKeyConflicts(tasks);
    if (conflicts.length === 0) return false;
    const c = conflicts[0];
    toast.error(
      `"${c.title.trim() || `Task ${c.taskIdx + 1}`}" links more than one portal (${c.keys.join(", ")}). A task can fill only one portal — pick one.`,
    );
    setStep(3);
    return true;
  }

  // E4.2 SOP hardening — new SOPs and routing-key changes must target a payer
  // AND a state; since E6.5 the same rule binds GLOBAL authoring (a payerless
  // global row would collide with the generic fallback's grain — the
  // author_global_sop RPC enforces it server-side too). Existing legacy
  // templates with incomplete keys may still publish content-only versions
  // under the E1.7b compatibility contract; changing their routing key
  // requires completing it first.
  function matchKeyIncompleteBlocked(): boolean {
    const err = orgSopMatchKeyError({
      payerId: payerId === "none" ? null : payerId,
      state: state === "none" ? null : state,
    });
    if (err && isEdit && initial && !routingMatchKeyChanged) return false;
    if (err) {
      toast.error(err);
      setStep(1);
      return true;
    }
    return false;
  }

  function handleSaveClick() {
    if (matchKeyIncompleteBlocked()) return;
    if (portalConflictBlocked()) return;
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
    // The copy carries the current in-memory tasks, so the same one-portal-per-
    // task invariant must hold before it is persisted.
    if (portalConflictBlocked()) return;
    try {
      // E4.2 — the copy shares the source's payer/state/group, which would
      // collide with it under the active-org uniqueness rule. Create it ARCHIVED
      // (outside the active grain) so the duplicate always succeeds; the author
      // re-keys it and restores it (validated at the new key).
      const created = isGlobal
        ? await authorGlobalMut.mutateAsync({
            name: `${name} (copy)`,
            payerId: payload.payerId,
            state: payload.state,
            groupId: payload.groupId,
            taskDefinitions: payload.taskDefinitions,
            requiredProfileAttributes: payload.requiredProfileAttributes,
            archived: true,
          })
        : await createMut.mutateAsync({
            ...payload,
            name: `${name} (copy)`,
            archived: true,
          });
      toast.success(
        "Duplicated as an archived copy — set a distinct payer/state/group, then restore it.",
      );
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
      if (isGlobal) {
        await authorGlobalMut.mutateAsync({
          id: initial.id,
          name: payload.name,
          payerId: payload.payerId,
          state: payload.state,
          groupId: payload.groupId,
          archived: next,
        });
      } else {
        await updateMut.mutateAsync({ archived: next });
      }
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
            {canEdit ? (
              <Button
                variant="outline"
                onClick={() => void handleSaveDraft()}
                disabled={saveDraftMut.isPending}
              >
                <FileEdit className="h-4 w-4 mr-2" />
                {saveDraftMut.isPending ? "Saving…" : "Save draft"}
              </Button>
            ) : null}
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
          {isFallback
            ? "Generic fallback SOP — used when a case's payer and state have no authored SOP. Managed by the platform; read-only."
            : "Read-only view. Only admins can create or edit templates."}
        </div>
      ) : null}
      {isGlobal && canEdit ? (
        <div className="mb-4 rounded-md border border-[#FDE68A] bg-[#FEF3C7] px-3 py-2 text-sm text-[#92400E]">
          Global SOP — authored once and inherited by every organization without an override.
          Authoring is open to all signed-in users for now; platform roles arrive in a later
          release.
        </div>
      ) : null}

      {isEdit && canEdit ? (
        <div className="mb-4 rounded-md border border-[#E8E5E0] bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Version {initial?.currentVersion ?? 1}. Content changes publish a new version — earlier
          versions are never overwritten. Match-key changes (payer/state/group) update the template
          identity without a new version.
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
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Match key</h2>
            <span className="inline-flex items-center rounded-full border border-[#E8E5E0] px-2 py-0.5 text-xs text-muted-foreground">
              {tierLabel}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            A case resolves this template by payer + state; the group narrows it further. An
            organization SOP <span className="font-medium">requires a payer and a state</span>.
            Leave Group on “Any group” to cover every group — an exact-group SOP always wins over an
            any-group one. Specialty is legacy metadata and is not used for matching.
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
                  <SelectValue placeholder="Select a payer" />
                </SelectTrigger>
                <SelectContent>
                  {/* No "Any payer" — organization SOPs must target a payer. The
                      read-only path keeps a display item so a global/fallback row
                      (payerless) still renders a value. */}
                  {!canEdit ? <SelectItem value="none">Not payer-specific</SelectItem> : null}
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
                  <SelectValue placeholder="Select a state" />
                </SelectTrigger>
                <SelectContent>
                  {/* No "Any state" — organization SOPs must target a state. */}
                  {!canEdit ? <SelectItem value="none">Not state-specific</SelectItem> : null}
                  {US_STATES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            {specialty.trim() ? (
              <div className="col-span-2">
                <Label className="text-muted-foreground">
                  Specialty (legacy — not used for matching)
                </Label>
                <p className="mt-1 text-[13px]">{specialty.trim()}</p>
              </div>
            ) : null}
          </div>

          {/* E4.2 F4.2.6 — required provider-profile attributes (the generation
              gate). Providers missing these are blocked in the preview instead
              of generating a stalled case. Governed list — no free text. */}
          <div className="mt-5 border-t border-[#E8E5E0] pt-4">
            <h3 className="text-sm font-semibold">Required provider attributes</h3>
            <p className="text-xs text-muted-foreground mb-3">
              A provider missing any of these is blocked from generation for this SOP (with the
              specific gap), so it becomes a data-collection task instead of a stalled case.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {PROFILE_ATTRIBUTES.map((attr) => (
                <label key={attr.key} className="flex items-center gap-2 text-[13px]">
                  <Checkbox
                    checked={requiredAttrs.includes(attr.key)}
                    disabled={!canEdit}
                    onCheckedChange={() => toggleRequiredAttr(attr.key)}
                    aria-label={`Require ${attr.label}`}
                  />
                  {attr.label}
                </label>
              ))}
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
                  <div className="mt-1 flex flex-col items-center gap-0.5">
                    <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                    {/* E4.2 PM round-4 — keyboard-operable reorder alongside drag. */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={idx === 0}
                      aria-label={`Move task ${idx + 1} up`}
                      onClick={() => moveTask(idx, -1)}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={idx === tasks.length - 1}
                      aria-label={`Move task ${idx + 1} down`}
                      onClick={() => moveTask(idx, 1)}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                  </div>
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
                  <div>
                    {/* E4.2 TE-12 — execution type (captured; automation rides later epics). */}
                    <Label>Execution type</Label>
                    <Select
                      value={task.executionType}
                      onValueChange={(v) =>
                        updateTask(task.id, { executionType: v as ExecutionType })
                      }
                      disabled={!canEdit}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EXECUTION_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {EXECUTION_TYPE_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                isGlobalAuthoring={isGlobal}
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
                moveStep={moveStep}
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
            <dt className="text-muted-foreground">Tier</dt>
            <dd>{tierLabel}</dd>
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{name.trim() || "—"}</dd>
            <dt className="text-muted-foreground">Payer</dt>
            <dd>
              {payerId === "none"
                ? "— (required)"
                : ((payersQ.data ?? []).find((p) => p.id === payerId)?.name ?? "—")}
            </dd>
            <dt className="text-muted-foreground">State</dt>
            <dd>{state === "none" ? "— (required)" : state}</dd>
            <dt className="text-muted-foreground">Group</dt>
            <dd>
              {groupId === "none"
                ? "Any group"
                : ((groupsQ.data ?? []).find((g) => g.id === groupId)?.name ?? "—")}
            </dd>
            {specialty.trim() ? (
              <>
                <dt className="text-muted-foreground">Specialty (legacy)</dt>
                <dd>{specialty.trim()}</dd>
              </>
            ) : null}
          </dl>

          {canEdit && !lint.ok ? (
            <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] p-3 text-[13px] text-[#B91C1C]">
              <p className="font-medium">Fix before publishing:</p>
              <ul className="mt-1 list-disc pl-5">
                {lint.errors.map((e, i) => (
                  <li key={i}>{e.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {requiredAttrs.length > 0 ? (
            <dl className="rounded-md border border-[#E8E5E0] bg-[#FDFDFC] p-4 text-sm">
              <dt className="text-muted-foreground">Required provider attributes</dt>
              <dd className="mt-1 font-medium">
                {requiredAttrs
                  .map((k) => PROFILE_ATTRIBUTES.find((a) => a.key === k)?.label ?? k)
                  .join(", ")}
              </dd>
            </dl>
          ) : null}

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
              {isGlobal ? (
                <div className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] p-3 text-[13px] text-[#92400E]">
                  <p className="font-medium">Global template — high blast radius</p>
                  <p className="mt-1">
                    This template is shared by every organization without an override. Publishing
                    changes what all of them generate. Version {(initial?.currentVersion ?? 1) + 1}{" "}
                    will carry {previewTasks.length} task
                    {previewTasks.length === 1 ? "" : "s"}.
                  </p>
                  <label className="mt-2 flex items-center gap-2">
                    <Checkbox checked={blastAck} onCheckedChange={(v) => setBlastAck(v === true)} />
                    I understand this affects every organization.
                  </label>
                </div>
              ) : null}
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
                disabled={saving || (isGlobal && !blastAck)}
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
