// Pure, pdf-lib-FREE core for the client-side PDF form filler (Epic 5).
//
// A fillable PDF (AcroForm) is a set of named form fields. To fill one from a
// provider/case, we reuse the SAME label -> token memory the portal mapper uses:
// each PDF field NAME is normalized with normalizeFieldLabel and looked up in the
// org's field_dictionary (confirmed entries only), exactly like a captured portal
// field label. A matched token then resolves against a token -> value map built
// from the provider/case data the page already holds.
//
// This module never imports pdf-lib (which is client-only and must not enter the
// server bundle). It only knows about field NAMES (strings) and value maps, so it
// stays pure, deterministic, and unit-tested — the browser layer (pdfFillClient)
// reads the field names off the PDF and hands them here.
import { normalizeFieldLabel } from "@/lib/tokenFormat";
import type { Facility, FieldDictionaryEntry, Provider, ProviderGroup } from "@/types";

/** One PDF form field name resolved (or not) to a catalog token. */
export interface PdfFieldMapping {
  /** The raw AcroForm field name, exactly as it appears in the PDF. */
  field: string;
  /** The catalog token this field maps to, or null when the dictionary has no confirmed rule. */
  token: string | null;
}

/** A field that will be filled: the PDF field name and the resolved value. */
export interface PdfFillPair {
  field: string;
  value: string;
}

/** Why a mapped-or-unmapped field will NOT be filled — surfaced in the UI. */
export type PdfUnfilledReason = "unmapped" | "no_value";

export interface PdfUnfilledField {
  field: string;
  /** The token when the field mapped but had no value; null when it never mapped. */
  token: string | null;
  reason: PdfUnfilledReason;
}

/** The fill plan: what gets written, and what is deliberately left blank + why. */
export interface PdfFillPlan {
  fill: PdfFillPair[];
  unfilled: PdfUnfilledField[];
}

// Confirmed dictionary rules as a label_normalized -> token map. Only confirmed
// entries participate: a suggested/rejected rule is not a settled answer, so the
// filler never guesses from it (mirrors the portal mapper's "confirmed wins").
function confirmedDictionaryMap(dictionary: FieldDictionaryEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of dictionary) {
    if (entry.status === "confirmed") map.set(entry.labelNormalized, entry.token);
  }
  return map;
}

// Map each PDF field name to a catalog token via the confirmed dictionary. The
// field name is normalized with the SAME normalizeFieldLabel used to key
// field_dictionary, so "First Name:", "first name" and "FIRST NAME" all resolve
// to one rule. No confirmed rule -> token null (the field is reported unmapped).
export function mapPdfFields(
  fieldNames: string[],
  dictionary: FieldDictionaryEntry[],
): PdfFieldMapping[] {
  const confirmed = confirmedDictionaryMap(dictionary);
  return fieldNames.map((field) => {
    const key = normalizeFieldLabel(field);
    const token = key ? (confirmed.get(key) ?? null) : null;
    return { field, token };
  });
}

// Resolve the mappings against a token -> value map: mapped fields with a value
// become fill pairs; unmapped fields and mapped-but-empty fields are reported in
// `unfilled` so the UI can show exactly what will be left blank and why. A value
// of "" or nullish counts as no value. Pure and deterministic (input order
// preserved).
export function resolvePdfValues(
  mappings: PdfFieldMapping[],
  tokenValues: Record<string, string>,
): PdfFillPlan {
  const fill: PdfFillPair[] = [];
  const unfilled: PdfUnfilledField[] = [];
  for (const mapping of mappings) {
    if (mapping.token == null) {
      unfilled.push({ field: mapping.field, token: null, reason: "unmapped" });
      continue;
    }
    const value = tokenValues[mapping.token];
    if (value == null || value === "") {
      unfilled.push({ field: mapping.field, token: mapping.token, reason: "no_value" });
      continue;
    }
    fill.push({ field: mapping.field, value });
  }
  return { fill, unfilled };
}

// Build the token -> value map from the provider/case data the case page already
// has — NO network call. Keys are the bare catalog token form (the same the
// field_dictionary stores), so mapPdfFields' tokens join by literal string match.
// A subset of the full 132-token catalog: the provider/group/facility fields the
// case detail carries (case-scoped payer/mso/contract tokens are resolved
// server-side elsewhere and are intentionally absent here). Only non-empty string
// values are included; an absent key resolves to "no_value", never a blank fill.
export function buildProviderTokenValues(
  provider: Provider | null,
  group: ProviderGroup | null,
  facility: Facility | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (token: string, raw: string | null | undefined) => {
    if (raw == null) return;
    const value = String(raw).trim();
    if (value !== "") out[token] = value;
  };

  if (provider) {
    set("provider.firstName", provider.firstName);
    set("provider.lastName", provider.lastName);
    set("provider.middleInitial", provider.middleInitial);
    set("provider.suffix", provider.suffix);
    set("provider.credentials", provider.credentials);
    set("provider.email", provider.email);
    set("provider.phone", provider.phone);
    set("provider.dateOfBirth", provider.dateOfBirth);
    set("provider.ssnLast4", provider.ssnLast4);
    set("provider.gender", provider.gender);
    set("provider.ethnicity", provider.ethnicity);
    set("provider.homeStreet", provider.homeStreet);
    set("provider.homeCity", provider.homeCity);
    set("provider.homeState", provider.homeState);
    set("provider.homeZip", provider.homeZip);
    set("provider.npi", provider.npi);
    set("provider.caqhId", provider.caqhId);
    set("provider.caqhLastAttestedDate", provider.caqhLastAttestedDate);
    set("provider.deaNumber", provider.deaNumber);
    set("provider.deaExpirationDate", provider.deaExpirationDate);
    set("provider.taxonomyCode", provider.taxonomyCode);
    set("provider.specialty", provider.specialty);
    set("provider.subSpecialty", provider.subSpecialty);
    set("provider.startDate", provider.startDate);
    set("provider.degree", provider.degree);
    set("provider.schoolName", provider.schoolName);
    set("provider.graduationDate", provider.graduationDate);
    set("provider.malpracticeCarrier", provider.malpracticeCarrier);
    set("provider.malpracticePolicyNumber", provider.malpracticePolicyNumber);
    set("provider.malpracticeCoverageStart", provider.malpracticeCoverageStart);
    set("provider.malpracticeCoverageEnd", provider.malpracticeCoverageEnd);
    set("provider.licenseNumber", provider.licenseNumber);
    set("provider.licenseState", provider.licenseState);
    set("provider.licenseIssueDate", provider.licenseIssueDate);
    set("provider.licenseExpirationDate", provider.licenseExpirationDate);
  }

  if (group) {
    set("group.name", group.name);
    set("group.tin", group.tin);
    set("group.npiType2", group.npiType2);
  }

  if (facility) {
    set("facility.name", facility.name);
    set("facility.street", facility.street);
    set("facility.city", facility.city);
    set("facility.state", facility.state);
    set("facility.zip", facility.zip);
    // Composed convenience token (mirrors sopResolver's facility.address).
    const address = [facility.street, facility.city, facility.state, facility.zip]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(", ");
    set("facility.address", address);
  }

  return out;
}

// A download-safe filename stem from a step label: lowercased, non-alphanumerics
// collapsed to single hyphens, trimmed. Empty -> "form". The caller appends the
// "-filled.pdf" suffix.
export function pdfFillFileStem(label: string | null | undefined): string {
  const slug = (label ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "form";
}
