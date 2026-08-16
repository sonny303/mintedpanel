// Editable in-memory shape for the SOP template wizard, plus converters to and
// from the persisted SOPTaskDefinition[] (the task_definitions jsonb). The DB
// shape is owned by the resolver (src/lib/sopResolver.ts) — data-field tokens
// stay BARE (e.g. "provider.firstName") because the resolver uses them as map
// keys; only free-text label/detail/email carry {{token}} braces. An
// online_form step may also carry portalKey (bare/normalized) linking it to a
// portals-registry row; it is written only for online_form steps and folded to
// the stored form via normalizePortalKey. Keep these converters faithful to
// that contract; case creation depends on it.
import { normalizePortalKey } from "@/lib/tokenFormat";
import { resolveExecutionType, type ExecutionType } from "@/lib/executionTypes";
import { DEFAULT_EMAIL_RECIPIENT_TOKEN } from "@/lib/sopResolver";
import type { SOPEmailRecipient, SOPStepType, SOPTaskDefinition } from "@/types";

export interface DataField {
  label: string;
  token: string;
}

// E1.7b F1.7b.5 (TE-15) — the wizard-editable form of a draft-email recipient.
// Both value fields are always present so toggling the source in the UI never
// loses the other's in-progress text; fromEditableRecipients emits only the
// field matching `source`. `id` keys the React row.
export interface EditableRecipient {
  id: string;
  source: "literal" | "token";
  address: string;
  token: string;
}

export interface EmailTemplate {
  subject: string;
  body: string;
  // To (≥1 valid on publish per the lint) + optional CC. Absent on legacy
  // versions; toEditable normalizes them to empty arrays.
  to: EditableRecipient[];
  cc: EditableRecipient[];
}

function toEditableRecipients(list: SOPEmailRecipient[] | undefined): EditableRecipient[] {
  return (list ?? []).map((r) => ({
    id: randId(),
    source: r.source,
    address: r.source === "literal" ? r.address : "",
    token: r.source === "token" ? r.token : DEFAULT_EMAIL_RECIPIENT_TOKEN,
  }));
}

// Emit the stored recipient union, source-faithful. Blank rows drop out (a
// half-filled literal never versions); the publish lint separately rejects a
// draft-email step left with no valid To.
function fromEditableRecipients(list: EditableRecipient[]): SOPEmailRecipient[] {
  return list.flatMap((r): SOPEmailRecipient[] => {
    if (r.source === "literal") {
      const address = r.address.trim();
      return address ? [{ source: "literal", address }] : [];
    }
    const token = r.token.trim();
    return token ? [{ source: "token", token }] : [];
  });
}

// A fresh recipient row for the "Add" affordance — literal by default (the
// common case is a fixed payer inbox, e.g. worked example 1's Optum address).
export function newEditableRecipient(): EditableRecipient {
  return { id: randId(), source: "literal", address: "", token: DEFAULT_EMAIL_RECIPIENT_TOKEN };
}

export interface EditableStep {
  id: string;
  label: string;
  detail: string;
  stepType: SOPStepType;
  emailTemplate: EmailTemplate;
  dataFields: DataField[];
  // portal_key for an online_form step, "" = not linked. Editor value is raw;
  // normalized on write.
  portalKey: string;
  // E1.7b step-shape extension. null = not set (omitted on write).
  expectedTurnaroundDays: number | null;
  followUpEveryDays: number | null;
  // Token-less named artifacts ("Submission confirmation PDF"). Attachment
  // checklists live HERE, never as token-less dataFields — a dataFields entry
  // without a resolvable token is silently filtered at resolution.
  requiredArtifacts: string[];
}

export interface EditableTask {
  id: string;
  title: string;
  description: string;
  dueOffsetDays: number;
  // E4.2 TE-12 — per-task execution type (default manual).
  executionType: ExecutionType;
  steps: EditableStep[];
}

export function randId(): string {
  return Math.random().toString(36).slice(2, 11);
}

