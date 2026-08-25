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

/** The two authorable transforms, mirrored from the extension's applyTransform.
 * An unknown transform is a no-op — never a guess and never a throw.
 *
 * `state_abbrev` normalizes CASE only. Every state the panel stores is already
 * a two-letter code (`usStates.ts` is a code list; there is no name table in
 * this repo), so expanding a spelled-out state name would mean inventing a
 * mapping the extension owns — a value we cannot resolve is passed through
 * untouched rather than guessed at. */
export function applyRegistryTransform(value: string, transform: string | null): string {
  const raw = value.trim();
  if (!raw || !isAuthorableTransform(transform)) return value;
  if (transform === "state_abbrev") {
    return /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : value;
  }
  // date_mmddyyyy — reshape only the two unambiguous machine forms we may have
  // stored (ISO and already-US). Anything else a human typed is left alone.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (us) return `${us[1].padStart(2, "0")}/${us[2].padStart(2, "0")}/${us[3]}`;
  return value;
}

export function planPayerFormFill(
  rows: readonly RegistryRow[],
  tokenValues: Readonly<Record<string, string>>,
): PayerFormFillPlan {
  const entries: PayerFormFillEntry[] = [];
  for (const row of rows) {
    const classification = classifyFieldMap(row);
    const base = {
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
      entries.push(
        resolved
          ? {
              ...base,
              value: applyRegistryTransform(resolved, row.transform ?? null),
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
