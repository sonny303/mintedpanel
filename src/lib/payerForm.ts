// Payer & Cases design bundle, screen 2 (Slice B) — pure form logic for the
// Add / Edit Payer surface. The two-step create flow (name + near-match →
// details) and the edit form share ONE draft shape and ONE validator, so
// creating and editing a payer can never drift apart.
//
// Validation mirrors the create_payer / update_payer RPC guards (name
// required, kind from the closed set, >= 1 two-letter state) so the UI blocks
// before the round trip; the RPC stays the enforcement backstop, and the
// duplicate guard has its own pure helper (payerNearMatch.ts). The one rule
// the UI adds on top: ticking an ID expectation REQUIRES the payer's own word
// for it — "tick it below and name it the way the payer does" (screen 2 copy);
// an unnamed expected ID would surface as the generic "Payer-issued ID" on the
// close dialog, which is exactly what these columns exist to replace.
import { normalizeStateCode } from "@/lib/stateCode";
import type { PayerWriteInput } from "@/services/payers";
import type { Payer, PayerKind } from "@/types";

/** The closed kind set, in the order screen 2 lists it. */
export const PAYER_KIND_OPTIONS: PayerKind[] = [
  "commercial",
  "medicare",
  "medicaid",
  "medicaid_mco",
  "medicare_advantage",
  "tricare",
];

export interface PayerFormDraft {
  name: string;
  /** "" = nothing picked yet (the "Select kind…" placeholder state). */
  payerKind: PayerKind | "";
  states: string[];
  aliases: string[];
  groupIdExpected: boolean;
  groupIdLabel: string;
  providerIdExpected: boolean;
  providerIdLabel: string;
  delegationNote: string;
}

/** A new payer starts genuinely empty — no kind, no states, no ID
 * expectations (screen 2: only Edit hydrates from the record). */
export const EMPTY_PAYER_FORM: PayerFormDraft = {
  name: "",
  payerKind: "",
  states: [],
  aliases: [],
  groupIdExpected: false,
  groupIdLabel: "",
  providerIdExpected: false,
  providerIdLabel: "",
  delegationNote: "",
};

/**
 * Hydrate the edit form from a catalog row. The ID expectations read through
 * the SAME chain the close dialog will (E6.7 provider pair → deprecated legacy
 * pair → default), so editing a pre-E6.7 payer shows what the app actually
 * resolves today instead of a blank box that would silently drop the legacy
 * label on save.
 */
export function payerDraftFromPayer(payer: Payer): PayerFormDraft {
  const legacyLabel = payer.resolutionIdLabel?.trim() ?? "";
  const providerLabel = payer.providerIdLabel?.trim() ?? "";
  const providerExpected =
    typeof payer.providerIdExpected === "boolean"
      ? payer.providerIdExpected
      : typeof payer.resolutionIdExpected === "boolean"
        ? payer.resolutionIdExpected
        : false;
  return {
    name: payer.name,
    payerKind: payer.payerKind ?? "commercial",
    states: normalizeStates(payer.states ?? []),
    aliases: (payer.aliases ?? []).filter((a) => a.trim() !== ""),
    groupIdExpected: payer.groupIdExpected === true,
    groupIdLabel: payer.groupIdLabel?.trim() ?? "",
    providerIdExpected: providerExpected,
    providerIdLabel: providerLabel || legacyLabel,
    delegationNote: payer.delegationNote ?? "",
  };
}

export interface PayerFormErrors {
  name?: string;
  payerKind?: string;
  states?: string;
  groupIdLabel?: string;
  providerIdLabel?: string;
}

export function payerFormErrors(draft: PayerFormDraft): PayerFormErrors {
  const errors: PayerFormErrors = {};
  if (draft.name.trim() === "") errors.name = "A payer name is required.";
  if (draft.payerKind === "") errors.payerKind = "Pick the payer type.";
  if (draft.states.length === 0) {
    errors.states = "Pick at least one state this payer operates in.";
  }
  if (draft.groupIdExpected && draft.groupIdLabel.trim() === "") {
    errors.groupIdLabel = "Name the group-level ID the way this payer does.";
  }
  if (draft.providerIdExpected && draft.providerIdLabel.trim() === "") {
    errors.providerIdLabel = "Name the provider-level ID the way this payer does.";
  }
  return errors;
}

export function hasPayerFormErrors(errors: PayerFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Sorted, de-duplicated, uppercase two-letter codes — the shape the RPC's
 * `^[A-Z]{2}$` check and every downstream states[] intersection expect. */
export function normalizeStates(states: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of states) {
    const code = normalizeStateCode(raw);
    if (/^[A-Z]{2}$/.test(code)) out.add(code);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

export function toggleState(states: readonly string[], code: string): string[] {
  const normalized = normalizeStateCode(code);
  return states.includes(normalized)
    ? states.filter((s) => s !== normalized)
    : normalizeStates([...states, normalized]);
}

/** Case-insensitive de-duplication against the existing aliases AND the
 * payer's own name — an alias that repeats the name is noise the duplicate
 * guard would flag against itself. Returns the list unchanged when the value
 * is blank or already present. */
export function addAlias(aliases: readonly string[], value: string, name = ""): string[] {
  const alias = value.trim();
  if (alias === "") return [...aliases];
  const lower = alias.toLowerCase();
  if (lower === name.trim().toLowerCase()) return [...aliases];
  if (aliases.some((a) => a.trim().toLowerCase() === lower)) return [...aliases];
  return [...aliases, alias];
}

export function removeAlias(aliases: readonly string[], value: string): string[] {
  return aliases.filter((a) => a !== value);
}

/**
 * The RPC payload. Blank optional text becomes NULL (never an empty string —
 * the resolver treats "" and NULL the same, but NULL is the honest "not set"),
 * and a label is only carried when its expectation is ticked, so unticking
 * "issues a group ID" actually clears the stored label.
 */
export function toPayerWriteInput(draft: PayerFormDraft): PayerWriteInput {
  const trimmedNote = draft.delegationNote.trim();
  return {
    name: draft.name.trim(),
    // Guarded by payerFormErrors before submit; commercial is the DB default.
    payerKind: draft.payerKind === "" ? "commercial" : draft.payerKind,
    states: normalizeStates(draft.states),
    aliases: draft.aliases.map((a) => a.trim()).filter((a) => a !== ""),
    groupIdExpected: draft.groupIdExpected,
    groupIdLabel: draft.groupIdExpected ? draft.groupIdLabel.trim() || null : null,
    providerIdExpected: draft.providerIdExpected,
    providerIdLabel: draft.providerIdExpected ? draft.providerIdLabel.trim() || null : null,
    delegationNote: trimmedNote === "" ? null : trimmedNote,
  };
}

/** True when the edit form still matches the record it hydrated from — the
 * Save button stays enabled either way (the RPC is idempotent), but the
 * unsaved-changes guard only fires on a real edit. */
export function isPayerDraftDirty(draft: PayerFormDraft, original: PayerFormDraft): boolean {
  return JSON.stringify(draft) !== JSON.stringify(original);
}
