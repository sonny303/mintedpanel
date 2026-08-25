// E6.11 (B3) — a blank payer PDF's AcroForm fields, turned into propose-ready
// shared registry rows.
//
// Pure and pdf-lib-FREE, mirroring the pdfFill.ts / pdfFillClient.ts split:
// the browser layer reads the descriptors off the file, this module decides
// what each one becomes in `portal_field_maps`. That keeps the mapping rules
// unit-testable without a PDF and keeps pdf-lib out of every bundle that only
// needs the rules.
//
// The registry row is keyed on the FORM FAMILY, not the template and not the
// payer: `payer_forms.family_id` is the stable identity a template action
// points at, so replacing a blank (v1 → v2) keeps the mappings the trainer
// already made. Re-import is repair, never re-decision — the propose RPC
// refreshes presentation columns and leaves status/source/token alone.

/** The subset of an AcroForm field the registry needs. Produced by the
 * pdf-lib reader (pdfFieldImportClient), never by this module. */
export interface PdfAcroFieldDescriptor {
  /** The full, hierarchical AcroForm field name — what a fill joins on. */
  name: string;
  /** pdf-lib's field class, lowercased. */
  type: "text" | "checkbox" | "radio" | "dropdown" | "optionlist" | "button" | "signature";
  /** The `/TU` tooltip. A far better field label than the name, and free. */
  tooltip?: string | null;
  /** A control's option vocabulary (checkbox export values, dropdown options). */
  options?: readonly string[] | null;
}

/** One row to propose. Field names match the browser propose service's input. */
export interface PdfFieldImportRow {
  portalKey: string;
  selector: string;
  fieldLabel: string;
  formSection: string | null;
  fieldType: "text" | "select" | "radio" | "checkbox";
  sortOrder: number;
  controlOptions: { value: string; label: string }[] | null;
  notes: string;
}

export const PDF_PORTAL_KEY_PREFIX = "payer-form:";

export const PDF_IMPORT_NOTE = "Imported from the payer's blank form";

/** The synthetic portal key a form family's registry rows live under. Lowercase
 * because `portal_key` is normalized that way everywhere (normalizePortalKey). */
export function pdfFormPortalKey(familyId: string): string {
  return `${PDF_PORTAL_KEY_PREFIX}${familyId.trim().toLowerCase()}`;
}

/** The family a PDF portal key names, or null when the key is not one. */
export function payerFormFamilyFromPortalKey(portalKey: string | null | undefined): string | null {
  if (!portalKey) return null;
  const key = portalKey.trim().toLowerCase();
  if (!key.startsWith(PDF_PORTAL_KEY_PREFIX)) return null;
  const family = key.slice(PDF_PORTAL_KEY_PREFIX.length);
  return family === "" ? null : family;
}

// LiveCycle and Designer exports carry array indices on every path segment
// (`form1[0].PSCRPage2[0].CAQH1[0]`). They are structure, not meaning.
const stripIndices = (segment: string): string => segment.replace(/\[\d+\]/g, "");

// Root subform names carry no information for a human reading a field list.
const ROOT_SEGMENTS = new Set(["form", "form1", "topmostsubform", "#subform", "root"]);

/** Split a PDF-ish identifier into words: `PhysicalCity` → "Physical City",
 * `TINNumber` → "TIN Number", `ANI1` → "ANI 1". Acronym-aware, so an all-caps
 * run stays one word. */
export function humanizeFieldName(raw: string): string {
  return stripIndices(raw)
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/** The section a field sits in: its subform path, minus the generic root and
 * minus the leaf. Null when the name is flat (nothing to group by). */
export function pdfFieldSection(name: string): string | null {
  const segments = name
    .split(".")
    .map(stripIndices)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const path = segments.slice(0, -1).filter((s) => !ROOT_SEGMENTS.has(s.toLowerCase()));
  if (path.length === 0) return null;
  return path.map(humanizeFieldName).join(" › ");
}

/** The label a human reads: the tooltip when the payer wrote one, else the
 * camel-split leaf name. */
export function pdfFieldLabel(field: PdfAcroFieldDescriptor): string {
  const tooltip = field.tooltip?.trim();
  if (tooltip) return tooltip;
  const segments = stripIndices(field.name)
    .split(".")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const leaf = segments.length > 0 ? segments[segments.length - 1] : field.name;
  return humanizeFieldName(leaf) || field.name;
}

// A pushbutton has nothing to fill and a signature box cannot be filled
// electronically at all — importing them would add rows a trainer must decide
// about and can only ever mark "a person fills this".
const FILLABLE_TYPES = new Set(["text", "checkbox", "radio", "dropdown", "optionlist"]);

const REGISTRY_FIELD_TYPE: Record<string, PdfFieldImportRow["fieldType"]> = {
  text: "text",
  checkbox: "checkbox",
  radio: "radio",
  dropdown: "select",
  optionlist: "select",
};

/**
 * Turn a blank form's fields into rows to propose, in document order.
 *
 * Deterministic and order-stable: the same file always yields the same rows in
 * the same order, which is what makes a re-import a presentation refresh
 * instead of a reshuffle. Unnamed fields and unfillable controls are dropped;
 * a repeated name (the same box on two pages) is kept once — `selector` is
 * unique per tier, so the second occurrence would resolve to the same row.
 */
export function pdfFieldImportRows(
  familyId: string,
  fields: readonly PdfAcroFieldDescriptor[],
): PdfFieldImportRow[] {
  const portalKey = pdfFormPortalKey(familyId);
  const seen = new Set<string>();
  const rows: PdfFieldImportRow[] = [];
  for (const field of fields) {
    const selector = field.name?.trim();
    if (!selector) continue;
    if (!FILLABLE_TYPES.has(field.type)) continue;
    if (seen.has(selector)) continue;
    seen.add(selector);
    const options = (field.options ?? [])
      .map((value) => value.trim())
      .filter((value) => value !== "");
    rows.push({
      portalKey,
      selector,
      fieldLabel: pdfFieldLabel(field),
      formSection: pdfFieldSection(selector),
      fieldType: REGISTRY_FIELD_TYPE[field.type] ?? "text",
      sortOrder: rows.length + 1,
      controlOptions:
        options.length > 0
          ? options.map((value) => ({ value, label: humanizeFieldName(value) || value }))
          : null,
      notes: PDF_IMPORT_NOTE,
    });
  }
  return rows;
}

/** What an import did, for the panel's read-out. `skipped` counts the fields
 * that carry nothing to fill (pushbuttons, signature boxes, unnamed). */
export interface PdfImportSummary {
  rows: PdfFieldImportRow[];
  totalFields: number;
  skipped: number;
}

export function summarizePdfImport(
  familyId: string,
  fields: readonly PdfAcroFieldDescriptor[],
): PdfImportSummary {
  const rows = pdfFieldImportRows(familyId, fields);
  return { rows, totalFields: fields.length, skipped: fields.length - rows.length };
}