export function toEditable(defs: SOPTaskDefinition[] | null | undefined): EditableTask[] {
  return (defs ?? []).map((d, i) => ({
    id: randId(),
    title: d.title ?? "",
    description: d.description ?? "",
    dueOffsetDays: d.dueOffsetDays ?? i * 7,
    executionType: resolveExecutionType(d.executionType),
    steps: (d.steps ?? []).map((s) => {
      const raw = s as {
        label?: string;
        detail?: string;
        stepType?: SOPStepType;
        emailTemplate?: {
          subject?: string;
          body?: string;
          to?: SOPEmailRecipient[];
          cc?: SOPEmailRecipient[];
        };
        dataFields?: DataField[];
        portalKey?: string;
        expectedTurnaroundDays?: number;
        followUpEveryDays?: number;
        requiredArtifacts?: string[];
      };
      return {
        id: randId(),
        label: raw.label ?? "",
        detail: raw.detail ?? "",
        stepType: raw.stepType ?? "online_form",
        emailTemplate: {
          subject: raw.emailTemplate?.subject ?? "",
          body: raw.emailTemplate?.body ?? "",
          to: toEditableRecipients(raw.emailTemplate?.to),
          cc: toEditableRecipients(raw.emailTemplate?.cc),
        },
        dataFields: (raw.dataFields ?? []).filter(
          (f) => typeof f.token === "string" && f.token.includes("."),
        ),
        portalKey: raw.portalKey ?? "",
        expectedTurnaroundDays:
          typeof raw.expectedTurnaroundDays === "number" ? raw.expectedTurnaroundDays : null,
        followUpEveryDays: typeof raw.followUpEveryDays === "number" ? raw.followUpEveryDays : null,
        requiredArtifacts: (raw.requiredArtifacts ?? []).filter(
          (a): a is string => typeof a === "string",
        ),
      };
    }),
  }));
}

// A task's distinct normalized `online_form` portal keys. Blank/unset keys and
// non-online_form steps never contribute, so legacy tasks (no portalKey) return
// []. The wizard uses this for the per-task inline warning; case/whitespace
// variants collapse via normalizePortalKey so they count as one portal.
export function taskPortalKeys(task: Pick<EditableTask, "steps">): string[] {
  return [
    ...new Set(
      task.steps
        .filter((s) => s.stepType === "online_form")
        .map((s) => normalizePortalKey(s.portalKey))
        .filter((k): k is string => k !== null),
    ),
  ];
}

export interface PortalKeyConflict {
  taskIdx: number;
  title: string;
  keys: string[];
}

// A task's portal must be unambiguous — the extension closes exactly ONE task
// per portal submission, so two online_form steps in the same task pointing at
// different portals would make the close-out target undecidable. Returns every
// offending task (more than one distinct normalized key) so the wizard can warn
// on the task and block save before any mutation.
export function portalKeyConflicts(tasks: EditableTask[]): PortalKeyConflict[] {
  const out: PortalKeyConflict[] = [];
  tasks.forEach((task, taskIdx) => {
    const keys = taskPortalKeys(task);
    if (keys.length > 1) out.push({ taskIdx, title: task.title, keys });
  });
  return out;
}

// BITE-SOP-TT-03 / D-SOP-1 A — collapsed Action row helpers. Storage stays
// task+steps; the editor collapses the 1:1 case so authors set one name + Mode
// instead of mirroring title and step instruction.

/** True when the action has at most one step — the common portal-fill path. */
export function isCollapsedAction(task: Pick<EditableTask, "steps">): boolean {
  return task.steps.length <= 1;
}

/** Patch for renaming an action: a sole step's instruction tracks the name so
 * publish still stamps a step label generation expects, without a second field. */
export function actionNamePatch(
  task: Pick<EditableTask, "steps">,
  title: string,
): Partial<EditableTask> {
  if (task.steps.length !== 1) return { title };
  const [sole] = task.steps;
  return { title, steps: [{ ...sole, label: title }] };
}

/** Portal / online_form path ⇒ Auto-fill; every other Mode ⇒ Manual. */
export function executionTypeForActionMode(stepType: SOPStepType): ExecutionType {
  return stepType === "online_form" ? "extension_fill" : "manual";
}

// BITE-SOP-TT-04 / D-SOP-4 A — "Add action" presets so authors never start from
// an empty Manual shell. Storage stays task+steps; each preset is one collapsed
// action (title ≡ sole step label) with Mode/execution derived from step type.
// Authoring offers Portal · Email · Custom only — phone/fax/mail stay readable
// on legacy rows but are no longer seed options.

/** Closed preset ids offered by the Template Editor Add-action menu. */
export type ActionPresetId = "portal_fill" | "draft_email" | "custom";

export interface ActionPresetMeta {
  id: ActionPresetId;
  /** Menu label. */
  label: string;
  /** Short hint under the menu item (execution + Mode). */
  hint: string;
}

