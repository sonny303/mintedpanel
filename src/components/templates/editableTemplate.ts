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
import type { SOPStepType, SOPTaskDefinition } from "@/types";

export interface DataField {
  label: string;
  token: string;
}

export interface EmailTemplate {
  subject: string;
  body: string;
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
        emailTemplate?: { subject?: string; body?: string };
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
          ? { emailTemplate: { subject: s.emailTemplate.subject, body: s.emailTemplate.body } }
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
