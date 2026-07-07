// Editable in-memory shape for the SOP template wizard, plus converters to and
// from the persisted SOPTaskDefinition[] (the task_definitions jsonb). The DB
// shape is owned by the resolver (src/lib/sopResolver.ts) — data-field tokens
// stay BARE (e.g. "provider.firstName") because the resolver uses them as map
// keys; only free-text label/detail/email carry {{token}} braces. Keep these
// converters faithful to that contract; case creation depends on it.
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
}

export interface EditableTask {
  id: string;
  title: string;
  description: string;
  dueOffsetDays: number;
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
    steps: (d.steps ?? []).map((s) => {
      const raw = s as {
        label?: string;
        detail?: string;
        stepType?: SOPStepType;
        emailTemplate?: { subject?: string; body?: string };
        dataFields?: DataField[];
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
    steps: t.steps.map((s) => ({
      label: s.label,
      detail: s.detail,
      stepType: s.stepType,
      ...(s.stepType === "draft_email"
        ? { emailTemplate: { subject: s.emailTemplate.subject, body: s.emailTemplate.body } }
        : {}),
      dataFields: s.dataFields.filter((f) => typeof f.token === "string" && f.token.includes(".")),
    })) as SOPTaskDefinition["steps"],
  }));
}
