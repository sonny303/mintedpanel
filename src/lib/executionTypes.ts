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

export const EXECUTION_TYPE_LABELS: Record<ExecutionType, string> = {
  manual: "Manual",
  extension_fill: "Extension fill",
  auto_verify: "Auto verify",
  document_attach: "Document attach",
};

/** Short capability note per type — R6 captures config only, so every type is
 * "captured, runs later" except manual. */
export const EXECUTION_TYPE_HINTS: Record<ExecutionType, string> = {
  manual: "Worked by a specialist.",
  extension_fill: "The browser extension fills this form (activates in E4.3).",
  auto_verify: "Automated verification (activates in R7).",
  document_attach: "Pulls a document from the vault (activates in E4.5).",
};

export function isExecutionType(value: unknown): value is ExecutionType {
  return typeof value === "string" && (EXECUTION_TYPES as readonly string[]).includes(value);
}

/** Resolve any raw value to a concrete execution type, defaulting to manual. */
export function resolveExecutionType(value: unknown): ExecutionType {
  return isExecutionType(value) ? value : DEFAULT_EXECUTION_TYPE;
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
