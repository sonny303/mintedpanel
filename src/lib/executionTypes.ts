// E4.2 TE-12 — the single shared source of truth for SOP task Execution Type.
// A task's execution type is captured configuration in R6: the config user
// assigns it in the SOP wizard, it rides the version's task_definitions jsonb,
// and it is stamped onto generated case tasks. NO automated behavior runs in
// this epic — E4.3 reads `extension_fill`, E4.5 reads `document_attach`,
// `auto_verify` is R7. Widen the union additively only; never re-declare it.

export const EXECUTION_TYPES = [
  "manual",
  "extension_fill",
  "auto_verify",
  "document_attach",
] as const;

export type ExecutionType = (typeof EXECUTION_TYPES)[number];

/** null/absent execution type ⇒ manual (the DB CHECK allows null for this). */
export const DEFAULT_EXECUTION_TYPE: ExecutionType = "manual";

// BITE-SOP-TT-02 / D-SOP-2 A — authoring offers only the types that matter
// today. Wire values for auto_verify / document_attach stay on EXECUTION_TYPES
// for reads, stamps, and legacy rows; they are not choosable for new picks.
export const AUTHORING_EXECUTION_TYPES = ["manual", "extension_fill"] as const;

export type AuthoringExecutionType = (typeof AUTHORING_EXECUTION_TYPES)[number];

/** Inert captured-config types — keep resolving for existing stamps; hide from
 * new Template Editor selections (BITE-SOP-TT-02). */
export const INERT_EXECUTION_TYPES = ["auto_verify", "document_attach"] as const;

export type InertExecutionType = (typeof INERT_EXECUTION_TYPES)[number];

// User-facing labels (payer-and-cases §2.8 terminology): `extension_fill`
// renders as "Auto-fill" — the internal identifier keeps its name, and the
// design's Auto-fill IS the extension-fill capability with the extension
// naming swept out of user copy.
export const EXECUTION_TYPE_LABELS: Record<ExecutionType, string> = {
  manual: "Manual",
  extension_fill: "Auto-fill",
  auto_verify: "Auto verify",
  document_attach: "Document attach",
};

/** Short capability note per type. Only Auto-fill changes anything today: it is
 * what makes form setup and readiness apply to the template's payer. The other
 * values are captured configuration. */
export const EXECUTION_TYPE_HINTS: Record<ExecutionType, string> = {
  manual: "A specialist works this task by hand.",
  extension_fill:
    "This task's form is filled automatically — what makes form setup and readiness apply to this payer.",
  auto_verify: "Reserved for automated verification. Recorded now, no effect yet.",
  document_attach: "Pulls a document from the vault. Recorded now, no effect yet.",
};

function isInertExecutionType(value: ExecutionType): value is InertExecutionType {
  return (INERT_EXECUTION_TYPES as readonly string[]).includes(value);
}

export function isExecutionType(value: unknown): value is ExecutionType {
  return typeof value === "string" && (EXECUTION_TYPES as readonly string[]).includes(value);
}

/** Resolve any raw value to a concrete execution type, defaulting to manual. */
export function resolveExecutionType(value: unknown): ExecutionType {
  return isExecutionType(value) ? value : DEFAULT_EXECUTION_TYPE;
}

/** Template Editor picker options: Manual + Auto-fill always. If the task
 * already carries an inert type, include that value so the Select isn't blank
 * — never offer inert types when the current value is Manual or Auto-fill. */
export function authoringExecutionTypeOptions(
  current: ExecutionType | string | null | undefined,
): readonly ExecutionType[] {
  const resolved = resolveExecutionType(current);
  if (isInertExecutionType(resolved)) {
    return [...AUTHORING_EXECUTION_TYPES, resolved];
  }
  return AUTHORING_EXECUTION_TYPES;
}

/** The stored/stamped form: manual is the implicit default, so it is stored as
 * NULL (matches the tasks.execution_type CHECK: null ⇒ manual). Any explicit
 * non-manual type is stored verbatim. */
export function executionTypeForStorage(value: unknown): ExecutionType | null {
  const resolved = resolveExecutionType(value);
  return resolved === "manual" ? null : resolved;
}

/** A single task definition, narrowed to just the execution-type it carries. */
export interface HasExecutionType {
  executionType?: ExecutionType | string | null;
}

/** TE-16 — does a resolved SOP contain at least one extension_fill task? Drives
 * whether form-readiness (mapping coverage) is shown for a payer. Pure check
 * over the version's task metadata. */
export function hasExtensionFillTask(tasks: readonly HasExecutionType[]): boolean {
  return tasks.some((t) => resolveExecutionType(t.executionType) === "extension_fill");
}

/** Narrow step shape for the online_form presence check. */
export interface HasOnlineFormStep {
  steps?: readonly { stepType?: string | null }[] | null;
}

/** Does a SOP contain at least one online_form step? The funnel's historical
 * "needs portal" signal — kept as a named predicate so readiness surfaces
 * share vocabulary with BITE-SOP-TT-01. */
export function hasOnlineFormStep(tasks: readonly HasOnlineFormStep[]): boolean {
  for (const task of tasks) {
    for (const step of Array.isArray(task.steps) ? task.steps : []) {
      if (step?.stepType === "online_form") return true;
    }
  }
  return false;
}

/** BITE-SOP-TT-01 / D-SOP-3 interim — unify the dual "needs form" signals.
 * Form follow-ups apply when the SOP has Auto-fill OR an online_form step.
 * Both `payerReadiness` and `payerReadinessFunnel` consume this helper. */
export function needsFormFollowUp(
  tasks: readonly (HasExecutionType & HasOnlineFormStep)[],
): boolean {
  return hasExtensionFillTask(tasks) || hasOnlineFormStep(tasks);
}
