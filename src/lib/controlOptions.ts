// E6.10 — captured option vocabulary for structured controls.
// Portal truth: { value, label } pairs from the page's own choices, never the
// selected/checked/typed value. Pure — no I/O.

export interface ControlOption {
  value: string;
  label: string;
}

export const AUTHORABLE_TRANSFORMS = ["state_abbrev", "date_mmddyyyy"] as const;
export type AuthorableTransform = (typeof AUTHORABLE_TRANSFORMS)[number];

export const CONTROL_TYPE_LABELS: Record<string, string> = {
  text: "Text",
  select: "Dropdown",
  radio: "Radio",
  checkbox: "Checkbox",
  date: "Date",
  file: "File",
};

export const STRUCTURED_FIELD_TYPES = new Set(["select", "radio", "checkbox"]);

/** Max options stored per field. Capture and the write boundary share this. */
export const CONTROL_OPTIONS_CAP = 50;

/** Sample size for skip-reason lines (F6.10.6 / OQ-3). */
export const OPTION_SAMPLE_SIZE = 3;

export function isAuthorableTransform(value: string | null | undefined): value is AuthorableTransform {
  return value === "state_abbrev" || value === "date_mmddyyyy";
}

export function controlTypeLabel(fieldType: string | null | undefined): string {
  if (!fieldType) return "Text";
  return CONTROL_TYPE_LABELS[fieldType] ?? fieldType;
}

function asOption(raw: unknown): ControlOption | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.value !== "string" || typeof rec.label !== "string") return null;
  return { value: rec.value, label: rec.label };
}

/** Parse a stored or inbound list. Invalid shape → null (treat as uncaptured). */
export function parseControlOptions(raw: unknown): ControlOption[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  const out: ControlOption[] = [];
  for (const item of raw) {
    const opt = asOption(item);
    if (!opt) return null;
    out.push(opt);
  }
  return out;
}

/**
 * Write-boundary validator. `undefined` means the key was absent (leave stored).
 * `null` clears (not used on re-capture). An empty array is a valid parsed
 * value that re-capture must IGNORE at the caller — this function returns it
 * so the caller can decide.
 */
export function validateControlOptionsInput(
  raw: unknown,
): { kind: "ok"; options: ControlOption[] | null } | { kind: "rejected"; message: string } {
  if (raw == null) return { kind: "ok", options: null };
  if (!Array.isArray(raw)) {
    return { kind: "rejected", message: "control_options must be an array of { value, label }" };
  }
  if (raw.length > CONTROL_OPTIONS_CAP) {
    return {
      kind: "rejected",
      message: `control_options cannot exceed ${CONTROL_OPTIONS_CAP} entries`,
    };
  }
  const parsed = parseControlOptions(raw);
  if (parsed == null) {
    return { kind: "rejected", message: "control_options must be an array of { value, label } strings" };
  }
  return { kind: "ok", options: parsed };
}

/** True when a stored hardcoded value is missing from a refreshed vocabulary. */
export function hardcodedValueMissingFromOptions(
  hardcodedValue: string | null | undefined,
  options: ControlOption[] | null | undefined,
): boolean {
  const literal = hardcodedValue?.trim() ?? "";
  if (!literal) return false;
  if (!options || options.length === 0) return false;
  return !options.some((o) => o.value === literal);
}

/** Bounded sample for a skip-reason line. Never dumps the full list. */
export function optionSample(
  options: readonly ControlOption[],
  limit = OPTION_SAMPLE_SIZE,
): string {
  if (options.length === 0) return "";
  const shown = options.slice(0, limit).map((o) => o.value);
  const extra = options.length - shown.length;
  const body = shown.join(", ");
  return extra > 0 ? `${body}; ${extra} more` : body;
}

export function transformEffectCopy(transform: string | null | undefined): string | null {
  if (transform === "state_abbrev") return "Kansas → KS";
  if (transform === "date_mmddyyyy") return "Date → MM/DD/YYYY";
  return null;
}
