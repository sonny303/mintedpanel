// E6.11 B6/B7 — what a payer-PDF fill WILL do, decided before a byte is
// written. Pure: no pdf-lib, no I/O, no dates.
//
// Source-aware by delegating to `classifyFieldMap`, the single exhaustive
// registry classifier. The dictionary-era planner (pdfFill.ts) knew only
// "token or not", so a fixed value never wrote and a field a human is supposed
// to complete was reported as a mapping gap. Here:
//   * approved + token → fills from the resolved token (empty value = a gap
//     worth showing, not a silent blank);
//   * approved + hardcoded → writes its literal, always;
//   * approved + manual → listed as the person's to write, and NOT a gap;
//   * proposed / invalid → a gap (nobody decided, so nothing may be assumed);
//   * retired → skipped entirely.
import { classifyFieldMap, displayNameOf, type RegistryRow } from "@/lib/fieldRegistry";
import { isAuthorableTransform } from "@/lib/controlOptions";
import type { ControlOption } from "@/lib/controlOptions";
import type { FillSkippedField } from "@/types";

export type PayerFormFillOutcome =
  "token" | "fixed" | "empty_token" | "manual" | "undecided" | "stale";

export interface PayerFormFillEntry {
  mapId: string;
  selector: string;
  label: string;
  token: string | null;
  value: string | null;
  outcome: PayerFormFillOutcome;
  fieldType: string | null;
  controlOptions: ControlOption[] | null;
}

export interface PayerFormFillPlan {
  /** Only the fields that carry a value to write. */
  fill: PayerFormFillEntry[];
  /** Every considered field, in registry order — the pre-download explanation. */
  entries: PayerFormFillEntry[];
  fieldsFilled: number;
  /** Gaps, in the stored fill-session shape. A manual field is NOT a gap. */
  fieldsSkipped: FillSkippedField[];
  /** Fields a person completes by hand, so the panel can say what is left. */
  manualLabels: string[];
}

interface CalendarDate {
  year: string;
  month: string;
  day: string;
}

function isValidCalendarDate(yearText: string, monthText: string, dayText: string): boolean {
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || year < 1 || year > 9999) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = daysInMonth[month - 1];
  return maxDay != null && Number.isInteger(day) && day >= 1 && day <= maxDay;
}

function dateParts(year: string, month: string, day: string): CalendarDate | null {
  if (!isValidCalendarDate(year, month, day)) return null;
  return { year, month: month.padStart(2, "0"), day: day.padStart(2, "0") };
}

/** Parse the exact ISO date/timestamp forms accepted by extension fill, without
 * Date/locale conversion so no timezone or DMY guess can move a calendar day. */
function parseIsoDate(value: string): CalendarDate | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)?)?$/.exec(
      value,
    );
  return match ? dateParts(match[1], match[2], match[3]) : null;
}

/** Compatibility for the original MM/DD transform only; never use this
 * parser for DMY outputs because 04/05/1980 cannot tell us which day is meant. */
function parseUsDate(value: string): CalendarDate | null {
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  return match ? dateParts(match[3], match[1], match[2]) : null;
}

function normalizeUsPhone(value: string): string | null {
  if (/\b(?:ext\.?|extension|x|#)\s*\w*/i.test(value)) return null;
  const trimmed = value.trim();
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null;
  let digits = value.replace(/\D/g, "");
  if (trimmed.startsWith("+") && !(digits.length === 11 && digits.startsWith("1"))) return null;
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? digits : null;
}

const STATE_ABBREVS: Readonly<Record<string, string>> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

function reshapeRegistryValue(value: string, transform: string | null): string {
  const raw = value.trim();
  if (!raw || !isAuthorableTransform(transform)) return value;
  if (transform === "state_abbrev") {
    if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
    return STATE_ABBREVS[raw.toLowerCase()] ?? value;
  }
  if (transform.startsWith("date_")) {
    const date = parseIsoDate(raw) ?? (transform === "date_mmddyyyy" ? parseUsDate(raw) : null);
    if (!date) return value;
    if (transform === "date_mmddyyyy") return `${date.month}/${date.day}/${date.year}`;
    if (transform === "date_mmddyyyy_dash") return `${date.month}-${date.day}-${date.year}`;
    if (transform === "date_ddmmyyyy") return `${date.day}/${date.month}/${date.year}`;
    if (transform === "date_ddmmyyyy_dash") return `${date.day}-${date.month}-${date.year}`;
    if (transform === "date_yyyymmdd_slash") return `${date.year}/${date.month}/${date.day}`;
    return `${date.year}-${date.month}-${date.day}`;
  }
  if (transform === "zip5") {
    const zip = /^(\d{5})(?:-?(\d{4}))?$/.exec(raw);
    return zip ? zip[1] : value;
  }
  if (transform.startsWith("phone_")) {
    const digits = normalizeUsPhone(raw);
    if (!digits) return value;
    if (transform === "phone_digits") return digits;
    if (transform === "phone_dashed") {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    if (transform === "phone_country_dashed") {
      return `(1) ${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return `+1${digits}`;
  }
  return value;
}

/** Mirror the extension shaper. Unknown transforms and malformed known values
 * pass through unchanged so the user can review the original value. */
export function applyRegistryTransform(value: string, transform: string | null): string {
  return reshapeRegistryValue(value, transform);
}

export function planPayerFormFill(
  rows: readonly RegistryRow[],
  tokenValues: Readonly<Record<string, string>>,
): PayerFormFillPlan {
  const entries: PayerFormFillEntry[] = [];
  for (const row of rows) {
    const classification = classifyFieldMap(row);
    const base = {
      mapId: row.id,
      selector: row.selector,
      label: displayNameOf(row),
      token: row.token ?? null,
      fieldType: row.fieldType ?? null,
      controlOptions: row.controlOptions ?? null,
    };
    if (classification.decision === "stale") {
      entries.push({ ...base, value: null, outcome: "stale" });
      continue;
    }
    if (classification.decision === "human") {
      entries.push({ ...base, value: null, outcome: "manual" });
      continue;
    }
    if (classification.decision === "fixed") {
      entries.push({ ...base, value: row.hardcodedValue ?? "", outcome: "fixed" });
      continue;
    }
    if (classification.decision === "token") {
      const token = row.token?.trim() ?? "";
      const resolved = (tokenValues[token] ?? "").trim();
      const shaped = resolved ? reshapeRegistryValue(resolved, row.transform ?? null) : "";
      entries.push(
        resolved
          ? {
              ...base,
              value: shaped,
              outcome: "token",
            }
          : { ...base, value: null, outcome: "empty_token" },
      );
      continue;
    }
    // undecided | invalid — a field nobody has decided about. Never guessed.
    entries.push({ ...base, value: null, outcome: "undecided" });
  }

  const fill = entries.filter(
    (entry): entry is PayerFormFillEntry & { value: string } =>
      (entry.outcome === "token" || entry.outcome === "fixed") && entry.value !== null,
  );
  const fieldsSkipped: FillSkippedField[] = entries
    .filter((entry) => entry.outcome === "empty_token" || entry.outcome === "undecided")
    .map((entry) => ({
      selector: entry.selector,
      label: entry.label,
      reason: entry.outcome === "empty_token" ? "empty_token" : "unmapped",
    }));

  return {
    fill,
    entries,
    fieldsFilled: fill.length,
    fieldsSkipped,
    manualLabels: entries.filter((e) => e.outcome === "manual").map((e) => e.label),
  };
}
