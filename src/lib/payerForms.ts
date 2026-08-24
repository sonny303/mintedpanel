// Payer PDF — the pure layer for payer-specific blank forms attached to a SOP
// template, and for the case actions generated from them.
//
// Two grains live here and must not be confused:
//
//   FAMILY  — the stable identity a TEMPLATE ACTION points at. Replacing a
//             form adds a version under the same family, so the authored
//             action keeps pointing at the right thing without republishing
//             the template.
//   ROW     — one immutable uploaded file (family + version). A CASE task
//             points at a row, baked at generation time, so a case keeps the
//             exact file it was generated with even after a later replace.
//
// "Current" is DERIVED (highest live version in the family), never a flag —
// the same rule as the provider-documents vault.
//
// Date/clock discipline: nothing here reads a clock. Removal marking takes an
// explicit ISO timestamp from the caller.
import { safeFileName } from "@/lib/documents";
import type { AuthoredPayerFormPointer, ResolvedPayerFormPointer } from "@/types";

export type { AuthoredPayerFormPointer, ResolvedPayerFormPointer };

export const PAYER_FORM_BUCKET = "payer-forms";
/** Mirrored by the bucket's file_size_limit in 20260824170000_payer_forms.sql. */
export const PAYER_FORM_MAX_BYTES = 25 * 1024 * 1024; // 25 MiB
/** PDF only — a payer form is a form, not a scan. Mirrored by the bucket's
 * allowed_mime_types and the payer_forms_mime_pdf CHECK. */
export const PAYER_FORM_MIME_TYPES = ["application/pdf"] as const;
/** Signed download URLs are short-lived, matching DOWNLOAD_URL_TTL_SECONDS. */
export const PAYER_FORM_URL_TTL_SECONDS = 120;
/** A label has to fit a checklist row without becoming the row. */
export const PAYER_FORM_LABEL_MAX = 120;

// ---------------------------------------------------------------------------
// Storage path contract. Keys are generated SERVER-side from these parts and
// never accepted verbatim from the browser — the same posture as
// documentObjectPath. There is no org segment: these rows are global.
// ---------------------------------------------------------------------------

export interface PayerFormPathParts {
  payerId: string;
  familyId: string;
  version: number;
  fileName: string;
}

export function payerFormObjectPath(parts: PayerFormPathParts): string {
  return [
    "payer",
    parts.payerId,
    parts.familyId,
    String(parts.version),
    safeFileName(parts.fileName),
  ].join("/");
}

/** The family prefix — everything above the version folders. */
export function payerFormFamilyPrefix(
  parts: Pick<PayerFormPathParts, "payerId" | "familyId">,
): string {
  return ["payer", parts.payerId, parts.familyId].join("/");
}

// ---------------------------------------------------------------------------
// Version derivation
// ---------------------------------------------------------------------------

/** The narrow shape the version rules need — satisfied by PayerForm. */
export interface PayerFormVersionShape {
  id: string;
  familyId: string;
  version: number;
  retiredAt?: string | null;
}

/** A family is retired when its CURRENT version is retired. An older version
 * carrying retired_at is just history, not a retirement of the family. */
export function currentPayerForms<T extends PayerFormVersionShape>(rows: readonly T[]): T[] {
  const byFamily = new Map<string, T[]>();
  for (const row of rows) {
    byFamily.set(row.familyId, [...(byFamily.get(row.familyId) ?? []), row]);
  }
  const current: T[] = [];
  for (const family of byFamily.values()) {
    const head = [...family].sort((a, b) => b.version - a.version)[0];
    if (head && !head.retiredAt) current.push(head);
  }
  return current;
}

/** The next version for a family (1 when the family is new). */
export function nextPayerFormVersion(rows: readonly PayerFormVersionShape[]): number {
  return rows.reduce((max, r) => Math.max(max, r.version), 0) + 1;
}

/** The live head of one family, or null when the family is empty or retired. */
export function currentPayerFormInFamily<T extends PayerFormVersionShape>(
  rows: readonly T[],
  familyId: string,
): T | null {
  return currentPayerForms(rows.filter((r) => r.familyId === familyId))[0] ?? null;
}

// ---------------------------------------------------------------------------
// Upload validation — shared by the browser pre-flight and the server, so a
// rejection reads identically in both places.
// ---------------------------------------------------------------------------