/** Menu order for Add action — Portal, Email, Custom. */
export const ACTION_PRESETS: readonly ActionPresetMeta[] = [
  {
    id: "portal_fill",
    label: "Portal",
    hint: "Auto-fill · online form",
  },
  {
    id: "draft_email",
    label: "Email",
    hint: "Manual · draft email",
  },
  {
    id: "custom",
    label: "Custom",
    hint: "Manual · freeform checklist item",
  },
] as const;

/** Mode select options (same three choices as Add action). */
export const AUTHORING_ACTION_MODES: readonly {
  value: "online_form" | "draft_email" | "custom";
  label: string;
}[] = [
  { value: "online_form", label: "Portal" },
  { value: "draft_email", label: "Email" },
  { value: "custom", label: "Custom" },
] as const;

/** Map any stored step type onto the three authoring Modes. Legacy
 * phone/fax/mail/pdf rows display as Custom without rewriting storage until
 * the author changes Mode. */
export function authoringModeValue(
  stepType: SOPStepType,
): "online_form" | "draft_email" | "custom" {
  if (stepType === "online_form" || stepType === "draft_email") return stepType;
  return "custom";
}

const PRESET_TITLES: Record<ActionPresetId, string> = {
  portal_fill: "Fill online form",
  draft_email: "Draft email",
  custom: "Custom action",
};

const PRESET_STEP_TYPES: Record<ActionPresetId, SOPStepType> = {
  portal_fill: "online_form",
  draft_email: "draft_email",
  custom: "custom",
};

function emptyEditableStep(stepType: SOPStepType, label: string): EditableStep {
  return {
    id: randId(),
    label,
    detail: "",
    stepType,
    emailTemplate: {
      subject: "",
      body: "",
      // draft_email seeds one empty To row so the recipient editor matches the
      // "Add To" shape; other Modes keep empty lists (recipients never write).
      to: stepType === "draft_email" ? [newEditableRecipient()] : [],
      cc: [],
    },
    dataFields: [],
    portalKey: "",
    expectedTurnaroundDays: null,
    followUpEveryDays: null,
    requiredArtifacts: [],
  };
}

/** Pure factory: one collapsed EditableTask for an Add-action preset. */
export function createActionFromPreset(
  preset: ActionPresetId,
  dueOffsetDays: number,
): EditableTask {
  const title = PRESET_TITLES[preset];
  const stepType = PRESET_STEP_TYPES[preset];
  return {
    id: randId(),
    title,
    description: "",
    dueOffsetDays,
    executionType: executionTypeForActionMode(stepType),
    steps: [emptyEditableStep(stepType, title)],
  };
}

export function fromEditable(tasks: EditableTask[]): SOPTaskDefinition[] {
  return tasks.map((t, i) => ({
    title: t.title,
    description: t.description,
    sortOrder: i,
    dueOffsetDays: t.dueOffsetDays,
    // Store manual as absent (the implicit default), non-manual verbatim.
    ...(t.executionType && t.executionType !== "manual" ? { executionType: t.executionType } : {}),
    steps: t.steps.map((s) => {
      // A portal link is meaningful only for online_form steps; normalized to
      // the stored (bare/lowercase) form so the extension's page-key match is a
      // literal string compare.
      const portalKey = s.stepType === "online_form" ? normalizePortalKey(s.portalKey) : null;
      const requiredArtifacts = s.requiredArtifacts.map((a) => a.trim()).filter(Boolean);
      return {
        label: s.label,
        detail: s.detail,
        stepType: s.stepType,
        ...(s.stepType === "draft_email"
          ? {
              emailTemplate: (() => {
                const to = fromEditableRecipients(s.emailTemplate.to);
                const cc = fromEditableRecipients(s.emailTemplate.cc);
                return {
                  subject: s.emailTemplate.subject,
                  body: s.emailTemplate.body,
                  // Omit empty lists so a recipient-less draft_email step stays
                  // minimal jsonb (legacy round-trip identity, like portalKey).
                  ...(to.length > 0 ? { to } : {}),
                  ...(cc.length > 0 ? { cc } : {}),
                };
              })(),
            }
          : {}),
        ...(portalKey ? { portalKey } : {}),
        ...(s.expectedTurnaroundDays !== null
          ? { expectedTurnaroundDays: s.expectedTurnaroundDays }
          : {}),
        ...(s.followUpEveryDays !== null ? { followUpEveryDays: s.followUpEveryDays } : {}),
        ...(requiredArtifacts.length > 0 ? { requiredArtifacts } : {}),
        dataFields: s.dataFields.filter(
          (f) => typeof f.token === "string" && f.token.includes("."),
        ),
      };
    }) as SOPTaskDefinition["steps"],
  }));
}