export function payerFormLabelError(raw: string): string | null {
  const label = raw.trim();
  if (!label) return "Give the form a name (e.g. “PT Credentialing Supplement”)";
  if (label.length > PAYER_FORM_LABEL_MAX) {
    return `Keep the name under ${PAYER_FORM_LABEL_MAX} characters`;
  }
  return null;
}

export function payerFormFileError(file: { size: number; type: string }): string | null {
  if (!(PAYER_FORM_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "Payer forms must be PDF files";
  }
  if (file.size <= 0) return "That file is empty";
  if (file.size > PAYER_FORM_MAX_BYTES) {
    return `Files are limited to ${Math.floor(PAYER_FORM_MAX_BYTES / (1024 * 1024))} MB`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The step pointer — how a Payer PDF action carries its form.
//
// A Payer PDF action is stored as an ordinary task whose SOLE step has
// stepType "pdf" (already in SOPStepType) plus a `payerForm` pointer. Reusing
// the existing step type is deliberate: it keeps the /api wire contracts
// untouched, so the extension needs no coordinated change. `projectTaskSteps`
// (services/caseContext.ts) whitelists the keys it forwards, so `payerForm`
// never reaches the extension at all.
//
// The AUTHORED pointer (template task_definitions) carries familyId only —
// which is what lets a replace reach new cases without republishing.
// The GENERATED pointer (a case task's sop_content) additionally carries the
// resolved formId/label/fileName, baked at generation.
// ---------------------------------------------------------------------------

export const PAYER_FORM_STEP_TYPE = "pdf";

type UnknownRecord = Record<string, unknown>;

function asRecord(raw: unknown): UnknownRecord | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as UnknownRecord) : null;
}

function str(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw : null;
}

/** Read the pointer off any step shape, tolerating legacy/malformed jsonb.
 * Returns null for a step that is not a payer-form step. */
export function payerFormPointer(step: unknown): ResolvedPayerFormPointer | null {
  const s = asRecord(step);
  if (!s) return null;
  const pointer = asRecord(s.payerForm);
  if (!pointer) return null;
  const familyId = str(pointer.familyId);
  if (!familyId) return null;
  const formId = str(pointer.formId);
  const label = str(pointer.label);
  const fileName = str(pointer.fileName);
  // An AUTHORED pointer (family only) is not yet resolvable to a file; callers
  // that need a file check `formId`.
  return {
    familyId,
    formId: formId ?? "",
    label: label ?? "",
    fileName: fileName ?? "",
    ...(str(pointer.removedAt) ? { removedAt: pointer.removedAt as string } : {}),
    ...(pointer.removedBy !== undefined ? { removedBy: str(pointer.removedBy) } : {}),
    ...(pointer.removedReason !== undefined ? { removedReason: str(pointer.removedReason) } : {}),
  };
}

/** Is this step a Payer PDF step? True only when it BOTH declares the step
 * type and carries a pointer — a legacy "pdf" step with no pointer stays a
 * plain step and keeps rendering the way it always did. */
export function isPayerFormStep(step: unknown): boolean {
  const s = asRecord(step);
  if (!s) return false;
  return s.stepType === PAYER_FORM_STEP_TYPE && payerFormPointer(step) !== null;
}

/** The task's payer-form pointer, or null when it is not a Payer PDF action.
 * A Payer PDF action has exactly one step by construction. */
export function taskPayerFormPointer(sopContent: unknown): ResolvedPayerFormPointer | null {
  if (!Array.isArray(sopContent)) return null;
  for (const step of sopContent) {
    if (isPayerFormStep(step)) return payerFormPointer(step);
  }
  return null;
}

/** Has this Payer PDF action been removed from the case? */
export function isPayerFormRemoved(sopContent: unknown): boolean {
  const pointer = taskPayerFormPointer(sopContent);
  return Boolean(pointer?.removedAt);
}

export interface PayerFormRemoval {
  removedAt: string;
  removedBy: string | null;
  removedReason: string | null;
}

/** Stamp the removal onto the task's sop_content, returning the NEW array.
 * Pure — the caller persists it. Every other step and key is preserved, so a
 * removal never rewrites the action's content. */
export function markPayerFormRemoved(sopContent: unknown, removal: PayerFormRemoval): unknown[] {
  if (!Array.isArray(sopContent)) return [];
  return sopContent.map((step) => {
    if (!isPayerFormStep(step)) return step;
    const s = step as UnknownRecord;
    const pointer = asRecord(s.payerForm) ?? {};
    return {
      ...s,
      payerForm: {
        ...pointer,
        removedAt: removal.removedAt,
        removedBy: removal.removedBy,
        removedReason: removal.removedReason,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Generation — resolving an AUTHORED pointer into a BAKED one.
// ---------------------------------------------------------------------------

/** The bits of a live payer form a generated task bakes in. */
export interface ResolvablePayerForm {
  id: string;
  familyId: string;
  label: string;
  fileName: string;
}

/** Index live forms by family — what `hydratePayerFormTasks` looks a pointer
 * up in. Pass the CURRENT forms (`currentPayerForms`); a retired family is
 * absent from the map by construction. */
export function payerFormsByFamily(
  forms: readonly ResolvablePayerForm[],
): Map<string, ResolvablePayerForm> {
  return new Map(forms.map((f) => [f.familyId, f]));
}

/** The authored step shape this pass reads. */
interface AuthoredStepShape {
  stepType?: string | null;
  payerForm?: { familyId?: string } | null;
}

/** Resolve every authored payer-form pointer into a baked one, on the tasks a
 * creation surface is about to write.
 *
 * Tasks pair with definitions BY INDEX — resolveTemplate maps 1:1 over
 * task_definitions, the same assumption `stampExecutionTypes` makes.
 *
 * A payer-form action whose family has no live form is DROPPED, not generated
 * empty: retiring a form means "stop putting this on new cases", and a
 * checklist item with nothing to download is worse than no item at all. The
 * same drop covers an action published before its file existed.
 */
export function hydratePayerFormTasks<T extends { sopContent?: unknown }>(
  tasks: readonly T[],
  definitions: readonly { steps?: readonly AuthoredStepShape[] }[],
  formsByFamily: ReadonlyMap<string, ResolvablePayerForm>,
): T[] {
  const out: T[] = [];
  tasks.forEach((task, i) => {
    const authoredSteps = definitions[i]?.steps ?? [];
    const authoredPointers = authoredSteps.filter(
      (s) => s?.stepType === PAYER_FORM_STEP_TYPE && s?.payerForm !== undefined,
    );
    if (authoredPointers.length === 0) {
      out.push(task);
      return;
    }
    const familyId = authoredPointers[0]?.payerForm?.familyId ?? "";
    const form = familyId ? (formsByFamily.get(familyId) ?? null) : null;
    if (!form) return; // dropped — nothing live to hand the coordinator
    const steps = Array.isArray(task.sopContent) ? task.sopContent : [];
    out.push({
      ...task,
      sopContent: steps.map((step, si) => {
        if (authoredSteps[si]?.stepType !== PAYER_FORM_STEP_TYPE) return step;
        if (authoredSteps[si]?.payerForm === undefined) return step;
        const s = asRecord(step) ?? {};
        return {
          ...s,
          stepType: PAYER_FORM_STEP_TYPE,
          payerForm: {
            familyId: form.familyId,
            formId: form.id,
            label: form.label,
            fileName: form.fileName,
          },
        };
      }),
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Case-side rendering
// ---------------------------------------------------------------------------

/** A Payer PDF action as the case checklist renders it. */
export interface PayerFormAction {
  taskId: string;
  title: string;
  status: string;
  pointer: ResolvedPayerFormPointer;
}

interface TaskShape {
  id: string;
  title: string;
  status: string;
  sopContent?: unknown;
}

/** Split a case's tasks into its LIVE Payer PDF actions and everything else.
 * Removed actions fall out of both lists: they are neither payer-form work nor
 * ordinary checklist work — they are gone from the coordinator's view while
 * staying on the row for audit. */
export function splitPayerFormActions<T extends TaskShape>(
  tasks: readonly T[],
): { payerForms: PayerFormAction[]; rest: T[]; removed: T[] } {
  const payerForms: PayerFormAction[] = [];
  const rest: T[] = [];
  const removed: T[] = [];
  for (const task of tasks) {
    const pointer = taskPayerFormPointer(task.sopContent);
    if (!pointer) {
      rest.push(task);
      continue;
    }
    if (pointer.removedAt) {
      removed.push(task);
      continue;
    }
    payerForms.push({
      taskId: task.id,
      title: task.title,
      status: task.status,
      pointer,
    });
  }
  return { payerForms, rest, removed };
}

/** The step label a Payer PDF action reads as. Falls back to the file name and
 * then a generic, so a pointer whose label went missing never renders blank. */
export function payerFormDisplayName(pointer: ResolvedPayerFormPointer): string {
  return pointer.label || pointer.fileName || "Payer form";
}
